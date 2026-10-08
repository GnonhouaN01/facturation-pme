# Fonctionnalité : identifiants UUID

Statut : en cours

Préalable à la fonctionnalité 0.2 (`docs/features/acces-donnees.md`, section « Préalable », option U1 retenue). Hors de la numérotation de `docs/PLAN.md`. Taille S.

## Résultat de la vérification préalable

**L'option existe et fait ce qu'il faut, à une exception près.** Constaté par lecture de `node_modules`, sans rien exécuter :

| Question | Réponse | Source lue |
|---|---|---|
| L'option existe-t-elle en 1.7.7 ? | Oui : `generateId?: GenerateIdFn \| false \| "serial" \| "uuid"`. `better-auth`, `@better-auth/core` et `@better-auth/drizzle-adapter` sont tous en 1.7.7 | `node_modules/@better-auth/core/dist/types/init-options.d.mts` (lignes 359 à 374) ; `package.json` des trois paquets |
| Où se configure-t-elle ? | `advanced.database.generateId`, dans l'objet passé à `betterAuth()` | Même fichier : bloc `database` de l'interface des options avancées ; lu aussi par `options.advanced?.database?.generateId` dans les fichiers ci-dessous |
| Le schéma Drizzle généré a-t-il de vraies colonnes `uuid` ? | Oui, pour PostgreSQL : `id` devient `uuid("id").default(sql\`pg_catalog.gen_random_uuid()\`).primaryKey()` | `node_modules/@better-auth/drizzle-adapter/dist/generate-drizzle-schema-iWvrXnu0.mjs`, ligne 128 |
| Et les clés étrangères ? | Oui : tout champ dont `references.field === "id"` devient `uuid('<nom>')` | Même fichier, lignes 67 à 73 |
| Le générateur utilisé par `npx auth generate` est-il celui-là ? | Oui : la commande appelle `adapter.createSchema` quand l'adaptateur le fournit, ce que fait l'adaptateur `relations-v2` du projet, qui importe le fichier ci-dessus | `~/AppData/Local/npm-cache/_npx/7714f44ba1a1641d/node_modules/auth/dist/index.mjs` (version 1.7.7 en cache, lignes 2320 à 2329) ; `node_modules/@better-auth/drizzle-adapter/dist/relations-v2/index.mjs`, lignes 512 à 514 |
| Qui fabrique l'identifiant à l'exécution ? | La base. Avec PostgreSQL, l'adaptateur déclare `supportsUUIDs: true` ; `generateId: "uuid"` fait alors omettre `id` à l'insertion, et `gen_random_uuid()` le produit | `node_modules/@better-auth/core/dist/db/adapter/get-id-field.mjs` (`shouldGenerateId = !supportsUUIDs`) ; `node_modules/@better-auth/drizzle-adapter/dist/relations-v2/index.mjs`, ligne 533 |

Clés étrangères concernées, toutes déclarées avec `references: { model, field: "id" }` :

| Table | Colonne | Vers | Module | Source lue |
|---|---|---|---|---|
| `session` | `user_id` | `user.id` | Base | `node_modules/@better-auth/core/dist/db/get-tables.mjs`, lignes 133 à 139 |
| `account` | `user_id` | `user.id` | Base | Même fichier, lignes 212 à 217 |
| `two_factor` | `user_id` | `user.id` | Double authentification | `node_modules/better-auth/dist/plugins/two-factor/schema.mjs` |
| `member` | `organization_id` | `organization.id` | Organisation | `node_modules/better-auth/dist/plugins/organization/organization.mjs`, lignes 745 à 753 |
| `member` | `user_id` | `user.id` | Organisation | Même fichier, lignes 755 à 763 |
| `invitation` | `organization_id` | `organization.id` | Organisation | Même fichier, lignes 783 à 791 |
| `invitation` | `inviter_id` | `user.id` | Organisation | Même fichier, lignes 830 à 838 |

Soit **15 colonnes** à passer en `uuid` : les 8 colonnes `id` (`user`, `session`, `account`, `verification`, `two_factor`, `organization`, `member`, `invitation`) et les 7 clés étrangères.

**L'exception : `session.active_organization_id` reste en `text`.** Le module organisation la déclare sans `references` (`organization.mjs`, lignes 859 à 864) : le générateur la traite comme une chaîne ordinaire. Ce n'est pas une clé étrangère, et la configuration ne permet que de la renommer, pas d'en changer le type. Elle contiendra des UUID écrits sous forme de texte. Conséquence pour la 0.2 et la 0.4 : la valeur lue dans la session doit être validée comme UUID avant usage, ce que prévoit déjà `executerDansOrganisation` (`acces-donnees.md`, section 1.4).

Autres colonnes de texte qui ne changent pas : `account.account_id` (identifiant chez le fournisseur), `verification.identifier`, et `compteur_debit.cle`.

L'alternative « garder `text` et corriger `DESIGN.md` » n'est donc pas nécessaire.

## Contexte

Cette fonctionnalité sert au développeur. Elle aligne les tables de Better Auth sur `docs/DESIGN.md` (section 2.1, identifiants `uuid`), pour que les futures tables métier puissent porter `organisation_id uuid` avec une clé étrangère vers `organization.id` (`DESIGN.md` section 2.4), et que la règle de sécurité au niveau des lignes puisse convertir le réglage en `::uuid`.

Aujourd'hui, les 8 tables de Better Auth ont des identifiants `text`, produits par le générateur par défaut de Better Auth : 32 caractères pris parmi 62 (`node_modules/@better-auth/core/dist/utils/id.mjs`). Ce ne sont pas des UUID : aucune conversion `::uuid` n'est possible.

C'est le meilleur moment pour ce changement : la route `/api/auth` n'existe pas, donc aucun compte n'a pu être créé par l'application, et les tables devraient être vides partout.

Cas d'utilisation concernés : aucun directement.

## Problème

- Une clé étrangère `organisation_id uuid` vers `organization.id text` est impossible : PostgreSQL exige des types compatibles.
- La règle de la 0.2 (`NULLIF(current_setting(...), '')::uuid`) échouerait sur un identifiant de Better Auth.
- Plus tard, quand les tables contiendront des comptes réels, changer de type demandera de réécrire chaque identifiant et chaque référence. Aujourd'hui, elles sont vides.
- La procédure manuelle de régénération du schéma (`CLAUDE.md`, « Pièges connus ») n'a jamais été vérifiée de bout en bout : le chargement de `.env.local` par l'outil reste marqué « non vérifié ».

## Solution retenue

Exigences couvertes : aucune exigence F ou R.

### 1. La configuration

Dans `src/server/auth/config.ts`, ajout dans l'objet passé à `betterAuth` :

```ts
advanced: { database: { generateId: "uuid" } },
```

Rien d'autre ne change dans ce fichier.

### 2. La régénération du schéma, vérifiée de bout en bout

#### 2.1 Ce que la lecture du code établit

- L'outil (`auth` 1.7.7, en cache) charge la configuration avec `c12`, option `dotenv: { fileName: [".env", ".env.local"] }` (`auth/dist/index.mjs`, ligne 1203).
- `c12` (`4.0.0-rc.2`, `c12/dist/index.mjs`, lignes 11 à 26 et 233 à 237) charge ces fichiers **dans `process.env` avant** de charger le fichier de configuration, sans écraser une variable déjà définie dans le terminal. `env.ts` devrait donc trouver les trois variables au moment où `config.ts` le charge.
- L'outil refuse toute configuration qui mène à `server-only` (`SERVER_ONLY_HINT`, ligne 1170). La chaîne d'imports est : `config.ts` → `db/client.ts` → `env.ts` → `env-schema.ts`, plus `db/schema/auth.ts`, qui n'a pas la ligne. La liste des quatre fichiers de `CLAUDE.md` est donc complète aujourd'hui.
- La génération n'ouvre aucune connexion à la base : `createSchema` lit les options, pas les tables. Seule la validation de `env.ts` exige des valeurs bien formées.

#### 2.2 Ce qui est faux ou fragile dans la procédure actuelle

| Point | Constat | Correction proposée |
|---|---|---|
| `npx auth@latest` | Télécharge la dernière version publiée de l'outil, qui peut différer de la 1.7.7 du projet, et exécute du code non épinglé (T-71) | `npx auth@1.7.7`, la version de `better-auth` dans `package.json`. À aligner à chaque mise à jour de Better Auth |
| Chargement de `.env.local` | « Non vérifié » | Établi par lecture (section 2.1). À **prouver** pendant l'implémentation : lancer la commande sans aucune variable dans le terminal ; si elle aboutit, `.env.local` a été lu. Puis retirer la mention « non vérifié » |
| Liste des fichiers où retirer `server-only` | Fixe | Formuler comme une règle : « `config.ts` et tous les fichiers de `src/server/` qu'il importe, directement ou non », la liste actuelle donnée en exemple |
| Mise en forme | Le générateur passe le code par Prettier s'il le trouve | Ajouter `npx prettier --write src/server/db/schema/auth.ts` après la génération, puis le contrôle `git diff` |

Si la preuve échoue (variables non trouvées), **l'implémentation s'arrête** et le constat est remonté. Aucun contournement n'est construit d'avance (décision 3).

#### 2.3 La procédure, telle qu'elle sera exécutée

1. Retirer temporairement `import "server-only";` de `config.ts`, `client.ts`, `env.ts`, `env-schema.ts`.
2. `npx auth@1.7.7 generate --config src/server/auth/config.ts --output src/server/db/schema/auth.ts --yes`
3. Rétablir les quatre lignes.
4. `npx prettier --write src/server/db/schema/auth.ts`
5. `git diff --stat` : seuls `src/server/db/schema/auth.ts` et `src/server/auth/config.ts` (l'option ajoutée) ont changé.
6. Relire le diff de `auth.ts` : 8 colonnes `id` en `uuid(...).default(sql\`pg_catalog.gen_random_uuid()\`)`, 7 clés étrangères en `uuid`, `activeOrganizationId` toujours en `text`, et aucun autre changement (les relations `authRelations` doivent être identiques).

#### 2.4 Le paquet `auth`, vérifié avant exécution

`npm view auth@1.7.7`, consulté le 2026-10-08 :

| Point | Valeur |
|---|---|
| Description | « The CLI for Better Auth » |
| Dépôt | `github.com/better-auth/better-auth`, dossier `packages/cli` (celui de `better-auth` est `packages/better-auth`) |
| Mainteneur | `bekacru`, le même que pour `better-auth` |
| Publication | 30/09/2026 à 21:32:55 UTC par `GitHub Actions <npm-oidc-no-reply@github.com>` (identité de confiance OIDC), deux minutes après `better-auth@1.7.7` |
| Dépendances Better Auth | Exactement `better-auth` 1.7.7, `@better-auth/core` 1.7.7, `@better-auth/telemetry` 1.7.7, `@better-auth/utils` 0.4.2, comme le projet |
| Empreinte | `sha512-Iuka9UTqPUI4qQORHjZ0U4D/ceH3q11e1iGU+j2N/Flfy2jQK/vGACzrBBXDArE7kFAn468g/P8+aAOonU8s0A==` |

**Historique du nom.** Le paquet `auth` a été créé sur npm le 28/10/2012, bien avant Better Auth : le nom a changé de propriétaire, et ses versions anciennes n'ont aucun rapport avec Better Auth. Un `npx auth` sans version, ou avec une version erronée, peut donc exécuter un code étranger au projet. D'où la règle, reportée dans `CLAUDE.md` : toujours `auth@<version exacte>`, égale à celle de `better-auth`, jamais `auth` seul ni `@latest`.

**Risque résiduel : les dépendances flottantes de l'outil.** `auth@1.7.7` est épinglé, mais il déclare des dépendances à versions flottantes (`c12 ^4.0.0-beta.5`, `prettier ^3.8.1`, `@babel/core ^7.29.7`, `jiti`, `dotenv`, `commander`…). npx les installe dans son cache, hors de `package-lock.json` : elles ne passent ni par `npm audit` ni par la relecture du verrou, et une nouvelle exécution sur un cache vide peut en tirer des versions plus récentes. Le risque est accepté : l'outil ne s'exécute qu'à la main, sur le poste, à chaque mise à jour de Better Auth, jamais en CI ni en production. Ce qu'il produit (`auth.ts`) est relu par `git diff` avant tout commit.

**Télémétrie.** Lu dans le code en cache (`@better-auth/telemetry` 1.7.7, `createTelemetry` ; `@better-auth/core` 1.7.7, `getBooleanEnvVar`) : la variable s'appelle exactement `BETTER_AUTH_TELEMETRY`, et `generate` appelle `createTelemetry`. La télémétrie est désactivée par défaut dans cette version : `BETTER_AUTH_TELEMETRY` vaut `false` en l'absence de valeur, et sans `BETTER_AUTH_TELEMETRY_ENDPOINT` (vide par défaut) la fonction `publish` ne fait rien. `BETTER_AUTH_TELEMETRY=0` est tout de même passé à la commande, comme protection explicite.

#### 2.5 Constat d'exécution (2026-10-08)

- Avant la commande, la présence des noms `DATABASE_URL`, `DATABASE_URL_MIGRATION`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` et `BETTER_AUTH_TELEMETRY` a été testée dans le terminal, sans lire de valeur : tous absents.
- Commande : `BETTER_AUTH_TELEMETRY=0 npx --yes auth@1.7.7 generate --config src/server/auth/config.ts --output src/server/db/schema/auth.ts --yes`. Résultat : « Schema was overwritten successfully! », code 0. Seul message parasite : un avertissement de Node.js (`MODULE_TYPELESS_PACKAGE_JSON`) sur le chargement de `config.ts`, sans effet.
- `config.ts` charge `env.ts`, qui exige les trois variables valides. Aucune n'étant dans le terminal, **l'outil a lu `.env.local`** : la mention « non vérifié » de `CLAUDE.md` est retirée.
- Les quatre lignes `server-only` ont été retirées puis rétablies avec l'outil d'édition. `git diff --stat` n'a ensuite montré que `config.ts` (1 ligne) et `schema/auth.ts`. `client.ts`, `env.ts` et `env-schema.ts` sont identiques à la version commitée. `prettier --write` n'a rien changé.
- Le diff de `auth.ts` correspond à l'attendu : 8 `id` et 7 clés étrangères en `uuid`, `activeOrganizationId` en `text`, `authRelations` inchangé.

### 3. La migration

#### 3.1 Conversion sur place ou recréation

| | A. Conversion sur place (`ALTER COLUMN ... TYPE uuid`) | **B. Recréation des tables** |
|---|---|---|
| Ce que drizzle-kit génère seul | Pour chacune des 15 colonnes : `ALTER TABLE ... ALTER COLUMN "..." SET DATA TYPE uuid USING "..."::uuid;`, et `SET DEFAULT` pour les 8 `id` (`node_modules/drizzle-kit/bin.cjs`, lignes 83234 à 83261). Il ne supprime ni ne recrée les clés étrangères : il ne le fait que si leur définition change (`recreate_fk`, lignes 84177 à 84183), et le type d'une colonne n'en fait pas partie | Deux migrations ordinaires : l'une supprime les 8 tables, l'autre les crée avec le nouveau schéma. Aucune ligne écrite à la main |
| Ce que PostgreSQL en fait | Changer le type d'une colonne reliée par une clé étrangère à une colonne d'un autre type échoue : la contrainte ne peut plus être construite. Le changement des deux côtés ne tient pas dans une seule instruction. **Échec attendu**, à confirmer sur la base de la CI | Fonctionne sur des tables vides |
| Intervention manuelle | Migration personnalisée (`generate --custom`) : supprimer les 7 clés étrangères, convertir les 15 colonnes, recréer les clés. Contraire à « ne modifie jamais le dossier `drizzle/` à la main » | Une manipulation de fichier pour obtenir la première migration (section 3.2), hors de `drizzle/` |
| Données conservées | Seulement si chaque valeur est un UUID valide. Les identifiants actuels de Better Auth ne le sont pas : la conversion échoue dès la première ligne. **Exige des tables vides, comme B** | Aucune : exige des tables vides |
| Noms de contraintes et d'index | Conservés | Recréés à l'identique par le générateur |

**Recommandation : B.** La conversion sur place n'apporte rien ici, puisqu'aucune donnée existante ne peut être convertie, et elle demanderait une migration écrite à la main.

#### 3.2 Obtenir les deux migrations par drizzle-kit

drizzle-kit compare le schéma au dernier instantané. Passer directement de `text` à `uuid` produirait la conversion sur place (A). Pour obtenir B, la génération se fait en deux temps :

1. Mettre `src/server/db/schema/auth.ts` de côté hors du motif lu par drizzle-kit (`./src/server/db/schema/*.ts`), par exemple en le renommant `auth.ts.mis-de-cote`. Lancer `npm run db:generate` : migration de suppression des 8 tables.
2. Remettre le fichier en place, faire la régénération de la section 2.3, puis `npm run db:generate` : migration de création des 8 tables en `uuid`.
3. Relire les deux fichiers SQL : la première ne contient que la suppression des clés étrangères, des index et des 8 tables, et ne touche ni `compteur_debit` ni le schéma `drizzle` ; la seconde crée les 8 tables avec `uuid`, `DEFAULT pg_catalog.gen_random_uuid()`, les 7 clés étrangères et les mêmes index qu'aujourd'hui.

À vérifier à la lecture de la première migration : l'ordre des instructions. Le générateur supprime les clés étrangères entre tables supprimées (`jsonDropFKs`, `bin.cjs` lignes 84185 à 84190) ; si une `DROP TABLE` arrivait avant la suppression d'une clé qui la vise, la migration échouerait en CI, sans effet sur une autre base.

Entre les étapes 1 et 2, le code ne compile pas (`client.ts` importe `authRelations`). Rien n'est commité entre les deux : les deux migrations et le nouveau `auth.ts` partent dans le même commit.

**Constat d'exécution (2026-10-08).** Les deux commandes ont été lancées l'entrée standard fermée, pour qu'une question interactive échoue au lieu d'attendre. Aucune question n'a été posée.

- `npm run db:generate -- --name supprimer-tables-auth` → `drizzle/20261008120411_supprimer-tables-auth/`. Ordre correct : les 7 `DROP CONSTRAINT` d'abord, puis les 8 `DROP TABLE`. Rien sur `compteur_debit` ni sur le schéma `drizzle`.
- `npm run db:generate -- --name creer-tables-auth-uuid` → `drizzle/20261008120429_creer-tables-auth-uuid/`. 8 `CREATE TABLE` avec 15 colonnes `uuid` et `DEFAULT pg_catalog.gen_random_uuid()` sur les 8 `id`, `active_organization_id` en `text`, les 10 mêmes index et les 7 mêmes clés étrangères (mêmes noms, `ON DELETE CASCADE`) que la migration d'origine.
- Aucun fichier de `drizzle/` n'a été retouché à la main. Après application, `npm run db:generate` répond « No schema changes, nothing to migrate ».
- L'échec attendu de la conversion sur place (option A) n'a pas été testé, puisque B a été retenue.

#### 3.3 Atomicité

Le migrateur de Drizzle applique **toutes** les migrations en attente dans une seule transaction (`node_modules/drizzle-orm/pg-core/async/session.js`, lignes 166 à 170). Les deux migrations réussissent donc ensemble ou pas du tout : une base ne peut pas rester sans tables d'authentification.

**Point non prouvé** (décision 6) : la lecture montre que la fonction `migrate` de drizzle-orm regroupe les migrations dans une transaction, mais il n'est pas vérifié que la commande `drizzle-kit migrate` passe par elle. La lecture est jugée suffisante : les tables sont vides, et un retour en avant reste possible.

### 4. La vérification préalable : des tables vides

#### 4.1 La requête

En lecture seule, à exécuter sur chaque base :

```sql
SELECT 'user' AS table_, count(*) FROM "user"
UNION ALL SELECT 'session', count(*) FROM session
UNION ALL SELECT 'account', count(*) FROM account
UNION ALL SELECT 'verification', count(*) FROM verification
UNION ALL SELECT 'two_factor', count(*) FROM two_factor
UNION ALL SELECT 'organization', count(*) FROM organization
UNION ALL SELECT 'member', count(*) FROM member
UNION ALL SELECT 'invitation', count(*) FROM invitation;
```

#### 4.2 Par base

| Base | Comment | Quand |
|---|---|---|
| CI | Inutile : base neuve à chaque exécution, les migrations s'y appliquent depuis zéro | — |
| `dev` | Éditeur SQL de Neon, branche `dev` choisie explicitement | Avant `npm run db:migrate` en local |
| `production` | Éditeur SQL de Neon, branche `production` | Avant la validation de la PR, **et à nouveau** juste avant de lancer le workflow |
| `preview` | Éditeur SQL de Neon, branche `preview` | Juste avant de lancer le workflow |

L'éditeur SQL de Neon évite de placer l'adresse de `preview` ou de `production` sur le poste, et rend visible la branche visée. L'assistant n'exécute pas ces requêtes : il n'a pas accès à ces bases (règle 1).

#### 4.3 Si une base n'est pas vide

| Base | Cause probable | Conduite |
|---|---|---|
| `dev` | Essais manuels ou anciens tests | Supprimer les lignes par le rôle propriétaire (`TRUNCATE "user", organization, verification CASCADE;` dans l'éditeur SQL, branche `dev`), ou réinitialiser `dev` depuis `production` si celle-ci est vide. Puis `scripts/retablir-acces-dev.mjs` si la branche a été recréée |
| `preview` | Données copiées de `production`, ou essais | Même chose, après accord explicite |
| `production` | Aucune n'est attendue : aucune route d'authentification n'existe | **Arrêt.** Ne pas lancer le workflow. Comprendre l'origine des lignes avant toute décision. S'il fallait les garder, la conversion demanderait de réécrire chaque identifiant et chaque référence : fonctionnalité distincte, avec sa propre fiche |

#### 4.4 Résultat (décision 1)

Vérifié par le développeur dans l'éditeur SQL de Neon : les 8 tables d'authentification et `compteur_debit` contiennent **0 ligne** sur `dev`, `preview` et `production`.

Constat annexe : une table d'exemple créée par Neon, `playing_with_neon`, existait sur les trois branches, hors de nos migrations et de `drizzle/`. Le développeur l'a supprimée à la main sur les trois branches. Elle n'avait aucun lien avec l'application, et sa suppression ne touche aucune migration.

La vérification de la section 4.2 est **refaite** juste avant chaque migration de `preview` et de `production` (ordre de déploiement, étapes 5 et 7).

### 5. Les tests et vérifications

| Vérification | Où | Base |
|---|---|---|
| Types du schéma Drizzle (test unitaire) | `src/server/db/schema-auth.test.ts` | Non |
| Types réels en base | `scripts/verifier-identifiants.mjs`, nouvelle étape de la CI | Oui, lecture seule |
| Identifiant fabriqué par la base à l'exécution | `scripts/verifier-creation-auth.mts`, script npm `verifier:creation-auth`, nouvelle étape de la CI | Oui, écriture sur une base `localhost` uniquement |
| Better Auth lit toujours ses tables | `npm run verifier:auth`, inchangé | Oui |

Le test unitaire n'est pas placé dans `src/server/db/schema/` : drizzle-kit charge tous les fichiers `./src/server/db/schema/*.ts` (`drizzle.config.ts`), et un fichier de test y serait lu comme un schéma par `npm run db:generate`. Il est donc à côté, dans `src/server/db/`.

Le détail est dans la section « Tests à écrire ». La 0.2 apportera l'outillage Vitest avec base ; la vérification en base passe donc ici par deux scripts, **provisoires** (décision 4), comme les vérifications existantes (`verifier-isolation.mjs`, `verifier-connexion.mjs`). Ils seront remplacés par des tests Vitest quand l'outillage de la 0.2 existera.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Garder `text` et corriger `DESIGN.md` | Inutile : la vérification préalable montre que l'option fonctionne. Et la règle de la 0.2 perdrait la validation stricte du format |
| Conversion sur place | Voir section 3.1 : échec attendu à cause des clés étrangères, migration écrite à la main, et aucune donnée convertible |
| Repartir de zéro : supprimer `drizzle/` et regénérer une migration initiale | Modifie des migrations déjà appliquées, et la table `drizzle.__drizzle_migrations` de chaque base ne correspondrait plus. Contraire à `CLAUDE.md` |
| Générateur d'identifiants personnalisé (`generateId: () => crypto.randomUUID()`) | Les colonnes restent `text` dans le schéma généré : seule la valeur `"uuid"` change le type |
| Identifiant fabriqué par l'application plutôt que par la base | C'est le comportement de Better Auth sans prise en charge des UUID ; avec PostgreSQL, il laisse la base le faire. Aucun réglage à ajouter |
| Écrire `uuid` à la main dans `auth.ts` | Fichier généré, qui ne se modifie pas à la main (`CLAUDE.md`). La prochaine régénération l'écraserait |

## Règles de sécurité et permissions

- Exigences de sécurité couvertes :
  - **S-01, S-04** (indirectement) : rendent possibles les clés étrangères `organisation_id` et la règle de la 0.2.
  - **S-83** : aucune adresse de `preview` ni de `production` sur le poste ; les vérifications s'y font dans l'éditeur SQL de Neon.
  - Règles 1, 9 (aucun document ni paiement n'existe encore), 10 et 13 de `CLAUDE.md`.
- Menaces concernées :
  - **T-71** : l'outil de génération est épinglé à la version du projet au lieu de `@latest`.
  - **T-30** (préparation) : les clés étrangères vers `organization.id` deviennent possibles.
- Effet sur l'imprévisibilité des identifiants : un identifiant par défaut de Better Auth porte environ 190 bits d'aléa (32 caractères parmi 62) ; un UUID version 4 en porte 122, tirés par `gen_random_uuid()` sur le générateur aléatoire sûr de PostgreSQL. C'est encore très au-dessus de ce qu'une attaque par devinette peut atteindre. Cela compte pour l'identifiant d'invitation, que Better Auth reçoit dans `acceptInvitation` (`crud-invites.mjs`, ligne 245). L'invitation par jeton haché que prévoit `DESIGN.md` (section 2.1, `INVITATION.jeton_hache`) reste à traiter au jalon 2.
- Matrice des droits : aucune ligne. Aucune action, aucune route.
- Tables : les 8 tables de Better Auth sont supprimées puis recréées à l'identique, à l'exception des types `uuid` et des valeurs par défaut. Aucune table métier. Les droits du rôle `app_facturation` sur les tables recréées viennent des droits par défaut (`ALTER DEFAULT PRIVILEGES`, `CONFIGURATION.md` étape 7b), pourvu que les migrations soient appliquées par le rôle qui les a déclarés (`neondb_owner` sur Neon, `postgres` en CI). Vérifié par `verifier-tables.mjs` et `verifier:auth`.

## Dépendances nouvelles

Aucune. L'outil `auth` est exécuté par `npx` sans être ajouté au projet, comme aujourd'hui, mais en version épinglée.

## Conséquences

### `compteur_debit`

Aucune. Sa clé `cle` est un texte composé (action et origine), sans lien avec les tables de Better Auth. Elle n'apparaît dans aucune des deux migrations ; la relecture le vérifie.

### Scripts du dossier `scripts/`

| Script | Effet |
|---|---|
| `verifier-isolation.mjs` | Aucun. Il crée sa propre table en `uuid` ; ses identifiants fixes (`1111...`) sont acceptés par le type `uuid` de PostgreSQL |
| `verifier-tables.mjs` | Aucun : toujours 9 tables accessibles au rôle de l'application |
| `verifier-auth.mts` | Aucun. Il compte les utilisateurs ; doit continuer de passer |
| `verifier-connexion.mjs`, `preparer-base-test.mjs`, `preparer-url-application.mjs`, `renouveler-mot-de-passe-app.mjs`, `retablir-acces-dev.mjs` | Aucun : ils ne touchent pas aux tables de Better Auth |
| `verifier-identifiants.mjs` | **Nouveau**, provisoire, lecture seule (section « Tests à écrire ») |
| `verifier-creation-auth.mts` | **Nouveau**, provisoire, script npm `verifier:creation-auth`. Écrit, donc refuse tout hôte autre que `localhost` ou `127.0.0.1` |

### CI (`ci.yml`)

- Job « Qualité » : le nouveau test unitaire tourne dans `npm test`. Rien d'autre.
- Job « Base de données et bout en bout » : `npm run db:migrate` applique les quatre migrations depuis zéro (création en `text`, `compteur_debit`, suppression, création en `uuid`). Deux étapes ajoutées après « Vérifier les connexions et les rôles » : `node scripts/verifier-identifiants.mjs` et `npm run verifier:creation-auth`.

### Workflow `migrations.yml`

Fichier inchangé. Mais cette exécution supprime et recrée des tables : la vérification de la section 4 précède chaque lancement, et l'approbation de l'environnement `production` ne se donne qu'après elle.

### `docs/DESIGN.md`

- Section 2.1 : le diagramme montre déjà des `uuid`. Corriger `SESSION.organisation_active_id` : `text`, sans clé étrangère. Exception acceptée (décision 5) : c'est un choix de Better Auth, que la configuration ne permet pas de changer ; la valeur est validée comme UUID à chaque lecture avant usage.
- Section 2.1, « Explication » : ajouter que Better Auth est configuré avec `generateId: "uuid"` et que la base fabrique les identifiants.

### `docs/USECASES.md`

Aucune modification nécessaire. Aucun cas d'utilisation ne dépend du format des identifiants. Les cas d'abus qui visent un identifiant (UC-05 « en changeant un identifiant », UC-11 « l'identifiant d'une organisation dont on n'est pas membre », UC-14 « en devinant son adresse ») restent traités par la réponse « introuvable » (S-02), quel que soit le format : un identifiant mal formé reçoit la même réponse qu'un identifiant inconnu, ce que la 0.4 garantira.

### Autres documents

- `CLAUDE.md`, « Pièges connus » : procédure corrigée (section 2.2).
- `docs/CONFIGURATION.md`, étape 8 : commande de génération épinglée, mention de `generateId: "uuid"`.
- `docs/features/acces-donnees.md` : la section « Préalable » renvoie à cette fiche. À faire sur la branche de la 0.2, pas ici.

## Ordre de déploiement

| # | Étape | Base | Vérification |
|---|---|---|---|
| 1 | Vérification de la section 4 sur `dev`, `preview`, `production` | Lecture seule | Fait : 0 ligne partout (section 4.4) |
| 2 | PR : la CI applique toutes les migrations sur une base neuve | CI | `verifier-identifiants`, `verifier:creation-auth`, `verifier:auth`, `verifier-tables`, tests de bout en bout |
| 3 | En local : `npm run db:migrate` | `dev` | `node scripts/verifier-identifiants.mjs`, `npm run verifier:auth`, `node scripts/verifier-tables.mjs` |
| 4 | Fusion dans `main` | — | Le déploiement de production de Vercel utilise la nouvelle configuration avec l'ancien schéma. Sans effet : aucune route d'authentification, aucune écriture dans ces tables |
| 5 | Revérifier `preview` (section 4), puis lancer `migrations.yml` sur `preview` | `preview` | Requête de `verifier-identifiants.mjs` exécutée dans l'éditeur SQL de Neon, branche `preview` |
| 6 | Tenter de créer dans Neon une branche `avant-uuid` depuis `production` (point de retour). Si Neon la refuse (limite de l'offre), continuer sans (décision 2) | Neon | La branche existe, ou le refus est noté dans la PR |
| 7 | Revérifier `production` (section 4), puis lancer `migrations.yml` sur `production`, avec approbation | `production` | Même requête, branche `production` |
| 8 | Supprimer la branche `avant-uuid`, si elle existe, après quelques jours sans incident | Neon | — |

**Exception à `PLAN.md` section 5 : `preview` avant `production`** (décision 7). `PLAN.md` prévoit `production` puis `preview`. Ici, l'ordre est inversé, pour une raison propre à cette migration : elle **supprime puis recrée** les tables d'authentification. `preview` est une copie de `production` sur la même plateforme, avec le même rôle propriétaire et les mêmes droits par défaut ; la migrer d'abord répète l'opération destructive dans des conditions identiques, sur une base sans valeur, avant de toucher `production`. `dev` sert aussi de répétition (étape 3), mais elle passe par une commande locale, alors que `preview` passe par le même workflow `migrations.yml` que `production`. Pendant l'intervalle entre les étapes 5 et 7, les prévisualisations utilisent le nouveau schéma et la production l'ancien : sans effet, puisque aucune route n'écrit dans ces tables. Cette exception ne vaut que pour cette fonctionnalité.

## Retour arrière

| Moment | Situation | Retour |
|---|---|---|
| Avant l'étape 5 | Aucune base Neon partagée n'a changé | Annuler la PR (`git revert`). Sur `dev`, réinitialiser la branche depuis `production` |
| Pendant l'étape 5 ou 7 | La migration échoue | Rien à faire si la transaction unique fonctionne comme la lecture l'indique (section 3.3, point non prouvé) : la base reste intacte. Sinon, recréer les tables manquantes par un retour en avant. Analyser, corriger dans une nouvelle PR. Un échec à l'étape 5 arrête le déploiement avant `production` |
| Après l'étape 5 ou 7, tables toujours vides | L'application ne fonctionne pas avec les UUID | Retour en avant : nouvelle PR qui retire l'option et produit les deux mêmes migrations en sens inverse (suppression, puis création en `text`). Pour `production`, ou restauration depuis `avant-uuid` si la branche a pu être créée |
| Après l'arrivée de comptes réels (jalon 1) | Les tables contiennent des données | Plus de retour simple : il faudrait réécrire chaque identifiant. C'est pourquoi le changement se fait maintenant |

Drizzle n'a pas de migration descendante : un retour passe toujours par une nouvelle migration ou par une restauration de Neon. Une restauration remet aussi `drizzle.__drizzle_migrations` dans son état antérieur ; la PR annulée doit alors être fusionnée avant toute nouvelle migration.

## Critères d'acceptation

- [x] `config.ts` passe `advanced: { database: { generateId: "uuid" } }` à `betterAuth`, et rien d'autre n'y change.
- [x] `auth.ts` est produit par l'outil, jamais édité à la main ; `git diff` après la génération ne montre que `auth.ts` et `config.ts`.
- [x] Dans `auth.ts`, les 8 colonnes `id` sont `uuid` avec `gen_random_uuid()` par défaut, les 7 clés étrangères sont `uuid`, `activeOrganizationId` reste `text`, et `authRelations` est inchangé.
- [x] La commande de génération aboutit sans aucune variable définie dans le terminal (preuve du chargement de `.env.local`). Sinon, l'implémentation s'arrête (décision 3).
- [x] Les quatre lignes `import "server-only";` sont rétablies ; `grep -L 'import "server-only"' src/server/auth/config.ts src/server/db/client.ts src/server/env.ts src/server/env-schema.ts` ne renvoie rien.
- [x] Deux migrations générées par drizzle-kit, sans modification à la main : suppression des 8 tables, puis création en `uuid`. Aucune ne touche `compteur_debit`.
- [x] Aucune migration déjà appliquée n'est modifiée.
- [ ] Les 8 comptes de la section 4 sont à 0 sur `dev`, `preview` et `production` avant leur migration respective. `dev` : prouvé avant sa migration (section 4.4). `preview` et `production` : à revérifier juste avant leur migration.
- [ ] En CI et sur `dev` : `verifier-identifiants.mjs` réussit, `verifier:auth` réussit, `verifier-tables.mjs` liste 9 tables. `dev` : prouvé le 2026-10-08 (15 colonnes `uuid`, 0 utilisateur lu, 9 tables ; `verifier-isolation.mjs` passe aussi). CI : à constater sur la PR.
- [ ] En CI : `npm run verifier:creation-auth` réussit, et ne laisse aucune ligne.
- [x] `npm run verifier:creation-auth` sur `dev` (hôte Neon) refuse de s'exécuter, sans afficher l'hôte.
- [ ] Après migration, la requête de vérification des types donne le résultat attendu sur `production` et `preview`.
- [x] `CLAUDE.md` contient la procédure corrigée et vérifiée ; la mention « non vérifié » a disparu ou est remplacée par le constat.
- [x] `DESIGN.md` et `CONFIGURATION.md` sont à jour.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` passent.

## Tests à écrire

Tests d'abord : le test unitaire et `verifier-identifiants.mjs` sont écrits avant le changement de configuration, et vus en échec sur le schéma actuel.

### Tests unitaires

Fichier : `src/server/db/schema-auth.test.ts` (hors de `schema/`, voir section 5). Il importe les tables de `schema/auth.ts` et lit le type SQL de chaque colonne (`getSQLType()`) et les clés étrangères (`getTableConfig`) par l'API de Drizzle. Il n'importe ni `env.ts` ni `config.ts`.

- [x] Pour chacune des 8 tables, la colonne `id` est de type `uuid`, clé primaire, avec une valeur par défaut.
- [x] Pour chacune des 7 clés étrangères du tableau de la vérification préalable, la colonne est de type `uuid`.
- [x] `session.activeOrganizationId` est de type `text` (exception documentée : si une future version de Better Auth en fait une clé étrangère, le test échoue et signale que la documentation doit suivre).
- [x] Il y a exactement 15 colonnes de type `uuid` dans les tables de Better Auth : une nouvelle clé étrangère, apportée par un module ou une mise à jour, fait échouer le test jusqu'à ce qu'on l'ajoute à la liste.

### Vérifications en base

`scripts/verifier-identifiants.mjs`, sur le modèle des scripts existants : rôle de l'application (`DATABASE_URL`), lecture seule, `information_schema.columns` et `pg_constraint`. Sortie `OK` ou `ECHEC` par ligne, code de sortie 1 en cas d'échec.

- [x] Les 8 colonnes `id` sont de type `uuid`, avec la valeur par défaut `gen_random_uuid()`.
- [x] Les 7 clés étrangères existent, et relient chacune une colonne `uuid` à une colonne `uuid`.
- [x] Aucune clé étrangère des 8 tables ne part d'une colonne `text`.
- [x] `session.active_organization_id` est `text` (exception attendue).
- [x] La requête SQL du script est lisible telle quelle, pour être copiée dans l'éditeur SQL de Neon sur `production` et `preview`. Les deux requêtes (`REQUETE_COLONNES`, `REQUETE_CLES`) sont des chaînes SQL complètes, sans paramètre ni interpolation.

`scripts/verifier-creation-auth.mts`, lancé par le script npm `verifier:creation-auth` (`tsx --conditions=react-server`, comme `verifier:auth`) :

- [x] Refuse de s'exécuter si l'hôte de `DATABASE_URL` n'est pas `localhost` ou `127.0.0.1` (même garde que `preparer-base-test.mjs`), avant de charger la configuration de Better Auth et avant toute connexion : il écrit.
- [ ] Crée un utilisateur et une organisation par l'adaptateur de Better Auth (`contexte.adapter.create`), sans fournir d'`id`.
- [ ] Vérifie que chaque `id` renvoyé est un UUID, et qu'il est égal à celui relu par l'adaptateur.
- [ ] Crée une adhésion (`member`) qui relie les deux : la clé étrangère `uuid` accepte la ligne.
- [ ] Supprime ses lignes dans tous les cas, succès ou échec (`finally`), en les retrouvant par l'adresse email et le `slug` uniques qu'il a choisis, pour couvrir aussi une création interrompue avant d'avoir renvoyé son `id`. Un échec du nettoyage est signalé et fait échouer le script.

Avant le changement de configuration, ce script échoue en CI : Better Auth fabrique alors un identifiant de 32 caractères, qui n'est pas un UUID.

### Tests d'attaque

Les quatre tests d'attaque obligatoires du modèle ne s'appliquent pas : aucune route, aucune action.

- [x] `verifier-creation-auth.mts` lancé avec une `DATABASE_URL` sur un hôte distant factice : refus avant toute connexion, sans afficher l'hôte. Prouvé avec un hôte distant réel, celui de `dev` dans `.env.local` : message « Hote refuse », code 1, hôte non affiché.

### Tests de bout en bout

- [ ] Aucun nouveau. Les tests existants doivent continuer de passer.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/db/schema-auth.test.ts`
- `scripts/verifier-identifiants.mjs`
- `scripts/verifier-creation-auth.mts`
- `drizzle/<horodatage>_<nom>/` : deux migrations, générées par drizzle-kit

Modifiés :

- `src/server/auth/config.ts` : option `generateId`
- `src/server/db/schema/auth.ts` : régénéré par l'outil
- `.github/workflows/ci.yml` : deux étapes
- `package.json` : script `verifier:creation-auth`
- `CLAUDE.md` : procédure de régénération, commandes
- `docs/DESIGN.md` : section 2.1
- `docs/CONFIGURATION.md` : étape 8, commandes de référence
- `docs/features/identifiants-uuid.md` : statut

Modifiés temporairement puis rétablis à l'identique, pendant la génération : `src/server/db/client.ts`, `src/server/env.ts`, `src/server/env-schema.ts` (ligne `server-only`), et `src/server/db/schema/auth.ts` (mis de côté le temps de la première migration).

## Décisions

1. **Tables vides.** Vérifié par le développeur dans l'éditeur SQL de Neon : les 8 tables d'authentification et `compteur_debit` sont à 0 ligne sur `dev`, `preview` et `production`. La table d'exemple `playing_with_neon`, présente sur les trois branches hors de nos migrations, a été supprimée à la main (section 4.4). La vérification est refaite avant chaque migration de `preview` et de `production`.
2. **Point de retour dans Neon.** Une branche `avant-uuid` est tentée juste avant la migration de `production`. Si Neon la refuse, le déploiement continue sans elle.
3. **Chargement de `.env.local` par l'outil.** Rien n'est construit d'avance. Si la preuve montre que l'outil ne lit pas `.env.local`, l'implémentation s'arrête et le constat est remonté.
4. **Vérifications en base.** Deux scripts acceptés, provisoires : `scripts/verifier-identifiants.mjs` (lecture seule) et `scripts/verifier-creation-auth.mts`, lancé par le script npm `verifier:creation-auth`. Le second refuse de s'exécuter si l'hôte de la base n'est pas `localhost` ou `127.0.0.1`, et supprime ses lignes dans tous les cas, succès ou échec. Ils seront remplacés par des tests Vitest avec l'outillage de la 0.2.
5. **`session.active_organization_id` en `text`.** Exception acceptée, à documenter dans `DESIGN.md` section 2.1. La valeur est validée comme UUID à chaque lecture avant usage.
6. **Atomicité de `drizzle-kit migrate`.** Le constat par lecture suffit. Il reste consigné comme **point non prouvé** (section 3.3).
7. **Ordre des environnements.** `preview` avant `production`, par exception à `PLAN.md` section 5, motivée dans « Ordre de déploiement ».

Décision prise pendant la rédaction des tests : le test unitaire est placé dans `src/server/db/schema-auth.test.ts`, et non dans `src/server/db/schema/`, que drizzle-kit charge en entier (section 5).
