# Fonctionnalité : variables d'environnement

Statut : livrée

Jalon 0, fonctionnalité 0.1 de `docs/PLAN.md`. Taille S.

## Contexte

Cette fonctionnalité sert au développeur et à l'exploitation, pas à l'utilisateur final. Toutes les fonctionnalités suivantes lisent la base ou Better Auth, donc dépendent des variables d'environnement.

Aujourd'hui, `src/server/db/client.ts` lit `process.env.DATABASE_URL` directement, sous une exception temporaire d'ESLint (`eslint.config.mjs`, constante `CLIENT`). `src/server/auth/config.ts` ne passe ni secret ni adresse à Better Auth, qui va chercher lui-même `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` dans `process.env`. Rien ne vérifie ces valeurs.

Cas d'utilisation concernés : aucun.

## Problème

- Une variable absente ou mal formée ne se voit qu'à la première requête qui l'utilise, avec une erreur du pilote ou de Better Auth, parfois peu claire et susceptible de citer la valeur.
- Rien n'empêche l'application de démarrer avec l'adresse du rôle propriétaire `neondb_owner`, qui n'est pas soumis aux règles de sécurité au niveau des lignes. Une telle erreur de configuration annulerait l'isolation entre organisations.
- Rien n'empêche une connexion distante sans vérification du certificat du serveur (`sslmode=require` ou absent).
- Rien n'empêche une adresse publique de Better Auth en `http:`.
- La règle 12 de `CLAUDE.md` (`process.env` lu seulement dans `src/server/env.ts`) n'est pas encore respectée : l'exception sur `client.ts` reste en place.

## Solution retenue

Exigences couvertes : aucune exigence F ou R. Exigences de sécurité en section suivante.

### 1. Une fonction de validation pure

Un fichier sans effet de bord, `src/server/env-schema.ts`, contient le schéma Zod, les messages d'erreur et une fonction `validerEnvironnement(source)` :

- elle reçoit un objet de chaînes, du type de `process.env`, sans jamais lire `process.env` elle-même ;
- elle lit dans cet objet `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, et aussi `VERCEL_ENV` et `VERCEL_URL`, qui servent seulement à déduire `BETTER_AUTH_URL` en prévisualisation ;
- elle renvoie un objet typé et figé qui ne contient que `DATABASE_URL`, `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL`. `VERCEL_ENV`, `VERCEL_URL` et les autres clés de l'objet reçu n'y figurent pas ;
- les valeurs renvoyées sont celles reçues, sans normalisation, sauf `BETTER_AUTH_URL` lorsqu'elle est déduite ;
- en cas d'erreur, elle lève une `Error` dont le message liste **toutes** les variables fautives, une par ligne, avec le nom et la raison, jamais la valeur (S-54) ;
- l'erreur levée est une `Error` ordinaire, construite par la fonction à partir du chemin et du message de chaque problème. Elle ne transmet ni l'erreur Zod d'origine, ni de propriété `cause`, pour qu'aucune valeur ne puisse remonter dans un journal.

Ce fichier ne lit pas `process.env` : il reste donc soumis aux règles ESLint ordinaires de `src/`. Il commence par `import "server-only";` (règle 13).

### 2. Les règles de validation

Une chaîne vide est traitée comme une variable absente.

| Variable | Règle | Message (raison) |
|---|---|---|
| `DATABASE_URL` | Présente et non vide | « absente » |
| `DATABASE_URL` | URL analysable, protocole `postgres:` ou `postgresql:` | « n'est pas une adresse PostgreSQL valide » |
| `DATABASE_URL` | Le nom d'utilisateur, **après décodage** des caractères encodés (`%5F` → `_`), vaut exactement `app_facturation`. Un encodage invalide est refusé | « doit utiliser le rôle app_facturation » |
| `DATABASE_URL` | Si l'hôte n'est ni `localhost` ni `127.0.0.1` : le paramètre `sslmode` apparaît une seule fois et vaut `verify-full` | « doit exiger sslmode=verify-full » |
| `BETTER_AUTH_SECRET` | Présente et non vide | « absente » |
| `BETTER_AUTH_SECRET` | Au moins 32 caractères | « doit faire au moins 32 caractères » |
| `BETTER_AUTH_URL` | Présente et non vide, sauf en prévisualisation Vercel (voir ci-dessous) | « absente » |
| `BETTER_AUTH_URL` | URL analysable, protocole `http:` ou `https:` | « n'est pas une adresse valide » |
| `BETTER_AUTH_URL` | Protocole `https:`, sauf si l'hôte est exactement `localhost` ou `127.0.0.1` | « doit utiliser https » |

Prévisualisation Vercel :

- si `BETTER_AUTH_URL` est absente **et** que `VERCEL_ENV` vaut exactement `preview`, elle se déduit de `VERCEL_URL`, préfixée par `https://` ;
- la valeur déduite passe ensuite par les mêmes règles que `BETTER_AUTH_URL` ;
- si `VERCEL_URL` est elle aussi absente, l'erreur est « BETTER_AUTH_URL : absente » ;
- si `BETTER_AUTH_URL` est présente, elle est utilisée telle quelle, même en prévisualisation ;
- dans tout autre cas (`VERCEL_ENV` absente, `production`, `development` ou toute autre valeur), l'absence de `BETTER_AUTH_URL` est une erreur.

Une variable fautive produit une seule ligne : la première règle non respectée, dans l'ordre du tableau. Les lignes suivent l'ordre `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

Exemple de message attendu :

```
Variables d'environnement invalides :
- DATABASE_URL : doit utiliser le rôle app_facturation
- BETTER_AUTH_SECRET : doit faire au moins 32 caractères
```

Précisions :

- La comparaison de l'hôte porte sur `URL.hostname` exactement, pour les deux adresses : `localhost.exemple.com` n'est pas exempté.
- Un `sslmode` répété est refusé, même avec deux fois `verify-full`, car le pilote et la validation pourraient ne pas retenir la même occurrence.
- Le paramètre `channel_binding` n'est pas exigé.
- Les messages ne citent jamais l'hôte, le nom d'utilisateur, le mot de passe, ni la longueur reçue du secret.

### 3. Le point de lecture unique

`src/server/env.ts` devient le seul fichier qui lit `process.env` :

```ts
import "server-only";
import { validerEnvironnement } from "./env-schema";
export const env = validerEnvironnement(process.env);
```

La validation a lieu au chargement du module, donc au premier import de `env.ts` dans un processus. Une variable invalide fait échouer ce chargement avec le message ci-dessus : dans un script, le processus s'arrête ; sous Next.js, le module qui importe `env.ts` échoue (voir section 4).

### 4. La validation au lancement du serveur

`src/instrumentation.ts` exporte une fonction `register` qui importe `env.ts` :

```ts
export async function register() {
  await import("./server/env");
}
```

Next.js appelle `register` une fois au lancement de chaque instance du serveur, avant la première requête (`node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`). Une variable invalide est donc signalée au lancement, au lieu de la première requête qui touche la base ou l'authentification.

Ce que la validation au lancement garantit, et ce qu'elle ne garantit pas (constaté le 2026-10-08) :

- sous `next start`, Next.js consigne `Failed to prepare server Error: An error occurred while loading instrumentation hook:` suivi du message de validation, sans aucune valeur ;
- le processus reste vivant, et **les pages statiques restent servies** : elles sont produites à la construction et ne lisent aucune variable ;
- tout module qui importe `env.ts` échoue au chargement, avec le même message : `BETTER_AUTH_SECRET=court npm run verifier:auth` s'arrête avec le code 1 au chargement de `config.ts`.

La validation n'empêche donc pas le serveur de démarrer : elle signale l'erreur au lancement, et empêche tout code qui lit une variable de s'exécuter avec une valeur invalide. Ce comportement est accepté :

- sur Vercel, il n'y a pas de serveur permanent à arrêter ;
- arrêter le processus demanderait `process.exit`, absent sous Edge, donc un test de `process.env.NEXT_RUNTIME` dans `instrumentation.ts`, contraire à la règle 12 ;
- aujourd'hui, seules des pages statiques existent. L'effet sur une route dynamique sera vérifié au jalon 1 (voir « Suites »).

Le guide recommande de tester `process.env.NEXT_RUNTIME` seulement pour importer du code qui ne fonctionne pas dans un environnement d'exécution donné, et la page de référence (`03-api-reference/03-file-conventions/instrumentation.md`) présente ce test comme facultatif. `env.ts` et Zod fonctionnent sous Node.js comme sous Edge, et le projet n'a aucun code Edge : `instrumentation.ts` ne teste pas l'environnement et ne lit pas `process.env`.

### 5. Les consommateurs

- `src/server/db/client.ts` : `new Pool({ connectionString: env.DATABASE_URL })`.
- `src/server/auth/config.ts` : `secret: env.BETTER_AUTH_SECRET` et `baseURL: env.BETTER_AUTH_URL` passés explicitement à `betterAuth`, pour que la bibliothèque utilise les valeurs validées et non sa propre lecture de `process.env`.
- `eslint.config.mjs` : suppression de la constante `CLIENT`, de ses `ignores` et du bloc qui lui est propre. `client.ts` retombe sous les règles du dossier `src/server/db/` (B et C).

Les fichiers de `src/server/db/schema/` n'importent pas `env.ts`, pour que `drizzle-kit` continue de les charger sans variables de l'application.

### 6. Nouvelle dépendance : `zod` (règle 10)

| Point | Détail |
|---|---|
| Nom exact | `zod`, version `4.6.5`, épinglée (`--save-exact`), en dépendance de production |
| Raison | `docs/STACK.md` impose Zod pour toute validation d'entrée externe (S-50). Il sera de toute façon nécessaire dès la fonctionnalité 0.4. Zod 4.6.5 est **déjà présent** dans `node_modules` comme dépendance de `better-auth`, `@better-auth/drizzle-adapter` et `drizzle-orm` (`npm ls zod`) : l'ajout direct à la même version ne télécharge aucun code nouveau, il rend seulement la dépendance explicite |
| Pourquoi ne pas importer la copie transitive | Une dépendance non déclarée peut disparaître ou changer de version à la mise à jour de `better-auth` |
| Commande prévue | `npm install zod@4.6.5 --save-exact`, puis lecture du diff de `package-lock.json` |

Les tests n'importent pas `zod` : ils n'appellent que `validerEnvironnement`.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Validation écrite à la main, sans dépendance | Contredit `docs/STACK.md`, qui impose Zod. Deux façons de valider dans le projet dès la 0.4 |
| `valibot` | Plus léger, mais une seconde bibliothèque de validation à côté de Zod, déjà imposé et déjà installé |
| `@t3-oss/env-nextjs` | Dépendance supplémentaire. Sa séparation entre variables client et serveur ne sert à rien ici : aucune variable n'est exposée au navigateur |
| Schéma et `process.env` dans le seul `env.ts` | Le test devrait alors manipuler `process.env` (`vi.stubEnv`) avant l'import. Séparer la fonction pure rend le test indépendant de l'environnement |
| Validation paresseuse, au premier accès à une propriété | Retarde l'erreur au premier usage, à l'inverse du but « au démarrage » de `docs/STRUCTURE.md` section 3.6 |
| Refuser seulement `neondb_owner` | Laisserait passer un autre rôle privilégié créé plus tard. La liste blanche n'accepte que `app_facturation` |
| `BETTER_AUTH_URL` fixe pour Preview dans Vercel | L'adresse change à chaque déploiement de PR. La déduction depuis `VERCEL_URL` suit l'adresse réelle du déploiement |
| Ne pas valider pendant la construction (`NEXT_PHASE`) | Affaiblit la garantie. Le job « Qualité » reçoit plutôt des valeurs factices |
| Messages dans `src/textes/` | NF-01 vise les textes de l'interface. Ces messages s'adressent au développeur et restent dans `env-schema.ts` |

## Règles de sécurité et permissions

- Exigences de sécurité couvertes :
  - **S-54** : le message d'erreur nomme la variable et la raison, jamais la valeur.
  - **S-83** : les secrets restent hors du dépôt. Les valeurs des tests unitaires et du job « Qualité » sont des chaînes factices, sans rapport avec un secret réel.
  - **Règle 12 de `CLAUDE.md`** : `process.env` lu seulement dans `env.ts`, exception ESLint retirée.
  - **Règle 2 de `CLAUDE.md`** : inchangée. `env.ts` ne lit que `DATABASE_URL` et ne mentionne pas l'autre adresse.
- Menaces concernées :
  - **T-35** : une erreur provoquée par une configuration fausse ne révèle aucun secret.
  - **T-53** : aucun module qui importe `env.ts`, donc aucun accès à la base, ne se charge avec un autre rôle que `app_facturation`, en particulier le rôle propriétaire, qui contournerait les règles de sécurité au niveau des lignes.
- Matrice des droits : aucune ligne. Aucune action, aucune route.
- Tables : aucune table créée ni modifiée. Aucune migration.

## Conséquences sur la CI et les scripts

### Job « Qualité » de `ci.yml`

Le job reçoit, au niveau du job, les mêmes valeurs factices que le job d'intégration (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`). Aucune base n'y tourne : ces valeurs ne servent qu'à passer la validation si `next build` charge `instrumentation.ts` ou `env.ts`.

| Étape | Effet |
|---|---|
| `format:check`, `lint`, `typecheck` | Rien n'est exécuté |
| `npm test` | Les tests importent `env-schema.ts`, jamais `env.ts` |
| `npm run build` | Valeurs factices présentes : la validation passe si elle est déclenchée |
| `npm audit` | Aucun |

### Job « Base de données et bout en bout » de `ci.yml`

Les trois variables y sont déjà définies au niveau du job. Elles passent la validation :

- `DATABASE_URL` : rôle `app_facturation`, hôte `localhost`, donc exempté de `sslmode` ;
- `BETTER_AUTH_SECRET` : 40 caractères ;
- `BETTER_AUTH_URL` : `http://localhost:3000`, hôte `localhost`, donc exempté de `https`.

| Étape | Charge `env.ts` | Effet |
|---|---|---|
| `preparer-base-test.mjs`, `db:migrate`, `verifier-connexion.mjs`, `verifier-isolation.mjs` | Non | Inchangé |
| `npm run verifier:auth` | **Oui**, par `src/server/auth/config.ts` | Premier passage réel de la validation en CI |
| `npm run build`, `test:e2e` | Oui, par `instrumentation.ts` au lancement du serveur | Variables présentes : sans effet |

### Workflow `migrations.yml`

Inchangé. `drizzle-kit` charge `drizzle.config.ts` et `src/server/db/schema/*.ts`, qui n'importent pas `env.ts`. Seule `DATABASE_URL_MIGRATION` est fournie.

### Scripts du dossier `scripts/`

Les scripts sont hors de `src/` et ne sont pas soumis à la règle 12 : ceux qui lisent `process.env` directement restent tels quels.

| Script | Variables lues | Charge `env.ts` | Effet |
|---|---|---|---|
| `preparer-base-test.mjs` | `DATABASE_URL_MIGRATION`, `DATABASE_URL` | Non | Inchangé |
| `verifier-connexion.mjs` | Les deux adresses, depuis `.env.local` | Non | Inchangé |
| `verifier-tables.mjs` | `DATABASE_URL` | Non | Inchangé |
| `verifier-isolation.mjs` | Les deux adresses | Non | Inchangé |
| `preparer-url-application.mjs`, `renouveler-mot-de-passe-app.mjs`, `retablir-acces-dev.mjs` | `DATABASE_URL_MIGRATION`, `.env.local` | Non | Inchangé |
| `verifier-auth.mts` | Les trois variables, depuis `.env.local` | **Oui** | `dotenv` est appelé avant l'import dynamique de `config.ts`, donc avant `env.ts` : l'ordre convient. En local, `.env.local` doit désormais contenir un `BETTER_AUTH_SECRET` d'au moins 32 caractères, une `DATABASE_URL` au rôle `app_facturation` en `verify-full`, et une `BETTER_AUTH_URL` en `https:` ou sur `localhost`. À vérifier par le développeur lui-même (règle 1 : l'assistant ne lit pas ce fichier) |

### Autres outils

- `npm run dev` : Next.js charge `.env.local` lui-même, puis `instrumentation.ts` valide au lancement. Mêmes exigences que pour `verifier-auth.mts`.
- Régénération du schéma Better Auth (`npx auth@latest generate --config src/server/auth/config.ts`) : l'outil refuse toute configuration qui mène à `import "server-only";`, même par un fichier relais. Ce blocage existait avant cette fonctionnalité. La marche à suivre est consignée dans la section « Pièges connus » de `CLAUDE.md`. Voir « Suites ».
- Vercel : en Production, `BETTER_AUTH_URL` reste définie dans les réglages. En prévisualisation, elle peut être omise : elle se déduit de `VERCEL_URL`, que Vercel fournit au déploiement.

## Critères d'acceptation

- [x] `validerEnvironnement` renvoie les trois valeurs pour un objet valide, et seulement elles : ni `VERCEL_ENV`, ni `VERCEL_URL`, ni une autre clé reçue.
- [x] L'objet renvoyé est figé.
- [x] Chaque règle du tableau de la section 2 produit un message qui nomme la variable et la raison.
- [x] Plusieurs variables fautives sont toutes signalées dans un seul message, une par ligne, au format de l'exemple.
- [x] Aucun message d'erreur ne contient le mot de passe, le secret, l'hôte, le nom d'utilisateur ni l'adresse complète.
- [x] L'erreur levée est une `Error` ordinaire, sans propriété `cause`.
- [x] `DATABASE_URL` est refusée pour tout rôle autre que `app_facturation` après décodage, dont `neondb_owner` en clair ou encodé, même en `verify-full`. `app%5Ffacturation` est accepté.
- [x] Une adresse distante sans `sslmode`, avec `sslmode=require`, ou avec un `sslmode` répété, est refusée.
- [x] Une adresse sur `localhost` ou `127.0.0.1` sans `sslmode` est acceptée. Une adresse sans `channel_binding` est acceptée.
- [x] `BETTER_AUTH_URL` en `http:` est refusée, sauf sur `localhost` ou `127.0.0.1`.
- [x] En prévisualisation (`VERCEL_ENV=preview`), `BETTER_AUTH_URL` absente vaut `https://` suivi de `VERCEL_URL`. Hors prévisualisation, son absence est une erreur.
- [x] `src/instrumentation.ts` importe `env.ts` dans `register`, sans lire `process.env`.
- [x] Avec une variable invalide, l'erreur est consignée au lancement du serveur, et tout module qui importe `env.ts` échoue au chargement. Les pages statiques, qui ne lisent aucune variable, restent servies. Première partie prouvée par l'essai manuel sous `next start` avec `BETTER_AUTH_SECRET` invalide ; seconde par `BETTER_AUTH_SECRET=court npm run verifier:auth`, qui s'arrête avec le code 1 et le message attendu.
- [x] `client.ts` et `config.ts` n'utilisent que `env` ; `config.ts` passe `secret` et `baseURL` à Better Auth.
- [x] La constante `CLIENT` et ses blocs ont disparu de `eslint.config.mjs`. Un `process.env` ajouté temporairement dans `client.ts` fait échouer `npm run lint` (vérification manuelle, retirée ensuite).
- [x] `grep -rn "process.env" src/` ne trouve que `src/server/env.ts`.
- [x] `env.ts` et `env-schema.ts` commencent par `import "server-only";`.
- [x] Le job « Qualité » de `ci.yml` définit les trois variables avec les mêmes valeurs factices que le job d'intégration.
- [x] La marche à suivre pour régénérer le schéma Better Auth est consignée dans `CLAUDE.md`.
- [ ] La commande de régénération est vérifiée de bout en bout. Hors périmètre, voir « Suites ».
- [x] `zod` figure dans `dependencies` de `package.json` en version exacte `4.6.5`, sans autre changement de version dans `package-lock.json`.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` passent ; `npm run verifier:auth` passe en local.
- [x] `npm run verifier:auth` passe en CI. À constater à la première exécution de la CI sur la PR.

## Tests à écrire

Fichiers : `src/server/env-schema.test.ts` et `src/server/env-schema.attaque.test.ts`. Toutes les valeurs sont factices et construites dans le test. Les tests n'importent pas `zod`.

### Tests unitaires

Cas valides :

- [x] Objet complet valide (hôte distant, `app_facturation`, `sslmode=verify-full`, secret de 32 caractères, `BETTER_AUTH_URL` en `https:`) : valeurs renvoyées telles quelles, clés supplémentaires absentes du résultat, objet figé.
- [x] Protocole `postgresql:` accepté.
- [x] `DATABASE_URL` sur `localhost` sans `sslmode` : acceptée.
- [x] `DATABASE_URL` sur `127.0.0.1` sans `sslmode` : acceptée.
- [x] Nom d'utilisateur encodé `app%5Ffacturation` : accepté.
- [x] `BETTER_AUTH_URL` en `http:` sur `localhost` et sur `127.0.0.1` : acceptée.
- [x] Prévisualisation : `BETTER_AUTH_URL` absente, `VERCEL_ENV=preview`, `VERCEL_URL` présente : vaut `https://` suivi de `VERCEL_URL`, et `VERCEL_ENV` et `VERCEL_URL` absentes du résultat.
- [x] Prévisualisation : `BETTER_AUTH_URL` vide, même déduction.
- [x] Prévisualisation : `BETTER_AUTH_URL` présente, utilisée telle quelle.

Un test par cas d'erreur, chacun vérifiant le nom de la variable et la raison dans le message :

- [x] `DATABASE_URL` absente.
- [x] `DATABASE_URL` vide.
- [x] `DATABASE_URL` qui n'est pas une URL.
- [x] `DATABASE_URL` avec un protocole autre que PostgreSQL (`https:`).
- [x] `DATABASE_URL` avec le rôle `neondb_owner`.
- [x] `DATABASE_URL` avec un autre rôle (`autre_role`), avec `APP_FACTURATION`, avec `app_facturation2`, sans nom d'utilisateur.
- [x] `DATABASE_URL` distante sans `sslmode`.
- [x] `DATABASE_URL` distante avec `sslmode=require`.
- [x] `BETTER_AUTH_SECRET` absente, et vide.
- [x] `BETTER_AUTH_SECRET` de 31 caractères (et 32 acceptés, cas limite).
- [x] `BETTER_AUTH_URL` absente, hors de Vercel.
- [x] `BETTER_AUTH_URL` absente avec `VERCEL_ENV=production` et `VERCEL_URL` présente.
- [x] `BETTER_AUTH_URL` absente avec `VERCEL_URL` présente mais `VERCEL_ENV` absente.
- [x] `BETTER_AUTH_URL` absente avec `VERCEL_ENV=Preview` (casse différente).
- [x] `BETTER_AUTH_URL` absente en prévisualisation sans `VERCEL_URL`.
- [x] `BETTER_AUTH_URL` qui n'est pas une URL.
- [x] `BETTER_AUTH_URL` avec un protocole autre que `http:` ou `https:` (`ftp:`).
- [x] `BETTER_AUTH_URL` en `http:` sur un hôte distant.
- [x] Trois variables fautives à la fois : les trois sont citées, dans l'ordre, au format exact de l'exemple.

### Tests d'attaque

Les quatre tests d'attaque obligatoires du modèle (sans session, autre organisation, rôle non autorisé, entrée falsifiée par un utilisateur) ne s'appliquent pas : la fonctionnalité n'expose ni route ni action. Les tests ci-dessous visent les menaces de la fiche.

- [x] T-35, S-54 : pour chaque cas d'erreur, le message ne contient ni le mot de passe, ni le secret, ni l'hôte, ni le nom d'utilisateur, ni l'adresse complète reçus.
- [x] T-35 : l'erreur levée est une `Error` ordinaire, sans propriété `cause`, et aucune de ses propriétés, ni sa sérialisation (`JSON.stringify`, `String`), ne contient une valeur reçue. Une valeur courte ou numérique, comme la longueur du secret, n'est cherchée que dans le message : la pile d'appels contient des numéros de ligne qui l'imiteraient.
- [x] T-53 : `neondb_owner` refusé même avec `sslmode=verify-full`.
- [x] T-53 : `neondb%5Fowner` (nom encodé) refusé.
- [x] T-53 : nom d'utilisateur à l'encodage invalide (`app%E0facturation`) refusé, sans exception autre que l'erreur de validation.
- [x] Hôte `localhost.exemple.com` sans `sslmode` : refusé.
- [x] `sslmode=disable&sslmode=verify-full` sur un hôte distant : refusé.
- [x] `sslmode=verify-full&sslmode=verify-full` sur un hôte distant : refusé.
- [x] `BETTER_AUTH_URL` en `http:` sur `localhost.exemple.com` : refusée.

### Tests de bout en bout

- [x] Aucun nouveau. L'étape `npm run verifier:auth` de la CI prouve que la validation laisse passer une configuration correcte.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/env-schema.ts`
- `src/server/env-schema.test.ts`
- `src/server/env-schema.attaque.test.ts`
- `src/server/env.ts`
- `src/instrumentation.ts`

Modifiés :

- `src/server/db/client.ts`
- `src/server/auth/config.ts`
- `eslint.config.mjs`
- `package.json`, `package-lock.json` (ajout de `zod`)
- `.github/workflows/ci.yml` : variables factices du job « Qualité »
- `CLAUDE.md` : règle 12, retrait de la phrase sur l'exception temporaire de `client.ts` ; « Pièges connus », commande de régénération du schéma Better Auth
- `docs/STRUCTURE.md` : section 3.6, mention de `env-schema.ts` et de `instrumentation.ts`
- `docs/CONFIGURATION.md` : contraintes sur les valeurs (rôle `app_facturation`, longueur du secret, `verify-full`, `https`), et `BETTER_AUTH_URL` facultative en prévisualisation
- `docs/features/variables-environnement.md` : statut

## Décisions

1. **`BETTER_AUTH_URL` en prévisualisation.** Obligatoire, sauf en prévisualisation Vercel. Si elle est absente et que `VERCEL_ENV` vaut `preview`, elle se déduit de `VERCEL_URL`, préfixée par `https://`. Dans tout autre cas, son absence est une erreur. La fonction pure reçoit ces deux variables dans son objet source, mais ne les renvoie pas.
2. **Construction dans le job « Qualité ».** Le job reçoit les mêmes valeurs factices que le job d'intégration, dans cette fonctionnalité.
3. **Validation au démarrage.** `src/instrumentation.ts` est ajouté ; sa fonction `register` importe `env.ts`. Il ne lit pas `process.env`. Le guide de Next.js ne rend pas obligatoire le test de l'environnement d'exécution (voir section 4 de la solution).
4. **Liste blanche du rôle.** Le rôle doit être exactement `app_facturation`, après décodage. Message : « doit utiliser le rôle app_facturation ».
5. **Régénération du schéma Better Auth.** À vérifier pendant l'implémentation, et à consigner dans `CLAUDE.md`. Vérifiée : l'outil refuse toute configuration qui mène à `server-only`. La correction est hors périmètre ; la marche à suivre manuelle est consignée dans `CLAUDE.md`. Voir « Suites ».
6. **Emplacement des messages.** Les messages restent dans `env-schema.ts`.
7. **Nom du fichier pur.** `env-schema.ts`, à plat dans `src/server/`.
8. **`channel_binding`.** Non exigé.
9. **`https` pour `BETTER_AUTH_URL`** (ajout). Obligatoire, sauf si l'hôte est exactement `localhost` ou `127.0.0.1`. Message : « doit utiliser https ».
10. **Comportement sous `next start`** (après implémentation). Avec une variable invalide, l'erreur est consignée au lancement, mais le processus reste vivant et les pages statiques restent servies ; tout module qui importe `env.ts` échoue au chargement. Ce comportement est accepté. `instrumentation.ts` reste tel quel, sans `process.exit` ni lecture de `NEXT_RUNTIME` (voir section 4 de la solution).

## Suites

- **Régénération du schéma Better Auth.** `npx auth@latest generate` refuse toute configuration qui mène à `import "server-only";`, directement ou par un fichier relais. D'ici une fonctionnalité dédiée, la marche à suivre de `CLAUDE.md` s'applique : retirer temporairement cette ligne de `src/server/auth/config.ts` et des fichiers qu'il importe, lancer la commande, rétablir les lignes, puis vérifier par `git diff` que seuls les fichiers du schéma ont changé. Le chargement de `.env.local` par l'outil reste non vérifié.
- **Route dynamique.** À la première route dynamique (jalon 1), vérifier sous `next start` qu'une variable invalide fait échouer cette route.
