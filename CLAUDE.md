@AGENTS.md

# Facturation PME

Application de facturation multi-organisation pour petites structures (Côte d'Ivoire, francs CFA).

## Documents de référence

Lis la section utile avant toute tâche. Ne les charge pas en entier.

- `docs/SPEC.md` : exigences numérotées (F fonctionnelle, R règle métier, S sécurité, NF non fonctionnelle)
- `docs/USECASES.md` : cas d'utilisation, erreurs et cas d'abus
- `docs/THREATS.md` : menaces (T), matrice des droits en section 6
- `docs/DESIGN.md` : modèle de données, chaîne de contrôles en section 3.2, règles d'architecture en 4.3
- `docs/STACK.md` : outils retenus et choix écartés
- `docs/STRUCTURE.md` : structure des dossiers, règles d'import en section 7
- `docs/EXCEPTIONS-SECURITE.md` : failles connues et acceptées
- `docs/CONTRIBUTING.md` : conventions de branches, de commits et de PR. Modèle de fiche : `docs/features/_modele.md`
- `docs/PLAN.md` : jalons, ordre des fonctionnalités, stratégie de tests, définition de « terminé »
- `docs/CONFIGURATION.md` : installation et réglages, commandes de référence

## Commandes

- `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format`
- `npm test` : Vitest, projet `unitaires`, fichiers `src/**/*.test.ts` sauf `*.integration.test.ts`. Sans base
- `npm run test:integration` : Vitest, projet `integration`, fichiers `src/**/*.integration.test.ts`. Avec base : refuse toute base sans la marque de test
- `npm run test:e2e` : Playwright, dossier `e2e/`
- `npm run db:generate` puis lecture du SQL généré, puis `npm run db:migrate`
- `node scripts/verifier-connexion.mjs`, `verifier-tables.mjs`, `verifier-isolation.mjs`
- `npm run verifier:auth` : vérifie que Better Auth lit la base (tsx avec la condition `react-server`, requise par `server-only`)

## Règles de sécurité (non négociables)

1. Ne lis, n'affiche et ne modifie jamais `.env.local`. N'écris aucun secret dans le code, les tests, les journaux ou les commits.
2. Aucun fichier de `src/` ne mentionne `DATABASE_URL_MIGRATION`. L'application n'utilise que `DATABASE_URL`, le rôle restreint `app_facturation`.
3. Toute table métier porte `organisation_id NOT NULL` et une règle de sécurité au niveau des lignes, activée et forcée. Modèle unique : `src/server/db/schema/isolation.ts` (`pgTable.withRLS`, `colonneOrganisation()`, `regleIsolation()`), plus un index dont `organisation_id` est la première colonne. Le forçage s'ajoute par une migration `--custom` (voir « Méthode de travail »). Chaque table appelle `verifierIsolation` dans son test d'intégration ; le test d'inventaire refuse toute table non conforme.
4. Toute requête passe par la couche d'accès aux données. `drizzle-orm` ne s'importe que dans `src/server/db/`. Aucune requête construite par concaténation. **Toute requête métier s'exécute dans `executerDansOrganisation`** (`src/server/db/client.ts`), qui fixe l'organisation active par `set_config('app.organisation_id', $1, true)` dans la transaction. Jamais `SET`, `SET LOCAL` ni `set_config(..., false)`. `db` ne s'importe que dans `src/server/auth/config.ts` et `src/server/db/` (règle ESLint).
5. Toute action serveur et toute route passe par la fonction commune de contrôle : origine, session, rôle, validation. La matrice des droits vit dans un seul fichier.
6. Un accès refusé reçoit la même réponse qu'une ressource inexistante (S-02).
7. Toute entrée externe est validée côté serveur par un schéma Zod. Le serveur recalcule les totaux et ignore ceux reçus.
8. Les montants sont des entiers en francs CFA. Aucun nombre à virgule flottante.
9. Un document émis, un paiement et le journal d'audit ne sont jamais modifiés ni supprimés. **Toute écriture au journal d'audit passe par `journaliser`** (`src/server/journal/audit.ts`), dans la transaction de l'action qu'elle décrit ; elle n'accepte que les actions de la liste fermée (`src/server/journal/actions.ts`) et des détails stricts, sans texte libre. `src/server/db/requetes/journal.ts` ne s'importe que depuis `audit.ts` (règle ESLint). Une table en ajout seul (aujourd'hui `journal_audit`) n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` pour le rôle de l'application (migration `retirer-droits-<table>`), figure dans `TABLES_AJOUT_SEUL` du test d'inventaire, et passe `verifierIsolation(..., { ajoutSeul: true })`.
10. Aucune nouvelle dépendance sans accord explicite : propose le nom exact, la raison et une alternative. Jamais `npm audit fix`. Composants shadcn par leur nom uniquement, jamais par une adresse.
11. Aucune route exposée, dont `/api/auth`, hors d'une fiche de fonctionnalité validée.
12. `process.env` ne se lit que dans `src/server/env.ts`. Les règles de validation vivent dans `src/server/env-schema.ts`, une fonction pure qui ne lit pas `process.env`.
13. Tout fichier de `src/server/` commence par `import "server-only";`, sauf ceux de `src/server/db/schema/` : drizzle-kit les charge hors de Next.js, et `auth.ts` est généré. Sous Vitest, un alias remplace `server-only` par `tests/stubs/server-only.ts`.
14. Le module `testUtils` de Better Auth (sessions sans mot de passe) n'existe que dans l'instance de test de `src/server/db/outils-test/membres.ts`. Jamais dans `optionsAuth` ni `auth` (`src/server/auth/config.ts`), même sous condition. Le mot `testUtils` n'apparaît dans `src/` que dans les tests et `outils-test/`, y compris dans les commentaires : `config.test.ts` le vérifie.

## Méthode de travail

- Une fonctionnalité correspond à une fiche `docs/features/<nom>.md`, validée avant d'écrire le code : contexte, problème, solution retenue, sécurité et permissions, critères d'acceptation, tests, statut.
- Les tests d'abord : écris les tests, dont les tests d'attaque des menaces citées dans la fiche, montre qu'ils échouent, puis implémente.
- Avant de dire qu'une tâche est terminée : `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, et `npm run test:integration` sur `dev` si la base est concernée. Montre les sorties. N'affirme rien sans preuve.
- Ne modifie que les fichiers du périmètre de la tâche. Si un autre changement semble nécessaire, demande.
- Ne modifie jamais une migration déjà appliquée, ni le dossier `drizzle/` à la main. **Seules exceptions écrites**, deux formes de migration personnalisée :
  - une migration créée par `npx drizzle-kit generate --custom --name forcer-isolation-<table>`, dont le seul contenu est une ou plusieurs lignes `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;` ;
  - pour une table en ajout seul, une migration créée par `npx drizzle-kit generate --custom --name retirer-droits-<table>`, dont le seul contenu est une ou plusieurs lignes `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "<table>" FROM "app_facturation";`. Jamais `GRANT`. Fiche : `docs/features/journal-audit.md`, section 2.2.

  Dans les deux cas, l'assistant crée le fichier vide par la commande et indique la ligne exacte ; le développeur la colle. L'assistant n'écrit jamais dans `drizzle/`.

- Une branche par fonctionnalité (`feat/...`, `fix/...`). Commits au format `type(portée): message`, en français.
- Interface en français, textes regroupés dans des fichiers dédiés (NF-01).
- En cas de doute sur une exigence, demande. N'invente pas de règle métier.

## Pièges connus

- Drizzle 1.0 en version candidate avec Better Auth : utiliser `@better-auth/drizzle-adapter/relations-v2`. Le fichier `src/server/db/schema/auth.ts` est généré, ne l'édite pas à la main. Pour le régénérer : l'outil refuse une configuration qui mène à `import "server-only";`. Retire temporairement cette ligne de `src/server/auth/config.ts` et de tous les fichiers de `src/server/` qu'il importe, directement ou non (aujourd'hui `src/server/db/client.ts`, `src/server/env.ts`, `src/server/env-schema.ts`), lance `BETTER_AUTH_TELEMETRY=0 npx auth@<version de better-auth> generate --config src/server/auth/config.ts --output src/server/db/schema/auth.ts --yes`, rétablis les lignes, lance `npx prettier --write src/server/db/schema/auth.ts`, puis vérifie par `git diff --stat` que seuls `auth.ts` et, le cas échéant, `config.ts` ont changé. **Toujours `auth@<version exacte>`, égale à celle de `better-auth` dans `package.json`, jamais `auth` seul ni `@latest`** : le nom `auth` existe depuis 2012 et a changé de propriétaire, et l'outil tire des dépendances à versions flottantes. Constaté le 2026-10-08 avec `auth@1.7.7` : l'outil charge lui-même `.env` puis `.env.local` avant la configuration, sans écraser une variable du terminal ; aucune variable du projet n'est à définir. `config.ts` charge `env.ts` : les trois variables de `.env.local` doivent être valides. Pour passer des identifiants `text` aux `uuid` sans conversion sur place, la marche suivie est décrite dans `docs/features/identifiants-uuid.md`, section 3.2.
- Connexion groupée de Neon : l'organisation active se fixe avec `set_config('app.organisation_id', ..., true)` à l'intérieur d'une transaction. C'est le rôle d'`executerDansOrganisation`, à ne jamais contourner.
- Marque de la base de test : le commentaire de base exact `environnement:test`, posé par `scripts/retablir-acces-dev.mjs` (sur `dev`) et `scripts/preparer-base-test.mjs` (en CI). `ALTER DATABASE ... SET` est refusé par Neon. Une branche `dev` recréée perd la marque : les tests d'intégration refusent alors de tourner, c'est voulu. Ne jamais poser la marque sur `preview` ni `production`.
- Outillage des tests avec base : `src/server/db/outils-test/`, importable seulement depuis un fichier de test (règle ESLint). Toujours enregistrer `nettoyer` par `onTestFinished` ou `afterAll`. Une table en ajout seul se passe à `creerDeuxOrganisations` par `tablesAjoutSeul`, jamais par `tables` : le rôle de l'application ne peut pas en supprimer les lignes, et `nettoyer` laisse alors sur `dev` les organisations qui y ont écrit (environ 4 par exécution, accepté). Seuls `src/server/db/**/*.test.ts` peuvent importer `db` et `drizzle-orm` : un test d'intégration qui en a besoin vit dans `src/server/db/`.
- Membres et sessions réelles en test : `creerMembre` et `nettoyerMembres` (`outils-test/membres.ts`). Dans `afterAll`, appeler le `nettoyer` des organisations d'abord, puis `nettoyerMembres` dans un `finally` : un échec ne laisse alors aucune organisation sur `dev`.
- PostgreSQL 18 renvoie `23001` (et non `23503`) pour une suppression refusée par une clé en `ON DELETE RESTRICT`.
- Zod 4 donne le même type à `z.object` et à `z.strictObject` (`$strip` et `$strict` ont la même forme) : un type ne peut pas exiger un schéma strict. `declarerAction` le vérifie à l'exécution (`docs/features/chaine-controles.md`, section 3.2).
- Poste sous Windows avec Git Bash. Fins de ligne au format LF.
- Après l'arrêt d'un serveur local par Ctrl+C, vérifier que le port est libre (`netstat -ano | grep ":3000"`) avant de relancer. Un essai a montré des erreurs d'un lancement précédent, sans cause établie.
