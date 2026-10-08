# Fonctionnalité : accès aux données

Statut : brouillon

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

Ce point conditionne toute la fiche, et doit être tranché avant la validation (question ouverte n° 1).

`docs/DESIGN.md` et `scripts/verifier-isolation.mjs` supposent des identifiants `uuid`, et la règle convertit le réglage en `::uuid`. Or les tables de Better Auth sont générées avec des identifiants `text` (`organization.id text PRIMARY KEY`), produits par le générateur par défaut de Better Auth, qui ne fabrique pas des UUID. Deux conséquences :

- une clé étrangère `organisation_id uuid` vers `organization.id text` est impossible : PostgreSQL exige des types compatibles ;
- la conversion `::uuid` d'un identifiant de Better Auth échouerait.

| Option | Effet | Coût |
|---|---|---|
| **U1. Identifiants `uuid` partout** : `advanced.database.generateId: "uuid"` dans la configuration de Better Auth (option présente dans la version 1.7.7, qui génère alors `uuid("id").default(gen_random_uuid())` pour PostgreSQL) | Conforme à `DESIGN.md` et au script. Validation stricte possible (format UUID). Clé étrangère `uuid` vers `uuid` | Régénérer `auth.ts` (procédure des « Pièges connus »), migration qui change le type des colonnes `id` et des clés étrangères de huit tables. À vérifier : que le générateur convertit aussi les colonnes de référence (`organization_id`, `user_id`), et que les tables ne contiennent aucune ligne à identifiant non UUID |
| U2. Identifiants `text` | Aucune migration des tables de Better Auth | Règle comparant des `text`, validation d'un format propre à Better Auth (non documenté comme stable), `DESIGN.md` à corriger |
| U3. `organisation_id uuid` sans clé étrangère vers `organization` | Aucune migration de Better Auth | Perd la contrainte de `DESIGN.md` section 2.4 (S-01, T-30). Écartée |

**Recommandation : U1**, dans une petite fiche préalable dédiée (« identifiants UUID »), livrée avant la 0.2, parce qu'elle touche un fichier généré et les migrations de Better Auth, hors du périmètre de l'accès aux données. La suite de cette fiche suppose U1. Si U2 est retenue, les sections 1.4, 2 et les tests de validation de l'identifiant changent.

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

- `current_setting('app.organisation_id', true)` vaut `NULL` (jamais fixé sur cette connexion) ou `''` (fixé puis rétabli) ; `NULLIF` ramène les deux à `NULL` ;
- la condition `organisation_id = NULL` n'est jamais vraie : **aucune ligne visible**, aucune ligne modifiée ni supprimée ;
- une insertion est **refusée** par `WITH CHECK` (erreur PostgreSQL `42501`).

C'est le comportement attendu par T-53 : « une requête sans contexte d'organisation ne renvoie aucune ligne ». Il est prouvé par les contrôles 1 et 6 (section 4.3).

`db` reste exporté pour Better Auth, dont les tables ne portent pas de règle (`docs/DESIGN.md`, section 2.5). L'interdiction d'importer `db` ailleurs que dans `src/server/auth/config.ts` et `client.ts` est la question ouverte n° 10.

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

- `colonneOrganisation()` : `uuid("organisation_id").notNull().references(() => organization.id, { onDelete: ... })` (comportement à la suppression : question ouverte n° 8) ;
- `regleIsolation()` : un `pgPolicy("isolation_organisation", ...)` pour toutes les commandes (`for: "all"`), sans clause `to`, donc pour tous les rôles, avec :

```sql
USING      (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)
WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)
```

Une table métier se déclare avec `pgTable.withRLS(...)`, `colonneOrganisation()` et `regleIsolation()`. L'expression est la même que celle du script, à l'identique.

#### 2.2 Le forçage n'est pas généré par Drizzle

Vérifié dans `node_modules/drizzle-kit` (version 1.0.0-rc.4) : l'outil ne produit que `ENABLE` ou `DISABLE ROW LEVEL SECURITY`, jamais `FORCE`. La règle 3 de `CLAUDE.md` exige pourtant une règle « activée et forcée ». Sans forçage, le propriétaire des tables (`neondb_owner`, utilisé par les migrations et les scripts) n'est pas soumis à la règle.

| Option | Avantage | Inconvénient |
|---|---|---|
| **F1. Migration personnalisée** : `npx drizzle-kit generate --custom --name forcer-isolation-<table>`, qui crée un fichier SQL vide, puis y écrire `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` | Dans la chaîne normale des migrations, appliquée partout par le workflow | Écrire dans un fichier de `drizzle/`, contraire à « ne modifie jamais le dossier `drizzle/` à la main ». Demande une exception écrite et bornée |
| F2. Ne pas forcer | Rien à faire | Contraire à la règle 3. Écartée |
| F3. Déclencheur sur événement qui force la règle de toute table créée | Automatique | Exige un super-utilisateur, non garanti chez Neon. Écartée |
| F4. Forçage par un script de `scripts/` après chaque migration | Pas de fichier écrit à la main dans `drizzle/` | Étape hors du workflow des migrations, facile à oublier en production. Écartée |

**Recommandation : F1, complétée par le test d'inventaire de la section 4.4**, qui échoue si une table portant `organisation_id` n'est pas forcée. L'exception à la règle sur `drizzle/` serait limitée aux migrations créées par `--custom` et ne contenant que des `FORCE ROW LEVEL SECURITY` (question ouverte n° 2).

#### 2.3 Sur quoi prouver le modèle

Aucune table métier n'existe, et le rôle de l'application ne peut pas créer de table.

| Option | Avantage | Inconvénient |
|---|---|---|
| **P1. Une table témoin permanente, créée par migration avec le modèle** : `temoin_isolation (id uuid, organisation_id, valeur text)`, dans `schema/technique.ts` | Prouve toute la chaîne réelle : modèle Drizzle, SQL généré et relu, migration appliquée, droits par défaut, règle forcée, six contrôles par le rôle de l'application. Sert de référence au test d'inventaire (section 4.4) | Une table sans sens métier en production, vide. Le rôle de l'application y a les droits ordinaires |
| P2. Table créée pendant les tests par le rôle propriétaire | Rien en production | Les tests devraient connaître `DATABASE_URL_MIGRATION` : contraire à la règle 2 et à `STRUCTURE.md` section 5. Ne prouve pas le SQL généré par Drizzle. Écartée |
| P3. Table temporaire (`CREATE TEMP TABLE`) créée par le rôle de l'application | Rien en production, aucun rôle propriétaire | Ne passe pas par Drizzle ni par les migrations. Une table temporaire est liée à la session : avec le regroupement de Neon, elle peut disparaître entre deux transactions, ce qui fausse le contrôle 6. Dépend du droit `TEMPORARY`, qu'il vaudrait mieux retirer (voir « Suites »). Écartée |
| P4. Attendre la table du journal d'audit (0.3) | Pas de table sans usage | La 0.2 serait livrée sans preuve. Le journal est en ajout seul : le contrôle 5 (modification) y rencontre un refus de droit, pas un résultat vide. Écartée |

**Recommandation : P1** (question ouverte n° 3). La table témoin ne reçoit de lignes que des tests, sur `dev` et en CI.

### 3. La séparation des tests sans base et avec base

| Option | Avantage | Inconvénient |
|---|---|---|
| **N1. Suffixe de fichier** : `*.integration.test.ts` pour tout test qui touche la base, y compris les tests d'attaque (`client.attaque.integration.test.ts`) | Visible dans le nom, sélection par motif, conforme au niveau « Intégration » de `PLAN.md` section 4.1. Les tests d'attaque restent comptables par `*.attaque*.test.ts` | Suffixe composé un peu long |
| N2. Dossier séparé | Simple à sélectionner | Contraire à « à côté du fichier testé » (`STRUCTURE.md` section 6). Écartée |
| N3. Sauter les tests quand la base est absente (`describe.skipIf`) | Un seul motif | Une base absente ou mal configurée donne une suite verte qui n'a rien testé. Écartée |

**Recommandation : N1**, avec deux projets Vitest (`test.projects`, présent dans Vitest 5) dans `vitest.config.mts` :

| Projet | Fichiers | Particularités |
|---|---|---|
| `unitaires` | `src/**/*.test.ts`, sauf `src/**/*.integration.test.ts` | Inchangé par rapport à aujourd'hui. Ne reçoit aucune variable de `.env.local` |
| `integration` | `src/**/*.integration.test.ts` | `setupFiles` : le garde-fou (section 5). `test.env` : les variables de `.env.local` (section 4.1) |

Scripts de `package.json` :

| Script | Commande | Base |
|---|---|---|
| `test` | `vitest run --project unitaires` | Non |
| `test:watch` | `vitest --project unitaires` | Non |
| `test:integration` | `vitest run --project integration` | Oui |

Le nom de `npm test` ne change pas : le job « Qualité » et l'habitude restent valables.

### 4. L'outillage de test

#### 4.1 Emplacement, et adresse de la base sans `process.env`

| Option | Avantage | Inconvénient |
|---|---|---|
| **L1. Dans `src/server/db/outils-test/`**, en passant par `client.ts`, donc par `env.ts` | Les tests exercent la vraie fonction et le vrai `Pool`. Drizzle reste confiné à `src/server/db/` (règle 4). Aucun `process.env` hors de `env.ts` (règle 12) | Du code de test dans `src/`, qu'il faut empêcher d'importer depuis l'application |
| L2. Dans `tests/` à la racine, avec `pg` et `process.env` comme les scripts | Hors du champ d'ESLint | Une seconde connexion, qui ne teste pas la vraie fonction. Contourne l'esprit des règles 4 et 12. Écartée |

**Recommandation : L1.**

- L'adresse vient de `env.DATABASE_URL`, lue par `env.ts`. `env.ts` valide aussi `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` : les trois variables doivent être présentes.
- **En local**, Vitest ne charge pas `.env.local` dans `process.env`. `vitest.config.mts` (à la racine, hors de `src/`, donc hors de la règle 12) lit `.env.local` avec `dotenv` dans un objet séparé (`config({ path: ".env.local", processEnv: {}, quiet: true })`, option `processEnv` présente dans la version installée), et le passe au seul projet `integration` par `test.env`. Le projet `unitaires` ne reçoit rien. Ni l'assistant ni le code n'affichent ces valeurs.
- **En CI**, `.env.local` n'existe pas : les variables viennent de l'environnement du job.
- Un fichier de `outils-test/` ne se termine pas par `.test.ts` : Vitest ne l'exécute pas, et aucune page ne l'important, `next build` ne l'inclut pas.
- Une règle ESLint (`no-restricted-imports`) interdit d'importer `src/server/db/outils-test/` depuis un fichier qui n'est pas un test (`*.test.ts`) ni un fichier de ce dossier : ces fonctions suppriment des organisations.

#### 4.2 Deux organisations aux identifiants aléatoires, et leur nettoyage

`creerDeuxOrganisations()` dans `src/server/db/outils-test/organisations.ts` :

- insère deux lignes dans `organization` (table de Better Auth, sans règle), avec `id` = `crypto.randomUUID()`, `slug` = `test-<identifiant>`, `name` = `Test <identifiant>`, `created_at` = maintenant ;
- renvoie `{ a, b, nettoyer }`.

`nettoyer()` :

- pour chaque organisation, supprime ses lignes des tables métier qu'on lui indique, dans `executerDansOrganisation` (la règle interdit de le faire sans contexte), puis supprime l'organisation ;
- ne lève pas d'erreur si une suppression ne trouve rien, pour pouvoir être appelée deux fois ;
- ne cible que les deux identifiants créés, jamais un motif (`slug LIKE 'test-%'`) : un test ne supprime que ce qu'il a créé.

Utilisation obligatoire : `nettoyer` est enregistré dès la création par `onTestFinished` (ou `afterAll` pour un fichier entier), de sorte qu'un test en échec nettoie aussi. Un processus tué laisse des lignes : voir la question ouverte n° 7.

#### 4.3 La vérification générique d'isolation

`verifierIsolation(table, fabriquer)` dans `src/server/db/outils-test/isolation.ts`, où `table` est un objet table de Drizzle portant `organisation_id`, et `fabriquer(organisationId)` renvoie les valeurs d'une ligne valide de cette table (fourni par le test de chaque table, puisque les colonnes obligatoires diffèrent).

Elle crée ses deux organisations, insère une ligne pour A et une pour B (chacune dans sa transaction), puis reprend les six contrôles de `scripts/verifier-isolation.mjs` :

| # | Contrôle | Attendu |
|---|---|---|
| 1 | Sans organisation active, compter les lignes des deux organisations | 0 |
| 2 | Organisation A active, compter | 1 |
| 3 | Organisation A active, lire | La ligne lue porte l'`organisation_id` de A |
| 4 | Organisation A active, insérer une ligne pour B | Refus, code PostgreSQL `42501` |
| 5 | Organisation A active, modifier les lignes de B | 0 ligne modifiée |
| 6 | Après la transaction, sur **la même connexion**, compter | 0 |

Proposé en plus, au même titre (question ouverte n° 9) :

| # | Contrôle | Attendu |
|---|---|---|
| 7 | Organisation A active, supprimer les lignes de B | 0 ligne supprimée, et la ligne de B existe toujours |
| 8 | Organisation A active, modifier sa propre ligne pour lui donner l'`organisation_id` de B | Refus, code `42501` (`WITH CHECK` s'applique aussi à `UPDATE`) |

Précisions :

- les comptages portent sur les lignes des deux organisations créées, pas sur la table entière, parce que d'autres tests peuvent écrire en parallèle ;
- le contrôle 6 exige la même connexion : la fonction utilise un `Pool` dédié d'une seule connexion. `client.ts` expose pour cela une fabrique interne (`creerAcces(pool)`), dont `executerDansOrganisation` est l'instance liée au `Pool` principal ;
- les requêtes sur une table quelconque utilisent l'objet table de Drizzle, jamais un nom de table concaténé (S-86) ;
- l'insertion refusée du contrôle 4 se fait sous un point de sauvegarde, comme dans le script, pour que la transaction continue.

La table témoin est la première à passer cette vérification. Chaque future table métier l'appellera dans son propre test d'intégration (`PLAN.md`, section 4.4, « Isolation par table »).

#### 4.4 Le test d'inventaire

Un test lit le catalogue de PostgreSQL (`pg_class`, `pg_attribute`, `pg_policies`, lisibles par le rôle de l'application) et vérifie que **toute table du schéma `public` qui porte une colonne `organisation_id`** :

- a cette colonne `NOT NULL` et de type `uuid` ;
- a sa règle activée (`relrowsecurity`) **et forcée** (`relforcerowsecurity`) ;
- a exactement une règle, nommée `isolation_organisation`, pour toutes les commandes, dont les expressions `USING` et `WITH CHECK` sont identiques à celles de `temoin_isolation`.

Une table créée plus tard sans le modèle, ou sans la migration de forçage, fait échouer la suite. Le test vérifie aussi qu'il trouve au moins `temoin_isolation`, pour ne pas réussir sur un catalogue vide.

Les tables de Better Auth portent `organization_id` (en anglais) et ne sont pas concernées, conformément à `DESIGN.md` section 2.5.

### 5. Le garde-fou contre `preview` et `production`

#### 5.1 Comment reconnaître la base sans lire de secret

Les trois branches de Neon ont des hôtes différents, et une branche recréée change d'hôte (c'est arrivé, `CONFIGURATION.md` étape 10).

| Option | Avantage | Inconvénient |
|---|---|---|
| G1. Liste noire des hôtes de `preview` et `production`, écrite dans le dépôt | Simple | Ouverte par défaut : une nouvelle branche ou un hôte changé passe. Écartée |
| G2. Liste blanche des hôtes autorisés (`localhost`, hôte de `dev`), écrite dans le dépôt | Fermée par défaut | L'hôte de `dev` change à chaque recréation de la branche : modification du dépôt à chaque fois. Publie l'identifiant du point d'accès |
| **G3. Marque posée dans la base de test elle-même** : `ALTER DATABASE <base> SET app.environnement = 'test'`, exécuté une fois par le rôle propriétaire sur `dev` et sur la base de la CI. Le garde-fou lit `current_setting('app.environnement', true)` par le rôle de l'application | Fermée par défaut : une base sans marque est refusée. Indépendante des hôtes. Ne lit aucun secret : la valeur n'en est pas un | La marque est copiée par une branche créée **depuis** `dev`. Une erreur humaine pourrait la poser sur `production` |
| G4. API de Neon pour connaître le nom de la branche | Exact | Exige une clé d'API, donc un secret de plus. Écartée |
| G5. Variable déclarative (`ENVIRONNEMENT=dev`) | Simple | Ne vérifie pas la base réellement visée : une adresse de `preview` copiée par erreur passe. Écartée |

**Recommandation : G3**, avec deux contrôles de plus dans la même requête :

```sql
SELECT current_setting('app.environnement', true) AS environnement,
       current_user AS role,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS contourne
```

Le garde-fou refuse si `environnement` n'est pas exactement `test`, si `role` n'est pas `app_facturation`, ou si `contourne` n'est pas `false` (T-53).

Conditions de la recommandation :

- `preview` et `production` ne sont jamais créées depuis `dev` (`CONFIGURATION.md` étape 10 : elles le sont depuis `production`) ;
- une branche `dev` recréée depuis `production` n'a pas la marque : les tests refusent de tourner jusqu'à ce qu'elle soit reposée. C'est le comportement voulu ;
- à vérifier avant validation : que `neondb_owner` peut poser un paramètre personnalisé au niveau de la base sur Neon (question ouverte n° 4). Repli si ce n'est pas le cas : `COMMENT ON DATABASE`, lu par `shobj_description`.

#### 5.2 Où et quand il s'exécute

- Fonction `verifierBaseDeTest()` dans `src/server/db/outils-test/garde-base.ts`, qui passe par `client.ts`, donc par la même adresse que les tests.
- Appelée par le fichier `setupFiles` du projet `integration`, avant le chargement de chaque fichier de test. Un refus fait échouer tous les tests du fichier, avant toute écriture. Coût : une requête par fichier.
- Message de refus : « Tests refusés : la base visée n'est pas marquée comme base de test. », suivi de la raison (marque absente, rôle inattendu, rôle qui contourne l'isolation). Jamais l'hôte, le nom de la base ni l'adresse (S-54).
- Il n'y a aucun moyen de désactiver le garde-fou (ni variable, ni option).

### Alternatives écartées

Les options écartées de chaque difficulté figurent dans les tableaux ci-dessus. S'y ajoutent :

| Alternative | Raison de l'écarter |
|---|---|
| Fixer l'organisation par `SET` de session, et la remettre à zéro à la fin | Une erreur entre les deux laisse la valeur sur la connexion, que le regroupement donne à une autre requête |
| Connexion directe de Neon (sans regroupement) pour l'application | Ne règle rien : la sûreté doit venir de la portée du réglage, pas de l'absence de regroupement. Et le nombre de connexions directes est limité |
| Fixer l'organisation par une fonction SQL `SECURITY DEFINER` | Un objet de plus en base, sans gain : `set_config` local suffit et n'exige aucun droit |
| Passer l'organisation à chaque requête par un filtre du code seulement | C'est la première barrière de S-04, pas la seconde. Le filtre du code reste exigé dans `requetes/`, en plus de la règle |
| Valider l'identifiant par une expression régulière écrite à la main | Zod est imposé par `docs/STACK.md` et déjà installé |

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
- Tables créées : `temoin_isolation`, avec `organisation_id uuid NOT NULL`, clé étrangère vers `organization.id`, règle `isolation_organisation` activée et forcée. Aucune table modifiée (hors préalable U1).

## Dépendances nouvelles

Aucune (règle 10). Sont utilisés des paquets déjà déclarés : `drizzle-orm`, `pg`, `zod` (dépendances), `dotenv`, `vitest` (dépendances de développement). `crypto.randomUUID()` vient de Node.js.

Seule exception possible : une image de conteneur PgBouncer dans la CI, si la question ouverte n° 5 le retient. Elle serait alors proposée selon la règle 10 (nom exact, raison, alternative).

## Migration

Deux migrations, dans cet ordre, relues avant `npm run db:migrate` :

1. Générée par `npm run db:generate` : création de `temoin_isolation`, de sa clé étrangère, de `ENABLE ROW LEVEL SECURITY` et de la règle `isolation_organisation`. Lecture du SQL : vérifier l'expression exacte de la règle, l'absence de clause `TO`, et `NOT NULL` sur `organisation_id`.
2. Créée par `npx drizzle-kit generate --custom`, si l'option F1 est retenue : `ALTER TABLE "temoin_isolation" FORCE ROW LEVEL SECURITY;`, seule instruction du fichier.

Ordre de déploiement : la CI les applique sur sa base neuve ; puis `dev` en local ; puis `production` et `preview` par le workflow `migrations.yml`. Une table vide en production, sans effet sur l'application.

La marque `app.environnement` n'est **pas** une migration : une migration l'appliquerait aussi à `production`.

## Conséquences sur la CI et les scripts

### Job « Qualité » de `ci.yml`

Aucune étape ajoutée. `npm test` ne lance plus que le projet `unitaires` : aucun test avec base n'y tourne, comme aujourd'hui. `npm run build` n'inclut pas `outils-test/`.

### Job « Base de données et bout en bout » de `ci.yml`

| Étape | Changement |
|---|---|
| `Préparer la base de test` | `scripts/preparer-base-test.mjs` pose en plus la marque : `ALTER DATABASE facturation_test SET app.environnement = 'test'`. Le script refuse déjà tout hôte autre que `localhost` |
| `Appliquer les migrations` | Applique les deux nouvelles migrations |
| `Vérifier l'isolation entre organisations` | Inchangé (question ouverte n° 11) |
| **Nouvelle étape** `Lancer les tests d'intégration`, après la précédente | `npm run test:integration` |
| Les autres | Inchangées |

Limite : le PostgreSQL de la CI n'a pas de regroupement de connexions. Les tests de concurrence y prouvent la portée du réglage et la réutilisation des connexions par le `Pool` de `pg`, pas le comportement de PgBouncer. Celui-ci n'est prouvé qu'en local sur `dev`, qui passe par le regroupement de Neon (question ouverte n° 5).

### Workflow `migrations.yml`

Inchangé. Il appliquera les deux migrations en production puis sur `preview`.

### Scripts du dossier `scripts/`

| Script | Effet |
|---|---|
| `preparer-base-test.mjs` | Pose la marque de test (ci-dessus) |
| `verifier-isolation.mjs` | Inchangé |
| Les autres | Inchangés |

La marque sur `dev` se pose une fois, et à chaque recréation de la branche : par une instruction SQL dans l'éditeur SQL de Neon, branche `dev` choisie explicitement, documentée dans `CONFIGURATION.md` (étape 7 et rubrique « Rétablir l'accès à `dev` »). L'automatiser dans `retablir-acces-dev.mjs` est la question ouverte n° 6.

### Documents

- `CLAUDE.md` : commandes (`npm run test:integration`) ; « avant de dire qu'une tâche est terminée », ajout de `npm run test:integration` quand la base est concernée ; si F1 est retenue, l'exception bornée à la règle sur `drizzle/` ; la règle 3 renvoie au modèle de `schema/isolation.ts` au lieu du script.
- `docs/PLAN.md` section 4.1 et `docs/STRUCTURE.md` section 6 : convention `*.integration.test.ts`.
- `docs/STRUCTURE.md` section 3.1 : `schema/isolation.ts`, `outils-test/`.
- `docs/CONFIGURATION.md` : pose de la marque sur `dev`, commande `npm run test:integration`.

## Critères d'acceptation

- [ ] `executerDansOrganisation` fixe l'organisation par `set_config('app.organisation_id', $1, true)` en première instruction de la transaction, l'identifiant en paramètre lié.
- [ ] `grep -rnE "SET( LOCAL)? app\.|set_config\([^)]*false" src/` ne trouve rien.
- [ ] Un identifiant invalide lève `OrganisationActiveInvalide`, au message fixe, sans `cause`, sans la valeur, et sans qu'aucune connexion soit prise.
- [ ] Une requête par `db` hors de la fonction ne voit aucune ligne de `temoin_isolation`, et toute insertion y est refusée.
- [ ] Après une transaction, réussie ou annulée, la connexion rendue au `Pool` n'a plus d'organisation active.
- [ ] Deux transactions simultanées sur deux organisations ne voient chacune que leurs lignes.
- [ ] `temoin_isolation` est déclarée uniquement avec `colonneOrganisation()` et `regleIsolation()`, et sa règle est activée et forcée en base.
- [ ] `verifierIsolation` passe sur `temoin_isolation` (six contrôles, plus les deux proposés s'ils sont retenus).
- [ ] Le test d'inventaire passe, et échoue si l'on retire temporairement le forçage d'une table (vérification manuelle, annulée ensuite).
- [ ] `creerDeuxOrganisations` produit des identifiants différents à chaque appel, et `nettoyer` ne laisse aucune ligne, y compris quand le test échoue.
- [ ] Les tests d'intégration refusent de s'exécuter sur une base sans la marque `app.environnement = 'test'`, avec un rôle autre que `app_facturation`, ou avec un rôle qui contourne l'isolation. Le message ne contient ni hôte, ni nom de base, ni adresse.
- [ ] `npm test` ne lance aucun fichier `*.integration.test.ts` et réussit sans base.
- [ ] `npm run test:integration` réussit en CI et en local sur `dev`.
- [ ] ESLint refuse l'import de `src/server/db/outils-test/` depuis un fichier qui n'est pas un test.
- [ ] `grep -rn "process.env" src/` ne trouve toujours que `src/server/env.ts` ; `grep -rn "DATABASE_URL_MIGRATION" src/` ne trouve rien.
- [ ] Tout nouveau fichier de `src/server/`, hors de `schema/`, commence par `import "server-only";`.
- [ ] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` passent.

## Tests à écrire

Toutes les valeurs sont factices ou aléatoires. Aucun test n'utilise d'identifiant fixe pour une organisation.

### Tests unitaires

Fichier : `src/server/db/client.test.ts` (sans base : la validation a lieu avant toute connexion).

- [ ] Chaîne vide, texte quelconque, nombre, `undefined`, UUID entouré d'espaces, `11111111-1111-1111-1111-111111111111` : `OrganisationActiveInvalide`, et `travail` n'est jamais appelé.
- [ ] Le message de l'erreur est exactement le message fixe ; ni le message, ni `String(erreur)`, ni `JSON.stringify(erreur)` ne contiennent la valeur reçue ; aucune propriété `cause`.
- [ ] Aucune connexion n'est demandée au `Pool` (`Pool` factice passé à `creerAcces`).

### Tests d'intégration

Fichier : `src/server/db/client.integration.test.ts`.

- [ ] Dans la transaction, `current_setting('app.organisation_id')` vaut l'identifiant fourni.
- [ ] La valeur renvoyée par `travail` est renvoyée par la fonction.
- [ ] Une exception dans `travail` annule les écritures de la transaction et remonte telle quelle.
- [ ] Après la transaction, sur la même connexion (`Pool` d'une connexion), `current_setting('app.organisation_id', true)` vaut `''` ou `NULL`.

Fichier : `src/server/db/schema/isolation.integration.test.ts`.

- [ ] `verifierIsolation(temoinIsolation, ...)` : tous les contrôles passent.
- [ ] Test d'inventaire (section 4.4).

Fichier : `src/server/db/outils-test/outils-test.integration.test.ts`.

- [ ] Deux appels à `creerDeuxOrganisations` donnent quatre identifiants distincts.
- [ ] Après `nettoyer`, les organisations et leurs lignes de `temoin_isolation` ont disparu.
- [ ] `nettoyer` appelé deux fois ne lève pas d'erreur.
- [ ] Un test volontairement en échec, dans un fichier isolé, nettoie quand même (vérifié par un comptage dans le fichier suivant, ou par `onTestFinished`).
- [ ] Le garde-fou accepte la base marquée de la CI et de `dev`.

### Tests de concurrence

Fichier : `src/server/db/client.concurrence.integration.test.ts`.

- [ ] **Deux transactions simultanées, deux organisations.** A et B ouvrent chacune une transaction ; une barrière en JavaScript attend que les deux aient fixé leur organisation avant que l'une ou l'autre lise ; chacune lit, écrit, relit, puis valide. Chacune ne voit que ses lignes, et le chevauchement est prouvé par la barrière (pas par une attente fixe).
- [ ] **Réutilisation de la connexion.** `Pool` d'une seule connexion : transaction de A validée, puis requête sans organisation : 0 ligne. Même chose après une transaction de A annulée par une exception.
- [ ] **Alternance sur un petit `Pool`.** Quarante transactions lancées ensemble, alternant A et B, sur un `Pool` de trois connexions : chacune ne voit que les lignes de son organisation, et une requête sans organisation après coup n'en voit aucune.
- [ ] Ces tests, lancés en local sur `dev`, traversent le regroupement de Neon. En CI, ils ne prouvent que le comportement de PostgreSQL et du `Pool`.

### Tests d'attaque

Les quatre tests d'attaque obligatoires du modèle (sans session, autre organisation par une action, rôle non autorisé, entrée falsifiée par un utilisateur) ne s'appliquent pas tels quels : la fonctionnalité n'expose ni route ni action. Les tests ci-dessous visent les menaces de la fiche.

Fichier : `src/server/db/client.attaque.integration.test.ts`.

- [ ] T-30 : organisation A active, lecture filtrée sur l'identifiant d'une ligne de B : aucune ligne.
- [ ] T-30 : organisation A active, insertion d'une ligne pour B : refus `42501`.
- [ ] T-30 : organisation A active, modification et suppression des lignes de B : 0 ligne.
- [ ] T-30 : organisation A active, déplacement de sa propre ligne vers B par `UPDATE` : refus `42501`.
- [ ] T-53 : requête par `db`, sans organisation active : 0 ligne ; insertion refusée.
- [ ] T-53 : le rôle de la connexion est `app_facturation`, sans `BYPASSRLS`.
- [ ] Valeur qui tenterait une injection si elle était concaténée (`00000000-0000-4000-8000-000000000000' OR '1'='1`) : refusée par la validation. Puis, la validation contournée par un appel direct à `set_config` avec cette valeur en paramètre lié : la conversion `::uuid` échoue (`22P02`) et aucune ligne n'est renvoyée.

Le risque qu'un code disposant de `tx` exécute lui-même `set_config` vers une autre organisation n'a pas de test ici : Drizzle laisse `execute` disponible sur toute transaction. Il est reporté à la 0.4 (voir « Reporté »).

Fichier : `src/server/db/outils-test/garde-base.attaque.integration.test.ts`.

- [ ] Garde-fou face à une connexion simulée dont la marque est absente, vaut `Test`, `production` ou `test ` : refus, message sans hôte ni adresse.
- [ ] Garde-fou face à un rôle autre que `app_facturation`, ou à `contourne = true` : refus.

Ces deux derniers tests utilisent une fonction pure de décision (`deciderBaseDeTest(resultat)`) appliquée au résultat de la requête, pour ne pas avoir besoin d'une base non marquée.

### Tests de bout en bout

- [ ] Aucun. Aucune page, aucune route.

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
- `src/server/db/schema/isolation.integration.test.ts`
- `src/server/db/outils-test/outils-test.integration.test.ts`
- `src/server/db/outils-test/garde-base.attaque.integration.test.ts`
- `drizzle/<horodatage>_<nom>/` : deux migrations, générées par drizzle-kit

Modifiés :

- `src/server/db/client.ts` : `creerAcces`, `executerDansOrganisation`, `TransactionOrganisation`, `OrganisationActiveInvalide`
- `src/server/db/schema/technique.ts` : `temoin_isolation`
- `vitest.config.mts` : projets `unitaires` et `integration`, lecture de `.env.local` pour le second
- `package.json` : scripts `test`, `test:watch`, `test:integration`
- `eslint.config.mjs` : import de `outils-test/` réservé aux tests
- `scripts/preparer-base-test.mjs` : marque de test
- `.github/workflows/ci.yml` : étape « Lancer les tests d'intégration »
- `CLAUDE.md`, `docs/PLAN.md`, `docs/STRUCTURE.md`, `docs/CONFIGURATION.md` : voir « Documents »
- `docs/features/acces-donnees.md` : statut

## Reporté

### À la fonctionnalité 0.3 (journal d'audit)

- La table `journal_audit` utilise `colonneOrganisation()` et `regleIsolation()`, et passe `verifierIsolation`. Ses contrôles 5 et 7 (modification, suppression) rencontreront un refus de droit plutôt qu'un résultat vide : la vérification générique devra accepter l'un ou l'autre, ou recevoir une option « ajout seul ».
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

## Questions ouvertes

1. **Type des identifiants.** Retiens-tu U1 (identifiants `uuid` dans Better Auth), et dans une fiche préalable dédiée, livrée avant la 0.2 ? Ou U2 (`text`), avec correction de `DESIGN.md` ?
2. **Forçage de la règle.** Acceptes-tu une exception à « ne modifie jamais le dossier `drizzle/` à la main », limitée aux migrations créées par `drizzle-kit generate --custom` et ne contenant que des `ALTER TABLE ... FORCE ROW LEVEL SECURITY` ? Sinon, quelle voie préfères-tu ?
3. **Table témoin.** Acceptes-tu une table `temoin_isolation`, vide et sans usage métier, présente en production ?
4. **Marque de la base de test.** Peux-tu vérifier sur `dev`, dans l'éditeur SQL de Neon, que `ALTER DATABASE neondb SET app.environnement = 'test'` est accepté pour `neondb_owner`, puis qu'une nouvelle connexion par le rôle de l'application lit `test` ? Je ne peux pas le vérifier sans toucher à la base.
5. **Regroupement de connexions en CI.** Faut-il ajouter un PgBouncer en mode transaction dans le job d'intégration (une image de conteneur, donc une dépendance à valider selon la règle 10), ou accepter que le comportement du regroupement ne soit prouvé qu'en local sur `dev` ?
6. **Pose de la marque sur `dev`.** Instruction SQL manuelle documentée dans `CONFIGURATION.md`, ou ajout dans `scripts/retablir-acces-dev.mjs`, qui sert déjà après chaque recréation de la branche ?
7. **Lignes laissées par un test interrompu.** Le nettoyage ne couvre pas un processus tué. Faut-il un script de balayage (organisations dont le `slug` commence par `test-`, supprimées avec leurs lignes par le rôle propriétaire), ou la recréation de la branche `dev` suffit-elle, comme le dit `PLAN.md` section 7 ?
8. **Suppression d'une organisation.** Quel comportement pour la clé étrangère du modèle : `ON DELETE RESTRICT` (une organisation qui a des données ne peut pas être supprimée directement) ou `CASCADE` ? `DESIGN.md` interdit la cascade vers un document émis, mais ne dit rien du cas général. Pour la table témoin seule, `CASCADE` simplifierait le nettoyage.
9. **Contrôles supplémentaires.** Ajoutes-tu les contrôles 7 (suppression chez B) et 8 (déplacement d'une ligne vers B) à la vérification générique, en plus des six du script ?
10. **Usage de `db`.** Faut-il, dès la 0.2, interdire par ESLint l'import de `db` ailleurs que dans `src/server/auth/config.ts` et `src/server/db/`, ou le reporter à la 0.4 avec le reste de l'analyse du code ?
11. **Avenir de `scripts/verifier-isolation.mjs`.** Le garder dans la CI (il prouve l'isolation pour le rôle propriétaire sur une table créée hors de Drizzle), ou le retirer quand les tests d'intégration le remplacent ?
12. **Convention de nom.** Valides-tu `*.integration.test.ts` (et `*.attaque.integration.test.ts`), avec la mise à jour de `PLAN.md` section 4.1 et de `STRUCTURE.md` section 6 ?
