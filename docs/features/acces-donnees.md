# Fonctionnalité : accès aux données

Statut : livrée

Jalon 0, fonctionnalité 0.2 de `docs/PLAN.md`. Taille M.

## Contexte

Cette fonctionnalité sert au développeur, pas à l'utilisateur final. Toute fonctionnalité qui lit ou écrit une donnée d'organisation en dépend : le journal d'audit (0.3), la chaîne de contrôles (0.4), puis tout le métier.

Aujourd'hui :

- `src/server/db/client.ts` crée un `Pool` de `pg` sur `env.DATABASE_URL` et exporte `db`, utilisé seulement par Better Auth (`src/server/auth/config.ts`). Aucune fonction n'ouvre de transaction ni ne fixe l'organisation active, alors que `docs/STRUCTURE.md` (section 3.1) et `docs/DESIGN.md` (section 3.2, étape 5) la placent dans ce fichier.
- L'isolation n'est prouvée que par `scripts/verifier-isolation.mjs` : le rôle propriétaire crée une table jetable, le rôle de l'application passe six contrôles, la table est supprimée. Le modèle de règle n'existe que dans ce script, en SQL écrit à la main.
- Aucune table métier n'existe. Les seules tables sont celles de Better Auth et `compteur_debit`, qui n'a pas d'`organisation_id` par conception (`docs/DESIGN.md`, section 2.3).
- Vitest n'exécute que des tests sans base (`src/**/*.test.ts`). Le job « Qualité » de la CI n'a pas de base ; le job « Base de données et bout en bout » en a une, mais n'y lance aucun test Vitest.
- L'adresse `DATABASE_URL` en développement passe par le regroupement de connexions de Neon (PgBouncer, mode transaction) : deux transactions successives d'un même client peuvent s'exécuter sur deux connexions différentes du serveur, et une même connexion du serveur sert successivement plusieurs clients.

Cas d'utilisation concernés : aucun directement. Tous les cas d'utilisation d'un membre en dépendent.

## Problème

- Rien ne fournit la seule façon autorisée d'exécuter une requête métier : une transaction où l'organisation active est fixée, et ne vaut que pour elle.
- Fixer l'organisation pour toute la session (`SET app.organisation_id = ...`) serait une faille avec le regroupement de connexions : la valeur resterait sur la connexion du serveur et s'appliquerait à la requête d'un autre utilisateur.
- Chaque future table métier devrait réécrire à la main la règle de sécurité au niveau des lignes. Une variante fautive (oubli de `WITH CHECK`, oubli du forçage, comparaison sans `NULLIF`) passerait inaperçue.
- Les tests avec base n'ont ni outillage (création d'organisations, nettoyage, vérification d'isolation), ni place dans la CI, ni protection contre une exécution sur `preview` ou `production`.

## Préalable : le type des identifiants d'organisation

Tranché (décision 1) : identifiants `uuid` partout (option U1). Livré par `docs/features/identifiants-uuid.md`, et déployé sur `dev`, `preview` et `production`. Les tables de Better Auth ont des colonnes `id` en `uuid` fabriquées par la base (`gen_random_uuid()`), et leurs clés étrangères sont en `uuid`. Une clé étrangère `organisation_id uuid` vers `organization.id uuid` est donc possible, et la conversion `::uuid` de la règle s'applique à de vrais UUID.

Options écartées à l'époque : U2 (identifiants `text`, règle comparant des `text`, format propre à Better Auth) et U3 (`organisation_id` sans clé étrangère, contraire à `DESIGN.md` section 2.4).

## Solution retenue

Exigences couvertes : aucune exigence F ou R. Exigences de sécurité dans la section suivante.

### 1. La transaction avec organisation active

#### 1.1 La fonction

Dans `src/server/db/client.ts` :

```ts
executerDansOrganisation<T>(
  organisationId: string,
  travail: (tx: TransactionOrganisation) => Promise<T>,
): Promise<T>
```

Dans l'ordre :

1. Valider `organisationId` (section 1.4). En cas d'échec, lever l'erreur avant de prendre une connexion dans le `Pool`.
2. Ouvrir une transaction Drizzle (`db.transaction`), qui réserve une connexion du `Pool` pour toute sa durée.
3. Première instruction de la transaction : `SELECT set_config('app.organisation_id', $1, true)`, l'identifiant étant passé en paramètre lié (S-86).
4. Appeler `travail(tx)` et renvoyer son résultat. Une exception annule la transaction et remonte telle quelle.

`TransactionOrganisation` est le type de `tx` exporté par `client.ts`. Les futures fonctions de `src/server/db/requetes/` le prennent en premier paramètre : une requête métier ne peut donc pas être appelée sans transaction ouverte par cette fonction.

`client.ts` exporte aussi une fabrique `creerAcces(pool)`, qui renvoie `{ db, executerDansOrganisation }` liés au `Pool` reçu. Les exports `db` et `executerDansOrganisation` du module sont l'instance liée au `Pool` principal. La fabrique sert aux tests qui exigent une connexion précise (`Pool` d'une seule connexion, section 4.3) ou un `Pool` factice (tests unitaires).

#### 1.2 Pourquoi c'est sûr avec le regroupement de connexions

- Le troisième argument `true` de `set_config` rend le réglage **local à la transaction** : PostgreSQL le remet à sa valeur précédente au `COMMIT` comme au `ROLLBACK`.
- En mode transaction, PgBouncer attribue une connexion du serveur pour toute la durée d'une transaction, et ne la rend qu'à sa fin. Le réglage et les requêtes s'exécutent donc sur la même connexion du serveur, et le réglage a disparu quand une autre requête la reçoit.
- Il en va de même du `Pool` de `pg` côté application : la connexion n'est rendue qu'après la fin de la transaction.

Sont interdits, et signalés dans le code par un commentaire :

| Interdit | Raison |
|---|---|
| `SET app.organisation_id` ou `set_config(..., false)` | Réglage de session : il survit à la transaction et passe à un autre client par le regroupement |
| `SET LOCAL app.organisation_id = '...'` | `SET` n'accepte pas de paramètre lié : il faudrait concaténer l'identifiant (S-86) |
| Fixer l'organisation par une requête hors transaction, puis interroger | Les deux instructions peuvent partir sur deux connexions différentes du serveur |

Remarque : après une transaction qui l'a fixé, le réglage ne disparaît pas de la connexion, il vaut `''` (chaîne vide) et non `NULL`. D'où le `NULLIF(..., '')` de la règle (section 2.1).

#### 1.3 Organisation active non fixée

Il n'existe pas de chemin « sans organisation » dans la fonction : l'identifiant est un paramètre obligatoire. Si du code interroge la base par `db` hors de `executerDansOrganisation` :

- `current_setting('app.organisation_id', true)` vaut `NULL` (jamais fixé sur cette connexion) ou `''` (fixé puis rétabli) ; `NULLIF` ramène les deux à `NULL`, et `NULL::uuid` vaut `NULL` sans erreur ;
- la condition `organisation_id = NULL` n'est jamais vraie : **une lecture renvoie zéro ligne, sans erreur**, aucune ligne n'est modifiée ni supprimée ;
- une insertion est **refusée** par `WITH CHECK` (erreur PostgreSQL `42501`) ;
- **aucune erreur de conversion** (`22P02`) n'apparaît sur la valeur vide `''` : sans `NULLIF`, `''::uuid` échouerait, et une lecture sans organisation deviendrait une erreur au lieu d'un résultat vide. Les tests vérifient les deux états de la connexion, `NULL` et `''`.

C'est le comportement attendu par T-53 : « une requête sans contexte d'organisation ne renvoie aucune ligne ». Il est prouvé par les contrôles 1 et 6 (section 4.3) et par les tests de `client.integration.test.ts`.

`db` reste exporté pour Better Auth, dont les tables ne portent pas de règle (`docs/DESIGN.md`, section 2.5). Décision 10 : une règle ESLint interdit dès la 0.2 d'importer `db` ailleurs que dans `src/server/auth/config.ts` et `src/server/db/` (section 4.1).

#### 1.4 Identifiant invalide

- L'identifiant est validé par un schéma Zod `z.uuid()` dans `client.ts`, même s'il proviendra en 0.4 d'une session déjà vérifiée : défense en profondeur, et le contrôle ne coûte rien.
- Sont refusés : chaîne vide, valeur qui n'est pas une chaîne, texte quelconque, UUID entouré d'espaces, UUID hors des variantes de la RFC 9562 (comme `11111111-1111-1111-1111-111111111111`, utilisé par le script). Les tests utilisent `crypto.randomUUID()`.
- L'erreur levée est une `Error` ordinaire de la classe `OrganisationActiveInvalide`, au message fixe « Identifiant d'organisation active invalide. », sans la valeur reçue ni propriété `cause` (S-54, T-35, même principe que `validerEnvironnement`).
- Aucune connexion n'est prise et aucune requête n'est envoyée.
- Seconde barrière, si la validation était contournée : la conversion `::uuid` de la règle échoue (erreur PostgreSQL `22P02`), la transaction est annulée, aucune ligne n'est renvoyée.

Un identifiant valide mais inconnu (aucune organisation de ce numéro) ne provoque pas d'erreur : la transaction ne voit simplement aucune ligne. Vérifier l'adhésion est le rôle de la chaîne de contrôles (0.4).

### 2. Le modèle de règle de sécurité au niveau des lignes

#### 2.1 Le modèle

Un fichier `src/server/db/schema/isolation.ts` (sans `server-only`, règle 13 : drizzle-kit le charge) fournit :

- `colonneOrganisation()` : `uuid("organisation_id").notNull().references(() => organization.id, { onDelete: "restrict" })`. Décision 8 : `ON DELETE RESTRICT` pour toute table, table témoin comprise. Une organisation qui a des lignes ne peut pas être supprimée directement ; l'outillage de test supprime les lignes avant l'organisation (section 4.2) ;
- `regleIsolation()` : un `pgPolicy("isolation_organisation", ...)` pour toutes les commandes (`for: "all"`), sans clause `to`, donc pour tous les rôles, avec :

```sql
USING      (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)
WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)
```

Une table métier se déclare avec `pgTable.withRLS(...)`, `colonneOrganisation()` et `regleIsolation()`. L'expression est la même que celle du script, à l'identique.

#### 2.2 Le forçage : une migration personnalisée

Vérifié dans `node_modules/drizzle-kit` (version 1.0.0-rc.4) : l'outil ne produit que `ENABLE` ou `DISABLE ROW LEVEL SECURITY`, jamais `FORCE`. La règle 3 de `CLAUDE.md` exige pourtant une règle « activée et forcée ». Sans forçage, le propriétaire des tables (`neondb_owner`, utilisé par les migrations et les scripts) n'est pas soumis à la règle.

Retenu (décision 2) : **une migration personnalisée**, dans la chaîne normale des migrations, appliquée partout par le workflow. Exception écrite et bornée à « ne modifie jamais le dossier `drizzle/` à la main » :

- elle ne vaut que pour une migration créée par `npx drizzle-kit generate --custom --name forcer-isolation-<table>`, et dont le seul contenu est une ou plusieurs lignes `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;` ;
- l'assistant crée le fichier vide par la commande et indique la ligne exacte à coller ; **le développeur colle la ligne lui-même**. L'assistant n'écrit jamais dans `drizzle/` ;
- le test d'inventaire (section 4.4) échoue si une table portant `organisation_id` n'est pas forcée : un oubli ne passe pas la CI.

Options écartées :

| Option | Raison de l'écarter |
|---|---|
| Ne pas forcer | Contraire à la règle 3 |
| Déclencheur sur événement qui force la règle de toute table créée | Exige un super-utilisateur, non garanti chez Neon |
| Forçage par un script de `scripts/` après chaque migration | Étape hors du workflow des migrations, facile à oublier en production |

#### 2.3 Sur quoi prouver le modèle

Retenu (décision 3) : **une table témoin permanente, créée par migration avec le modèle**, présente en production.

`temoin_isolation`, déclarée dans `schema/technique.ts` sous le nom `temoinIsolation` :

| Colonne SQL | Propriété Drizzle | Définition |
|---|---|---|
| `id` | `id` | `uuid`, clé primaire, `gen_random_uuid()` par défaut |
| `organisation_id` | `organisationId` | `colonneOrganisation()` |
| `valeur` | `valeur` | `text NOT NULL` |

Elle prouve toute la chaîne réelle : modèle Drizzle, SQL généré et relu, migration appliquée, droits par défaut, règle forcée, contrôles par le rôle de l'application. Elle sert de référence au test d'inventaire (section 4.4). Elle ne reçoit de lignes que des tests, sur `dev` et en CI ; elle reste vide en production.

Options écartées :

| Option | Raison de l'écarter |
|---|---|
| Table créée pendant les tests par le rôle propriétaire | Les tests devraient connaître `DATABASE_URL_MIGRATION` : contraire à la règle 2 et à `STRUCTURE.md` section 5. Ne prouve pas le SQL généré par Drizzle |
| Table temporaire créée par le rôle de l'application | Ne passe pas par Drizzle ni par les migrations. Liée à la session : avec le regroupement de Neon, elle peut disparaître entre deux transactions, ce qui fausse le contrôle 6. Dépend du droit `TEMPORARY`, qu'il vaudrait mieux retirer (voir « Reporté ») |
| Attendre la table du journal d'audit (0.3) | La 0.2 serait livrée sans preuve. Le journal est en ajout seul : le contrôle 5 y rencontre un refus de droit, pas un résultat vide |

### 3. La séparation des tests sans base et avec base

Retenu (décision 12) : **un suffixe de fichier**, `*.integration.test.ts`, pour tout test qui touche la base, y compris les tests d'attaque (`client.attaque.integration.test.ts`). Visible dans le nom, sélection par motif. Les tests d'attaque restent comptables par `*.attaque*.test.ts`. `docs/PLAN.md` section 4.1 et `docs/STRUCTURE.md` section 6 sont mis à jour.

Deux projets Vitest (`test.projects`, présent dans Vitest 5) dans `vitest.config.mts` :

| Projet | Fichiers | Particularités |
|---|---|---|
| `unitaires` | `src/**/*.test.ts`, sauf `src/**/*.integration.test.ts` | Ne reçoit aucune variable de `.env.local` |
| `integration` | `src/**/*.integration.test.ts` | `setupFiles` : le garde-fou (section 5). `test.env` : les variables de `.env.local` (section 4.1). `testTimeout` et `hookTimeout` : 60 s |

Le délai de 60 s, au lieu des 5 s par défaut de Vitest, ne vaut que pour le projet `integration`. Raison constatée à l'implémentation : sur `dev`, chaque requête traverse le réseau jusqu'à Neon, et les tests qui en enchaînent plusieurs dizaines (`verifierIsolation`, les quarante transactions alternées) dépassaient 5 s. Le projet `unitaires` garde le délai par défaut.

Scripts de `package.json` :

| Script | Commande | Base |
|---|---|---|
| `test` | `vitest run --project unitaires` | Non |
| `test:watch` | `vitest --project unitaires` | Non |
| `test:integration` | `vitest run --project integration` | Oui |

Le nom de `npm test` ne change pas : le job « Qualité » et l'habitude restent valables.

Options écartées : un dossier séparé (contraire à « à côté du fichier testé », `STRUCTURE.md` section 6) ; sauter les tests quand la base est absente (`describe.skipIf`), qui donne une suite verte n'ayant rien testé.

Un test qui ne touche pas la base reste un test unitaire, même s'il porte sur l'outillage : la décision du garde-fou (`garde-base.attaque.test.ts`) et les règles ESLint (`regles-import.test.ts`) tournent dans `npm test`, donc dans le job « Qualité ».

Un test ne vit pas dans `src/server/db/schema/` : drizzle-kit charge tous les fichiers `schema/*.ts` et lirait un fichier de test comme un schéma (même raison que `schema-auth.test.ts`). Le test du modèle s'appelle donc `src/server/db/schema-isolation.integration.test.ts`.

### 4. L'outillage de test

#### 4.1 Emplacement, et adresse de la base sans `process.env`

Retenu : **dans `src/server/db/outils-test/`**, en passant par `client.ts`, donc par `env.ts`. Les tests exercent la vraie fonction et le vrai `Pool`. Drizzle reste confiné à `src/server/db/` (règle 4). Aucun `process.env` hors de `env.ts` (règle 12). Écarté : `tests/` à la racine avec `pg` et `process.env`, qui ouvre une seconde connexion, ne teste pas la vraie fonction et contourne l'esprit des règles 4 et 12.

- L'adresse vient de `env.DATABASE_URL`, lue par `env.ts`. `env.ts` valide aussi `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` : les trois variables doivent être présentes.
- **En local**, Vitest ne charge pas `.env.local` dans `process.env`. `vitest.config.mts` (à la racine, hors de `src/`, donc hors de la règle 12) lit `.env.local` avec `dotenv` dans un objet séparé (`config({ path: ".env.local", processEnv: {}, quiet: true })`), et le passe au seul projet `integration` par `test.env`. Le projet `unitaires` ne reçoit rien. Ni l'assistant ni le code n'affichent ces valeurs.
- **En CI**, `.env.local` n'existe pas : les variables viennent de l'environnement du job.
- Un fichier de `outils-test/` ne se termine pas par `.test.ts` : Vitest ne l'exécute pas, et aucune page ne l'important, `next build` ne l'inclut pas.

Deux règles ESLint (`no-restricted-imports`), vérifiées par `src/server/db/regles-import.test.ts` :

| Règle | Fichiers autorisés | Raison |
|---|---|---|
| L'outillage de test (`src/server/db/outils-test/`) ne s'importe, statiquement ou dynamiquement, que depuis un fichier de test (`*.test.ts`) ou un fichier de ce dossier | `src/**/*.test.ts`, `src/server/db/outils-test/**` | Ces fonctions créent et suppriment des organisations |
| `db` (export de `src/server/db/client.ts`) ne s'importe que dans `src/server/auth/config.ts` et `src/server/db/` (décision 10). L'import d'espace de noms (`import * as`) et la réexportation sont aussi refusés hors de ces fichiers | `src/server/auth/config.ts`, `src/server/db/**` | `db` n'a pas d'organisation active : hors de Better Auth, tout passe par `executerDansOrganisation` |

`executerDansOrganisation`, `TransactionOrganisation` et `OrganisationActiveInvalide` restent importables ailleurs.

#### 4.2 Deux organisations aux identifiants aléatoires, et leur nettoyage

`creerDeuxOrganisations({ tables })` dans `src/server/db/outils-test/organisations.ts` :

- insère deux lignes dans `organization` (table de Better Auth, sans règle), avec `id` = `crypto.randomUUID()`, `slug` = `test-<identifiant>`, `name` = `Test <identifiant>`, `created_at` = maintenant ;
- renvoie `{ a, b, nettoyer }`.

`nettoyer()` :

- pour chaque organisation, supprime ses lignes des tables indiquées par `tables`, dans `executerDansOrganisation` (la règle interdit de le faire sans contexte), **puis** supprime l'organisation : la clé étrangère est en `ON DELETE RESTRICT` (décision 8) ;
- ne lève pas d'erreur si une suppression ne trouve rien, pour pouvoir être appelée deux fois ;
- ne cible que les deux identifiants créés, jamais un motif (`slug LIKE 'test-%'`) : un test ne supprime que ce qu'il a créé.

Utilisation obligatoire : `nettoyer` est enregistré dès la création par `onTestFinished` (ou `afterAll` pour un fichier entier), de sorte qu'un test en échec nettoie aussi.

Un processus tué laisse des lignes. Décision 7 : pas de script de balayage. Les organisations de test gardent le préfixe `test-` dans leur `slug`, ce qui permet de les reconnaître à la main ; la recréation de la branche `dev` les efface, comme le prévoit `PLAN.md` section 7. En CI, la base est neuve à chaque exécution.

#### 4.3 La vérification générique d'isolation

`verifierIsolation(table, fabriquer)` dans `src/server/db/outils-test/isolation.ts`, où `table` est un objet table de Drizzle portant `organisationId`, et `fabriquer(organisationId)` renvoie les valeurs d'une ligne valide de cette table (fourni par le test de chaque table, puisque les colonnes obligatoires diffèrent). Elle lève une erreur qui nomme le contrôle en échec, et résout sans valeur si tous passent.

Elle crée ses deux organisations, insère une ligne pour A et une pour B (chacune dans sa transaction), puis passe huit contrôles : les six de `scripts/verifier-isolation.mjs`, et deux ajoutés (décision 9).

| # | Contrôle | Attendu |
|---|---|---|
| 1 | Sans organisation active, compter les lignes des deux organisations | 0, sans erreur |
| 2 | Organisation A active, compter | 1 |
| 3 | Organisation A active, lire | La ligne lue porte l'`organisation_id` de A |
| 4 | Organisation A active, insérer une ligne pour B | Refus, code PostgreSQL `42501` |
| 5 | Organisation A active, modifier les lignes de B | 0 ligne modifiée |
| 6 | Après la transaction, sur **la même connexion**, compter | 0, sans erreur |
| 7 | Organisation A active, supprimer les lignes de B | 0 ligne supprimée, et la ligne de B existe toujours (relue dans une transaction de B) |
| 8 | Organisation A active, modifier sa propre ligne pour lui donner l'`organisation_id` de B | Refus, code `42501` (`WITH CHECK` s'applique aussi à `UPDATE`) |

Précisions :

- les comptages portent sur les lignes des deux organisations créées, pas sur la table entière, parce que d'autres tests peuvent écrire en parallèle ;
- le contrôle 6 exige la même connexion : la fonction utilise un `Pool` dédié d'une seule connexion, par `creerAcces` ;
- les requêtes sur une table quelconque utilisent l'objet table de Drizzle, jamais un nom de table concaténé (S-86) ;
- les insertions et modifications refusées (contrôles 4 et 8) se font chacune dans leur propre transaction, annulée par le refus ;
- le code d'erreur se lit par `codeDuRefus(promesse)`, exporté par le même fichier, qui parcourt la chaîne des `cause` (Drizzle enveloppe l'erreur de `pg`) et renvoie le code PostgreSQL, « aucun refus » si la promesse réussit, « aucun code » si l'erreur n'en porte pas.

La table témoin est la première à passer cette vérification. Chaque future table métier l'appellera dans son propre test d'intégration (`PLAN.md`, section 4.4, « Isolation par table »).

#### 4.4 Le test d'inventaire

Un test lit le catalogue de PostgreSQL (`pg_class`, `pg_attribute`, `pg_policies`, lisibles par le rôle de l'application) et vérifie que **toute table du schéma `public` qui porte une colonne `organisation_id`** :

- a cette colonne `NOT NULL` et de type `uuid` ;
- a une clé étrangère de cette colonne vers `organization.id`, en `ON DELETE RESTRICT` ;
- a sa règle activée (`relrowsecurity`) **et forcée** (`relforcerowsecurity`) ;
- a exactement une règle, nommée `isolation_organisation`, pour toutes les commandes et le rôle `public`, dont les expressions `USING` et `WITH CHECK` sont identiques à celles de `temoin_isolation`.

Il vérifie aussi que, sur `temoin_isolation`, les expressions `USING` et `WITH CHECK` sont identiques entre elles et contiennent `NULLIF(current_setting('app.organisation_id'`.

Une table créée plus tard sans le modèle, ou sans la migration de forçage, fait échouer la suite. Le test vérifie aussi qu'il trouve au moins `temoin_isolation`, pour ne pas réussir sur un catalogue vide.

Les tables de Better Auth portent `organization_id` (en anglais) et ne sont pas concernées, conformément à `DESIGN.md` section 2.5.

### 5. Le garde-fou contre `preview` et `production`

#### 5.1 Comment reconnaître la base sans lire de secret

Les trois branches de Neon ont des hôtes différents, et une branche recréée change d'hôte (c'est arrivé, `CONFIGURATION.md` étape 10). Le garde-fou ne peut donc pas s'appuyer sur l'hôte.

Retenu (décision 4) : **une marque posée dans la base de test elle-même, sous la forme d'un commentaire de base**.

- Pose, par le rôle propriétaire, sur la base visée : `COMMENT ON DATABASE <nom> IS 'environnement:test'`. Dans les scripts, le nom n'est pas écrit en dur ni concaténé en JavaScript : l'instruction passe par un bloc `DO` qui lit `current_database()` et forme l'instruction avec `format('COMMENT ON DATABASE %I IS %L', current_database(), 'environnement:test')`.
- Lecture, par le rôle de l'application : `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()`.
- Le garde-fou exige **exactement** la valeur `environnement:test`. Toute autre valeur (casse différente, espace, autre environnement), une valeur vide ou l'absence de commentaire est un refus. Il est fermé par défaut : une base sans marque est refusée.
- Vérifié par le développeur : la marque est posée et lue sur `dev`, et absente de `preview` et de `production`.

**Voie écartée : un paramètre de base (`ALTER DATABASE <nom> SET app.environnement = 'test'`)**, lu par `current_setting('app.environnement', true)`. C'était la recommandation du brouillon. Neon la refuse : sur `dev`, `neondb_owner` reçoit « permission denied to set parameter ». Le rôle propriétaire de Neon n'est pas super-utilisateur, et PostgreSQL réserve la pose d'un paramètre personnalisé au niveau de la base à un rôle qui en a reçu le droit (`GRANT SET ON PARAMETER`), droit que seul un super-utilisateur peut accorder. Le commentaire de base n'exige que d'être propriétaire de la base, ce que `neondb_owner` est, et il est lisible par tous les rôles. Il se distingue aussi d'un réglage : il ne modifie le comportement d'aucune connexion.

Limites, acceptées :

- la marque est copiée par une branche créée **depuis** `dev`. `preview` et `production` ne sont jamais créées depuis `dev` (`CONFIGURATION.md` étape 10 : elles le sont depuis `production`) ;
- une branche `dev` recréée depuis `production` n'a pas la marque : les tests refusent de tourner jusqu'à ce qu'elle soit reposée par `scripts/retablir-acces-dev.mjs`. C'est le comportement voulu ;
- une erreur humaine pourrait poser la marque sur `production`. Les deux scripts qui la posent refusent l'hôte de production (`retablir-acces-dev.mjs`) ou tout hôte autre que `localhost` (`preparer-base-test.mjs`).

Options écartées :

| Option | Raison de l'écarter |
|---|---|
| Liste noire des hôtes de `preview` et `production` | Ouverte par défaut : une nouvelle branche ou un hôte changé passe |
| Liste blanche des hôtes autorisés | L'hôte de `dev` change à chaque recréation de la branche. Publie l'identifiant du point d'accès |
| Paramètre de base `ALTER DATABASE ... SET` | Refusé par Neon (ci-dessus) |
| API de Neon pour connaître le nom de la branche | Exige une clé d'API, donc un secret de plus |
| Variable déclarative (`ENVIRONNEMENT=dev`) | Ne vérifie pas la base réellement visée : une adresse de `preview` copiée par erreur passe |

La requête du garde-fou porte deux contrôles de plus :

```sql
SELECT shobj_description(d.oid, 'pg_database') AS marque,
       current_user AS role,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS contourne
FROM pg_database d
WHERE d.datname = current_database()
```

Le garde-fou refuse si `marque` n'est pas exactement `environnement:test`, si `role` n'est pas `app_facturation`, ou si `contourne` n'est pas `false` (T-53).

#### 5.2 Où et quand il s'exécute

- Dans `src/server/db/outils-test/garde-base.ts` :
  - `deciderBaseDeTest(etat)`, fonction pure appliquée au résultat de la requête (`{ marque, role, contourne }`), qui lève l'erreur de refus ;
  - `verifierBaseDeTest()`, qui exécute la requête par `client.ts`, donc par la même adresse que les tests, puis appelle `deciderBaseDeTest`.
- Appelée par le fichier `setupFiles` du projet `integration` (`outils-test/preparation.ts`), avant le chargement de chaque fichier de test. Un refus fait échouer tous les tests du fichier, avant toute écriture. Coût : une requête par fichier.
- Message de refus : « Tests refusés : » suivi de la raison (« la base visée n'est pas marquée comme base de test », « le rôle de connexion n'est pas app_facturation », « le rôle de connexion contourne l'isolation »). Jamais l'hôte, le nom de la base, l'adresse, ni la valeur lue de la marque ou du rôle (S-54).
- Il n'y a aucun moyen de désactiver le garde-fou (ni variable, ni option).

### Alternatives écartées

Les options écartées de chaque difficulté figurent ci-dessus. S'y ajoutent :

| Alternative | Raison de l'écarter |
|---|---|
| Fixer l'organisation par `SET` de session, et la remettre à zéro à la fin | Une erreur entre les deux laisse la valeur sur la connexion, que le regroupement donne à une autre requête |
| Connexion directe de Neon (sans regroupement) pour l'application | Ne règle rien : la sûreté doit venir de la portée du réglage, pas de l'absence de regroupement. Et le nombre de connexions directes est limité |
| Fixer l'organisation par une fonction SQL `SECURITY DEFINER` | Un objet de plus en base, sans gain : `set_config` local suffit et n'exige aucun droit |
| Passer l'organisation à chaque requête par un filtre du code seulement | C'est la première barrière de S-04, pas la seconde. Le filtre du code reste exigé dans `requetes/`, en plus de la règle |
| Valider l'identifiant par une expression régulière écrite à la main | Zod est imposé par `docs/STACK.md` et déjà installé |
| PgBouncer dans la CI | Une image de conteneur de plus, donc une dépendance (décision 5). Le regroupement est prouvé sur `dev` seulement |

## Règles de sécurité et permissions

- Exigences de sécurité couvertes :
  - **S-01** : toute requête métier s'exécute dans une transaction liée à une seule organisation.
  - **S-04** : seconde barrière, la règle de la base, déclarée par un modèle unique et vérifiée sur chaque table par le test d'inventaire. La première barrière (filtre du code dans `requetes/`) arrive avec les premières tables métier.
  - **S-86** : l'identifiant est passé en paramètre lié ; les outils de test n'utilisent que les objets table de Drizzle.
  - **S-54** : les messages d'erreur (identifiant invalide, garde-fou) ne contiennent aucune valeur reçue ni aucune partie de l'adresse.
  - **S-83** : aucun secret dans le code ni les tests ; la marque de test n'en est pas un.
  - **NF-06** : chaque menace citée a un test qui tente de la réaliser.
  - Règles 2, 3, 4, 12 et 13 de `CLAUDE.md`.
- Menaces concernées :
  - **T-30** : une transaction de l'organisation A ne lit, ne modifie, ne supprime ni n'associe aucune ligne de B, même en visant son identifiant.
  - **T-53** : une requête sans organisation active ne voit aucune ligne ; le rôle utilisé est `app_facturation`, sans droit de contourner l'isolation ; toute table portant `organisation_id` a sa règle activée et forcée.
  - **T-74**, en partie : les tests ne peuvent pas écrire dans `preview` ni `production`.
- Matrice des droits : aucune ligne. Aucune action, aucune route.
- Tables créées : `temoin_isolation`, avec `organisation_id uuid NOT NULL`, clé étrangère vers `organization.id` en `ON DELETE RESTRICT`, règle `isolation_organisation` activée et forcée. Aucune table modifiée.

## Dépendances nouvelles

Aucune (règle 10). Sont utilisés des paquets déjà déclarés : `drizzle-orm`, `pg`, `zod` (dépendances), `dotenv`, `vitest`, `eslint` (dépendances de développement). `crypto.randomUUID()` vient de Node.js. Pas de PgBouncer en CI (décision 5).

## Migration

Deux migrations, dans cet ordre, relues avant `npm run db:migrate` :

1. Générée par `npm run db:generate` : création de `temoin_isolation`, de sa clé étrangère en `ON DELETE RESTRICT`, de `ENABLE ROW LEVEL SECURITY` et de la règle `isolation_organisation`. Lecture du SQL : vérifier l'expression exacte de la règle, la clause `TO public` (drizzle-kit l'écrit toujours ; elle équivaut à l'absence de clause, `public` étant la valeur par défaut de PostgreSQL), `NOT NULL` sur `organisation_id` et `ON DELETE RESTRICT`. Fait : `drizzle/20261008143530_shallow_kronos`, puis `drizzle/20261008143938_forcer-isolation-temoin` (créée vide par la commande, ligne collée par le développeur). Appliquées sur `dev` le 2026-10-08.
2. Créée par `npx drizzle-kit generate --custom --name forcer-isolation-temoin`, qui produit un fichier SQL vide. L'assistant indique la ligne exacte, le développeur la colle : `ALTER TABLE "temoin_isolation" FORCE ROW LEVEL SECURITY;`, seule instruction du fichier (décision 2).

Ordre de déploiement : la CI les applique sur sa base neuve ; puis `dev` en local ; puis `production` et `preview` par le workflow `migrations.yml`. Une table vide en production, sans effet sur l'application. Fait : CI verte sur la PR, puis `production` et `preview` migrées par le workflow et vérifiées.

La marque de test n'est **pas** une migration : une migration l'appliquerait aussi à `production`.

## Conséquences sur la CI et les scripts

### Job « Qualité » de `ci.yml`

Aucune étape ajoutée. `npm test` ne lance que le projet `unitaires`, qui comprend maintenant `client.test.ts`, `garde-base.attaque.test.ts` et `regles-import.test.ts`. Aucun test avec base n'y tourne. `npm run build` n'inclut pas `outils-test/`.

### Job « Base de données et bout en bout » de `ci.yml`

| Étape | Changement |
|---|---|
| `Préparer la base de test` | `scripts/preparer-base-test.mjs` pose en plus la marque `environnement:test` par `COMMENT ON DATABASE` (section 5.1). Le script refuse déjà tout hôte autre que `localhost` |
| `Appliquer les migrations` | Applique les deux nouvelles migrations |
| `Vérifier l'isolation entre organisations` | Inchangé : `scripts/verifier-isolation.mjs` reste dans la CI (décision 11). Il prouve l'isolation pour le rôle propriétaire sur une table créée hors de Drizzle |
| **Nouvelle étape** `Lancer les tests d'intégration`, après la précédente | `npm run test:integration` |
| Les autres | Inchangées |

**Limite (décision 5)** : le PostgreSQL de la CI n'a pas de regroupement de connexions. Les tests de concurrence y prouvent la portée du réglage et la réutilisation des connexions par le `Pool` de `pg`, pas le comportement de PgBouncer. Celui-ci n'est prouvé qu'en local sur `dev`, qui passe par le regroupement de Neon. Une régression propre au regroupement ne serait donc vue que par un lancement local de `npm run test:integration`, exigé avant de dire qu'une tâche touchant la base est terminée.

### Workflow `migrations.yml`

Inchangé. Il appliquera les deux migrations en production puis sur `preview`.

### Scripts du dossier `scripts/`

| Script | Effet |
|---|---|
| `preparer-base-test.mjs` | Pose la marque de test sur la base de la CI |
| `retablir-acces-dev.mjs` | Pose la marque de test sur `dev`, après le changement du mot de passe, par le rôle propriétaire déjà utilisé par le script (décision 6). Le script refuse déjà le serveur de production |
| `verifier-isolation.mjs` | Inchangé, reste dans la CI (décision 11) |
| Les autres | Inchangés |

### Documents

- `CLAUDE.md` : commandes (`npm run test:integration`) ; « avant de dire qu'une tâche est terminée », ajout de `npm run test:integration` quand la base est concernée ; l'exception bornée à la règle sur `drizzle/` (section 2.2) ; la règle 3 renvoie au modèle de `schema/isolation.ts` au lieu du script.
- `docs/PLAN.md` section 4.1 et `docs/STRUCTURE.md` section 6 : convention `*.integration.test.ts` (fait à la validation de la fiche).
- `docs/STRUCTURE.md` section 3.1 : `schema/isolation.ts`, `outils-test/`.
- `docs/CONFIGURATION.md` : pose de la marque sur `dev` par `retablir-acces-dev.mjs`, commande `npm run test:integration`.

## Critères d'acceptation

- [x] `executerDansOrganisation` fixe l'organisation par `set_config('app.organisation_id', $1, true)` en première instruction de la transaction, l'identifiant en paramètre lié.
- [x] `grep -rnE "SET( LOCAL)? app\.|set_config\([^)]*false" src/` ne trouve rien.
- [x] Un identifiant invalide lève `OrganisationActiveInvalide`, au message fixe, sans `cause`, sans la valeur, et sans qu'aucune connexion soit prise.
- [x] Sans organisation fixée, une lecture de `temoin_isolation` par `db` renvoie zéro ligne sans erreur, sur une connexion neuve (réglage `NULL`) comme après une transaction (réglage `''`) ; une insertion est refusée par `42501` ; aucune erreur `22P02`.
- [x] Après une transaction, réussie ou annulée, la connexion rendue au `Pool` n'a plus d'organisation active.
- [x] Deux transactions simultanées sur deux organisations ne voient chacune que leurs lignes.
- [x] `temoin_isolation` est déclarée uniquement avec `colonneOrganisation()` et `regleIsolation()`, et sa règle est activée et forcée en base.
- [x] La clé étrangère du modèle est en `ON DELETE RESTRICT` : supprimer une organisation qui a une ligne dans `temoin_isolation` est refusé.
- [x] `verifierIsolation` passe sur `temoin_isolation` (huit contrôles).
- [x] Le test d'inventaire passe, et échoue si l'on retire temporairement le forçage d'une table (vérification manuelle, annulée ensuite). Vérifié par le développeur sur `dev` : avec `NO FORCE` sur `temoin_isolation` (`relforcerowsecurity = false`), les tests d'intégration donnent 1 failed, 31 passed ; après rétablissement de `FORCE`, tout repasse, et `relrowsecurity` et `relforcerowsecurity` valent `true`.
- [x] `creerDeuxOrganisations` produit des identifiants différents à chaque appel, des `slug` préfixés par `test-`, et `nettoyer` ne laisse aucune ligne, y compris quand le test échoue.
- [x] Les tests d'intégration refusent de s'exécuter sur une base sans la marque exacte `environnement:test`, avec un rôle autre que `app_facturation`, ou avec un rôle qui contourne l'isolation. Le message ne contient ni hôte, ni nom de base, ni adresse, ni valeur lue.
- [x] `preparer-base-test.mjs` pose la marque. Prouvé par la CI de la PR : la marque posée, le garde-fou l'accepte et les tests d'intégration réussissent.
- [ ] `retablir-acces-dev.mjs` pose la marque. Code ajouté, syntaxe vérifiée (`node --check`) ; jamais exécuté. À prouver à la prochaine recréation de `dev`.
- [x] `npm test` ne lance aucun fichier `*.integration.test.ts` et réussit sans base.
- [x] `npm run test:integration` réussit en CI et en local sur `dev`. `dev` : prouvé le 2026-10-08 (5 fichiers, 32 tests réussis et 1 échec volontaire attendu). CI : verte sur la PR.
- [x] `production` puis `preview` migrées par le workflow `migrations.yml`, et vérifiées : `temoin_isolation` existe, règle activée et forcée, 10 tables accessibles au rôle de l'application.
- [x] `scripts/verifier-isolation.mjs` reste une étape de la CI.
- [x] ESLint refuse l'import de `src/server/db/outils-test/` depuis un fichier qui n'est pas un test, et l'import de `db` hors de `src/server/auth/config.ts` et de `src/server/db/`.
- [x] `grep -rn "process.env" src/` ne trouve toujours que `src/server/env.ts` ; `grep -rn "DATABASE_URL_MIGRATION" src/` ne trouve rien.
- [x] Tout nouveau fichier de `src/server/`, hors de `schema/`, commence par `import "server-only";`.
- [x] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` passent.

## Tests à écrire

Toutes les valeurs sont factices ou aléatoires. Aucun test n'utilise d'identifiant fixe pour une organisation.

### Tests unitaires

Fichier : `src/server/db/client.test.ts` (sans base : la validation a lieu avant toute connexion ; `env` est remplacé par une valeur factice).

- [x] Chaîne vide, texte quelconque, nombre, `undefined`, `null`, UUID entouré d'espaces, UUID en majuscules entouré d'espaces, `11111111-1111-1111-1111-111111111111` : `OrganisationActiveInvalide`, et `travail` n'est jamais appelé.
- [x] Le message de l'erreur est exactement le message fixe ; ni le message, ni `String(erreur)`, ni `JSON.stringify(erreur)` ne contiennent la valeur reçue ; aucune propriété `cause`.
- [x] Aucune connexion n'est demandée au `Pool` (`Pool` factice passé à `creerAcces`).

Fichier : `src/server/db/outils-test/garde-base.attaque.test.ts` (fonction pure `deciderBaseDeTest`).

- [x] Marque `environnement:test`, rôle `app_facturation`, `contourne = false` : accepté.
- [x] Marque absente, vide, `environnement:Test`, `environnement:test ` (espace), ` environnement:test`, `environnement:production`, `environnement:preview`, `test` : refus, raison « marque ».
- [x] Rôle `neondb_owner` ou `postgres` : refus, raison « rôle ».
- [x] `contourne = true` ou `null` : refus, raison « contourne ».
- [x] Le message commence par « Tests refusés : » et ne contient ni la marque lue, ni le rôle lu.

Fichier : `src/server/db/regles-import.test.ts` (ESLint par son API, sur du code fourni en texte, sans écrire de fichier).

- [x] Import statique ou dynamique de `outils-test/` depuis un fichier de l'application (`src/app/`, `src/server/db/requetes/`) : erreur `no-restricted-imports` ou `no-restricted-syntax`.
- [x] Le même import depuis un fichier `*.test.ts`, `*.integration.test.ts`, ou depuis un fichier de `outils-test/` : aucune erreur.
- [x] `import { db }`, `import * as client`, `export { db } from` de `client.ts` depuis `src/server/services/` ou `src/app/` : erreur.
- [x] `import { executerDansOrganisation }` depuis `src/server/services/` : aucune erreur.
- [x] `import { db }` depuis `src/server/auth/config.ts` et depuis `src/server/db/requetes/` : aucune erreur.

### Tests d'intégration

Fichier : `src/server/db/client.integration.test.ts`.

- [x] Dans la transaction, `current_setting('app.organisation_id')` vaut l'identifiant fourni.
- [x] La valeur renvoyée par `travail` est renvoyée par la fonction.
- [x] Une exception dans `travail` annule les écritures de la transaction et remonte telle quelle.
- [x] Après la transaction, réussie ou annulée, sur la même connexion (`Pool` d'une connexion), `current_setting('app.organisation_id', true)` vaut `''` ou `NULL`.
- [x] Sans organisation fixée, sur une connexion neuve (`NULL`), après une transaction, et avec le réglage fixé explicitement à `''` dans une transaction (le regroupement de Neon ne garantit pas que la requête suivant une transaction tombe sur la même connexion du serveur) : lecture de `temoin_isolation` = 0 ligne sans erreur ; insertion refusée par `42501`, jamais `22P02`.

Fichier : `src/server/db/schema-isolation.integration.test.ts`.

- [x] `verifierIsolation(temoinIsolation, ...)` : les huit contrôles passent.
- [x] Test d'inventaire (section 4.4).
- [x] Supprimer une organisation qui a une ligne dans `temoin_isolation` : refus `23001` (`restrict_violation`, `ON DELETE RESTRICT`). Ce code dépend de la version : PostgreSQL 18 renvoie `23001` pour une clé en `ON DELETE RESTRICT` ; les versions antérieures renvoyaient `23503` (`foreign_key_violation`) dans les deux cas, `RESTRICT` comme `NO ACTION`. Les quatre bases (`dev`, `preview`, `production`, CI) sont en version 18. Le test, qui attend `23001`, prouve donc que la clé est en `RESTRICT` et pas seulement qu'elle existe.

Fichier : `src/server/db/outils-test/outils-test.integration.test.ts`.

- [x] Deux appels à `creerDeuxOrganisations` donnent quatre identifiants distincts, et des `slug` préfixés par `test-`.
- [x] Après `nettoyer`, les organisations et leurs lignes de `temoin_isolation` ont disparu.
- [x] `nettoyer` appelé deux fois ne lève pas d'erreur.
- [x] Un test qui échoue volontairement (`test.fails`) après avoir créé des organisations et des lignes, `nettoyer` enregistré par `onTestFinished` : le test suivant constate qu'elles ont disparu.
- [x] Le garde-fou accepte la base marquée de la CI et de `dev`. `dev` : prouvé. CI : prouvé sur la PR.

### Tests de concurrence

Fichier : `src/server/db/client.concurrence.integration.test.ts`.

- [x] **Deux transactions simultanées, deux organisations.** A et B ouvrent chacune une transaction ; une barrière en JavaScript attend que les deux aient fixé leur organisation avant que l'une ou l'autre lise ; chacune lit, écrit, relit, puis valide. Chacune ne voit que ses lignes, et le chevauchement est prouvé par la barrière (pas par une attente fixe).
- [x] **Réutilisation de la connexion.** `Pool` d'une seule connexion : transaction de A validée, puis requête sans organisation : 0 ligne. Même chose après une transaction de A annulée par une exception.
- [x] **Alternance sur un petit `Pool`.** Quarante transactions lancées ensemble, alternant A et B, sur un `Pool` de trois connexions : chacune ne voit que les lignes de son organisation, et une requête sans organisation après coup n'en voit aucune.
- [x] Ces tests, lancés en local sur `dev`, traversent le regroupement de Neon. En CI, ils ne prouvent que le comportement de PostgreSQL et du `Pool` (décision 5).

### Tests d'attaque

Les quatre tests d'attaque obligatoires du modèle (sans session, autre organisation par une action, rôle non autorisé, entrée falsifiée par un utilisateur) ne s'appliquent pas tels quels : la fonctionnalité n'expose ni route ni action. Les tests ci-dessous visent les menaces de la fiche.

Fichier : `src/server/db/client.attaque.integration.test.ts`.

- [x] T-30 : organisation A active, lecture filtrée sur l'identifiant d'une ligne de B : aucune ligne.
- [x] T-30 : organisation A active, insertion d'une ligne pour B : refus `42501`.
- [x] T-30 : organisation A active, modification et suppression des lignes de B : 0 ligne, et la ligne de B est intacte.
- [x] T-30 : organisation A active, déplacement de sa propre ligne vers B par `UPDATE` : refus `42501`.
- [x] T-53 : requête par `db`, sans organisation active : 0 ligne ; insertion refusée.
- [x] T-53 : le rôle de la connexion est `app_facturation`, sans `BYPASSRLS`.
- [x] Valeur qui tenterait une injection si elle était concaténée (`00000000-0000-4000-8000-000000000000' OR '1'='1`) : refusée par la validation. Puis, la validation contournée par un appel direct à `set_config` avec cette valeur en paramètre lié : la conversion `::uuid` échoue (`22P02`) et aucune ligne n'est renvoyée.

Le risque qu'un code disposant de `tx` exécute lui-même `set_config` vers une autre organisation n'a pas de test ici : Drizzle laisse `execute` disponible sur toute transaction. Il est reporté à la 0.4 (voir « Reporté »).

Les tests d'attaque du garde-fou sont des tests unitaires (`garde-base.attaque.test.ts`, ci-dessus) : ils portent sur la fonction pure de décision et n'ont pas besoin d'une base non marquée.

### Tests de bout en bout

- [x] Aucun. Aucune page, aucune route.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/db/schema/isolation.ts`
- `src/server/db/outils-test/organisations.ts`
- `src/server/db/outils-test/isolation.ts`
- `src/server/db/outils-test/garde-base.ts`
- `src/server/db/outils-test/preparation.ts` (fichier `setupFiles` du projet `integration`)
- `src/server/db/client.test.ts`
- `src/server/db/client.integration.test.ts`
- `src/server/db/client.concurrence.integration.test.ts`
- `src/server/db/client.attaque.integration.test.ts`
- `src/server/db/schema-isolation.integration.test.ts`
- `src/server/db/regles-import.test.ts`
- `src/server/db/outils-test/outils-test.integration.test.ts`
- `src/server/db/outils-test/garde-base.attaque.test.ts`
- `drizzle/<horodatage>_<nom>/` : deux migrations, la seconde créée vide par drizzle-kit et remplie par le développeur

Modifiés :

- `src/server/db/client.ts` : `creerAcces`, `executerDansOrganisation`, `TransactionOrganisation`, `OrganisationActiveInvalide`
- `src/server/db/schema/technique.ts` : `temoin_isolation`
- `vitest.config.mts` : projets `unitaires` et `integration`, lecture de `.env.local` pour le second
- `package.json` : scripts `test`, `test:watch`, `test:integration`
- `eslint.config.mjs` : import de `outils-test/` réservé aux tests, import de `db` réservé à `auth/config.ts` et `db/`
- `scripts/preparer-base-test.mjs`, `scripts/retablir-acces-dev.mjs` : marque de test
- `.github/workflows/ci.yml` : étape « Lancer les tests d'intégration »
- `CLAUDE.md`, `docs/PLAN.md`, `docs/STRUCTURE.md`, `docs/CONFIGURATION.md` : voir « Documents »
- `docs/features/acces-donnees.md` : statut

## Reporté

### À la fonctionnalité 0.3 (journal d'audit)

- La table `journal_audit` utilise `colonneOrganisation()` et `regleIsolation()`, et passe `verifierIsolation`. Ses contrôles 5, 7 et 8 (modification, suppression, déplacement) rencontreront un refus de droit plutôt qu'un résultat vide : la vérification générique devra accepter l'un ou l'autre, ou recevoir une option « ajout seul ».
- La fonction d'écriture au journal reçoit la `TransactionOrganisation` de l'action, pour que l'action et sa trace réussissent ou échouent ensemble (S-70).
- Le retrait des droits `UPDATE` et `DELETE` au rôle de l'application sur cette table.

### À la fonctionnalité 0.4 (chaîne de contrôles)

- L'origine de l'identifiant : lu dans la session, après vérification de l'adhésion. La 0.2 ne vérifie que son format.
- La traduction des erreurs (`OrganisationActiveInvalide`, refus `42501`) en réponse « introuvable » (S-02).
- La garantie qu'un service ne reçoit qu'une `TransactionOrganisation` et n'ouvre pas lui-même de transaction, ni n'en imbrique une seconde (risque d'épuisement du `Pool`).
- Le risque résiduel qu'un code qui dispose de `tx` exécute un `set_config` vers une autre organisation : à traiter par l'analyse du code (interdiction de `app.organisation_id` hors de `client.ts`) ou à consigner dans `docs/EXCEPTIONS-SECURITE.md`.

### Plus tard

- 0.8 (contrôle après déploiement) pourra s'appuyer sur `temoin_isolation` : une lecture sans organisation active en production doit renvoyer 0 ligne.
- Retirer le droit `TEMPORARY` sur la base au rôle de l'application (`REVOKE TEMPORARY ON DATABASE ... FROM PUBLIC`) : une table temporaire appartient au rôle qui la crée et échappe aux règles non forcées. Durcissement à proposer dans sa propre fiche.

## Décisions

1. **Type des identifiants.** U1 : identifiants `uuid` partout. Livré par `docs/features/identifiants-uuid.md`, déployé sur `dev`, `preview` et `production`.
2. **Forçage de la règle.** Migration `drizzle-kit generate --custom` acceptée, pour `FORCE ROW LEVEL SECURITY` uniquement. L'assistant crée le fichier vide par la commande et indique la ligne exacte ; le développeur la colle. L'assistant n'écrit jamais dans `drizzle/`.
3. **Table témoin.** `temoin_isolation` acceptée, présente en production.
4. **Marque de la base de test.** `ALTER DATABASE ... SET` est refusé par Neon (« permission denied to set parameter », vérifié sur `dev`). La marque est un commentaire de base, `COMMENT ON DATABASE <nom> IS 'environnement:test'`, posé par le rôle propriétaire, lu par `shobj_description(oid, 'pg_database')`. Vérifié : posée et lue sur `dev`, absente de `preview` et de `production`. Le garde-fou exige exactement cette valeur ; toute autre valeur, ou son absence, est un refus.
5. **Regroupement de connexions en CI.** Pas de PgBouncer en CI. Le regroupement n'est prouvé que sur `dev` ; la limite est notée.
6. **Pose de la marque.** Ajoutée à `scripts/retablir-acces-dev.mjs` et à `scripts/preparer-base-test.mjs`.
7. **Lignes laissées par un test interrompu.** Pas de script de balayage. Les organisations de test gardent un `slug` préfixé par `test-`.
8. **Suppression d'une organisation.** `ON DELETE RESTRICT` partout, table témoin comprise. L'outillage nettoie les lignes avant l'organisation.
9. **Contrôles supplémentaires.** Contrôles 7 (suppression chez B) et 8 (déplacement vers B) ajoutés.
10. **Usage de `db`.** Règle ESLint dès la 0.2 : `db` ne s'importe que dans `src/server/auth/config.ts` et `src/server/db/`.
11. **`scripts/verifier-isolation.mjs`.** Reste dans la CI.
12. **Convention de nom.** `*.integration.test.ts` validée ; `PLAN.md` et `STRUCTURE.md` mis à jour.

Exigences ajoutées à la validation :

- Sans organisation fixée, une lecture renvoie zéro ligne sans erreur, et une écriture est refusée. Aucune erreur de conversion sur une valeur vide (section 1.3).
- Règle ESLint : l'outillage de test ne s'importe que depuis un fichier de test (section 4.1).

Choix faits en rédigeant les tests, à confirmer à la relecture :

- Le test du modèle est placé dans `src/server/db/schema-isolation.integration.test.ts`, et non dans `schema/`, que drizzle-kit charge en entier.
- Les tests du garde-fou portent sur une fonction pure : ils deviennent des tests unitaires (`garde-base.attaque.test.ts`), lancés par `npm test`.
- Les règles ESLint sont vérifiées par un test (`regles-import.test.ts`), qui utilise l'API d'`eslint`, déjà installé.
