# CONFIGURATION.md — Guide de configuration

Application de facturation pour petites structures.
Statut : **validé**. Version du 7 octobre 2026.

## Comment lire ce document

Ce guide retrace, dans l'ordre, tout ce qui a été installé et réglé pour obtenir un projet vide mais déployé, testé automatiquement et sécurisé. Il permet de refaire la configuration sur un autre poste, ou de comprendre pourquoi un réglage existe.

Chaque étape indique son but, les commandes ou les clics, le résultat attendu, et les erreurs réellement rencontrées. Les commandes sont écrites pour Git Bash sous Windows.

Aucune valeur secrète ne figure dans ce document.

## État final

| Élément | Valeur |
|---|---|
| Dépôt | `github.com/GnonhouaN01/facturation-pme`, public |
| Site en production | `facturation-pme.vercel.app` |
| Hébergement | Vercel, fonctions à Francfort (fra1), Node.js 24 |
| Base de données | Neon, PostgreSQL 18, région AWS Europe Central 1 (Francfort) |
| Branches de base | `production` (par défaut), `preview`, `dev` |
| Rôles de base | `neondb_owner` pour les migrations, `app_facturation` pour l'application |

---

## Étape 1 — État des lieux du poste

**But.** Savoir ce qui est déjà installé avant d'ajouter quoi que ce soit.

```
node --version
git --version
npm --version
```

**Résultat.** Node.js 24, Git 2.53, npm 11. Rien à installer. Le terminal utilisé est Git Bash, reconnaissable à la mention `MINGW64`.

## Étape 2 — Git et l'éditeur

**But.** Signer les commits avec la bonne identité et préparer l'éditeur.

```
git config --global user.name "Prénom Nom"
git config --global user.email "adresse@exemple.com"
git config --global init.defaultBranch main
```

L'email doit être celui du compte GitHub, sinon les commits ne sont pas reliés au profil.

Extensions de VS Code installées, en vérifiant l'éditeur de chacune : ESLint (Microsoft), Prettier (Prettier), Tailwind CSS IntelliSense (Tailwind Labs), Playwright Test (Microsoft), Vitest (Vitest), Markdown Preview Mermaid Support (Matt Bierner), Claude Code (Anthropic).

**Point de sécurité.** Une extension est un programme qui lit vos fichiers. De fausses extensions imitent des noms connus : on vérifie l'éditeur avant d'installer.

## Étape 3 — Compte GitHub et dépôt

**But.** Protéger le compte, puis créer le dépôt et le relier au dossier local.

1. Activer la double authentification : **Settings**, **Password and authentication**, **Two-factor authentication**, par application d'authentification. Conserver les codes de récupération hors du projet.
2. Créer le dépôt : **New repository**, visibilité **Public**, sans README, sans `.gitignore`, sans licence.
3. Initialiser le dossier local et faire le premier commit :

```
mkdir -p ~/Desktop/projets/facturation-pme/docs
cd ~/Desktop/projets/facturation-pme
git init
echo "* text=auto eol=lf" > .gitattributes
git add .
git status
git commit -m "docs: dossier de préparation"
git remote add origin https://github.com/GnonhouaN01/facturation-pme.git
git push -u origin main
```

**Résultat.** Le dépôt contient le dossier `docs/` et `.gitattributes`.

**Erreurs rencontrées.**

- Le fichier `.gitattributes` avait été oublié. Git affichait des avertissements « LF will be replaced by CRLF ». Corrigé par un second commit.
- Le dossier a été créé sur le Bureau. C'est sans conséquence tant que le Bureau n'est pas synchronisé par OneDrive.

## Étape 4 — Projet Next.js, TypeScript strict et Prettier

**But.** Générer le squelette de l'application et durcir les vérifications.

```
npx create-next-app@latest . --ts --eslint --tailwind --app --src-dir --use-npm
npm run dev
```

Puis, dans `tsconfig.json`, sous `"strict": true` :

```json
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
```

```
echo "save-exact=true" > .npmrc
npm install --save-dev prettier
npm pkg set scripts.format="prettier --write ."
npm pkg set scripts.format:check="prettier --check ."
npm pkg set scripts.typecheck="next typegen && tsc --noEmit"
```

Fichiers créés : `.prettierrc.json`, `.prettierignore` (qui exclut `.next`, `node_modules`, `package-lock.json`, `docs` et `drizzle`), `.vscode/settings.json` pour le formatage à l'enregistrement.

**Résultat.** `npm run typecheck` et `npm run lint` ne signalent rien.

**Erreurs rencontrées.**

- `.npmrc` avait été oublié une première fois : Prettier était enregistré avec une marge de version. Corrigé en le réinstallant.
- La commande `typecheck` d'origine, `tsc --noEmit`, dépendait de types que Next.js génère dans le dossier `.next`. Elle réussissait sur le poste et échouait sur la CI. La commande `next typegen` les génère d'abord.

## Étape 5 — Tailwind et shadcn/ui

**But.** Disposer de composants d'interface accessibles.

```
npx shadcn@latest init
npx shadcn@latest add button
```

Tailwind est installé par le générateur de Next.js. shadcn/ui copie le code des composants dans `src/components/ui/`.

**Point de sécurité.** Le site officiel est `ui.shadcn.com`. On n'ajoute un composant que par son nom, jamais par une adresse.

**Erreur rencontrée.** L'initialisation avait rangé le paquet `shadcn` parmi les dépendances livrées. Il ne sert qu'à la construction : il a été déplacé avec `npm install --save-dev shadcn@4.21.1`.

## Étape 6 — Variables d'environnement et secrets

**But.** Fixer les règles avant l'arrivée du premier secret.

```
printf '\n!.env.example\n' >> .gitignore
cp .env.example .env.local
git status --short
```

| Règle | Détail |
|---|---|
| Les secrets locaux vivent dans `.env.local` | Jamais commité |
| Le dépôt contient `.env.example` | Les noms des variables, sans valeur |
| Chaque environnement a ses secrets | Développement, prévisualisation et production ne partagent rien |
| Le préfixe `NEXT_PUBLIC_` est réservé aux valeurs publiques | Next.js envoie ces variables au navigateur |
| `.env.local` ne s'ouvre pas dans l'éditeur | Il se modifie par les scripts du dossier `scripts/` |

**Résultat.** `git status --short` ne montre jamais `.env.local`.

**Contraintes sur les valeurs.** `src/server/env-schema.ts` les vérifie au lancement du serveur et au premier import de `src/server/env.ts`. Une valeur invalide est signalée par le nom de la variable et la raison, jamais par la valeur.

| Variable | Contrainte |
|---|---|
| `DATABASE_URL` | Adresse `postgres:` ou `postgresql:`, rôle exactement `app_facturation`. Hors de `localhost` et `127.0.0.1` : `sslmode=verify-full`, une seule fois. `channel_binding` n'est pas exigé |
| `BETTER_AUTH_SECRET` | Au moins 32 caractères |
| `BETTER_AUTH_URL` | Adresse `https:`. `http:` n'est admis que sur `localhost` ou `127.0.0.1`. Facultative en prévisualisation Vercel (étape 10) |

**Si un secret est exposé :** le renouveler immédiatement. Supprimer le commit ne suffit pas.

## Étape 7 — Base de données Neon, rôles et Drizzle

**But.** Créer la base, un rôle restreint pour l'application, et prouver l'isolation entre organisations.

### 7a. Projet

Compte Neon créé avec GitHub. Projet `facturation-pme`, région Europe (Francfort), tous les services annexes désactivés. La région ne se change plus ensuite.

**Erreur rencontrée.** Le compte était rattaché à une organisation gérée par Vercel, qui interdit la création de projets depuis Neon. Résolu par **Create organization**, pour obtenir une organisation indépendante.

### 7b. Rôle restreint

Créé **en SQL**, car un rôle créé par la console reçoit les droits d'administration.

```sql
CREATE ROLE app_facturation WITH LOGIN PASSWORD '...'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_facturation;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_facturation;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_facturation;
```

**Résultat.** Dans `pg_roles`, `app_facturation` a ses quatre attributs sensibles à `false`, alors que `neondb_owner` peut contourner l'isolation.

### 7c et 7d. Drizzle et première migration

```
npm install drizzle-orm@rc pg
npm install --save-dev drizzle-kit@rc @types/pg tsx dotenv
npm pkg set scripts.db:generate="drizzle-kit generate"
npm pkg set scripts.db:migrate="drizzle-kit migrate"
npm run db:generate
npm run db:migrate
```

Deux variables : `DATABASE_URL`, rôle restreint et connexion groupée, et `DATABASE_URL_MIGRATION`, rôle propriétaire et connexion directe. Les deux en `sslmode=verify-full`.

La version candidate de Drizzle est celle que sa documentation officielle recommande pour PostgreSQL.

### 7e. Preuve de l'isolation

```
node scripts/verifier-isolation.mjs
```

**Résultat.** Six contrôles au vert : sans organisation active on ne voit rien, avec l'organisation A on ne voit que A, on ne peut ni écrire ni modifier chez B, et l'organisation active ne déborde pas sur la requête suivante.

## Étape 8 — Better Auth

**But.** Installer la bibliothèque d'authentification et créer ses tables, sans rien exposer.

```
npm install better-auth @better-auth/drizzle-adapter
npx auth@latest generate --config src/server/auth/config.ts --output src/server/db/schema/auth.ts --yes
npm run db:generate
npm run db:migrate
npm run verifier:auth
```

L'adaptateur utilisé est `@better-auth/drizzle-adapter/relations-v2`, requis par la version 1.0 de Drizzle. Extensions activées : double authentification et organisations.

**Résultat.** Huit tables créées. Le rôle de l'application accède à neuf tables. Better Auth lit la table `user`.

**Décision.** La route `/api/auth` n'est pas créée à ce stade : elle exposerait l'inscription sans les règles de sécurité des comptes.

**Erreurs rencontrées.**

- `npm install` a signalé neuf failles élevées. Elles se ramenaient à une seule, dans le paquet `braces`, amené par des outils de développement. Triée, puis consignée dans `docs/EXCEPTIONS-SECURITE.md`. La commande `npm audit fix --force` n'a pas été utilisée.
- L'outil de génération a annulé deux fois : des commandes collées à la suite répondaient à sa question à sa place. Résolu en le lançant seul, avec `--yes`.

## Étape 9 — Vitest et Playwright

**But.** Disposer de deux niveaux de tests et vérifier qu'un test sait échouer.

```
npm install --save-dev @types/node@24
npm install --save-dev vitest
npm install --save-dev @playwright/test
npx playwright install chromium
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:e2e="playwright test"
```

Vitest exécute les fichiers `src/**/*.test.ts`, Playwright ceux du dossier `e2e/`.

**Erreurs rencontrées.**

- Vitest 5 exigeait `@types/node` en version 22 ou 24, alors que le générateur avait installé la 20. Corrigé en alignant les types sur la version réelle de Node.
- Le module React pour Vite entrait en conflit avec un paquet amené par `shadcn`. Décision : renoncer aux tests de composants en navigateur simulé. La logique serveur se teste avec Vitest, l'interface avec Playwright.

## Étape 10 — Vercel et les trois environnements

**But.** Mettre l'application en ligne, avec une base et des secrets distincts par environnement.

1. Dans Neon, créer les branches `dev` et `preview` à partir de `production`, option **Branch data and schema**, case **Automatically delete branch after décochée**.
2. Dans Vercel, importer le dépôt en limitant l'accès à ce seul dépôt. Régler **Function Region** sur Francfort et **Node.js Version** sur 24.
3. Pour `preview` puis `production`, préparer l'adresse de l'application et la coller dans Vercel :

```
node scripts/preparer-url-application.mjs
```

Le script attend que l'adresse du propriétaire soit copiée dans Neon, renouvelle le mot de passe de `app_facturation` sur cette branche, vérifie la connexion et place l'adresse de l'application dans le presse-papiers.

4. Variables saisies dans Vercel :

| Variable | Type | Environnements |
|---|---|---|
| `DATABASE_URL` | Secret | Production, et une autre valeur pour Preview |
| `BETTER_AUTH_SECRET` | Secret | Production, et une autre valeur pour Preview |
| `BETTER_AUTH_URL` | Config | Production |

`DATABASE_URL_MIGRATION` n'est jamais saisie dans Vercel.

En prévisualisation, `BETTER_AUTH_URL` n'est pas saisie : quand elle est absente et que `VERCEL_ENV` vaut `preview`, l'application la déduit de `VERCEL_URL`, fournie par Vercel à chaque déploiement, préfixée par `https://`. En production, son absence empêche l'application de fonctionner.

**Résultat.** Le site répond. Chaque PR obtient une prévisualisation protégée par connexion.

**Erreurs rencontrées.**

- Les branches `dev` et `preview` ont été supprimées par Neon au bout d'un jour : la case de suppression automatique est cochée par défaut. Recréées sans elle, puis reconnectées avec `scripts/retablir-acces-dev.mjs`.
- Une adresse de connexion collée dans le terminal a été affichée, puis partagée. Le mot de passe a été renouvelé aussitôt par **Reset password**.
- Copier une commande efface le contenu du presse-papiers. Les scripts attendent donc une pression sur Entrée avant de le lire.

## Étape 11 — Emails et suivi des erreurs

Reportés au moment où une fonctionnalité en aura besoin. L'envoi d'emails passera par un compte Gmail dédié à l'application, gratuit et sans nom de domaine.

## Étape 12 — Claude Code

**But.** Encadrer l'assistant de code à trois niveaux.

| Niveau | Fichier | Nature |
|---|---|---|
| Consignes | `CLAUDE.md` | Treize règles de sécurité, la méthode de travail, les pièges connus |
| Permissions | `.claude/settings.json` | Ce qui est interdit, ce qui demande un accord, ce qui est libre |
| Hook | `.claude/hooks/apres-modification.mjs` | Formatage et analyse de chaque fichier modifié |
| Skill | `.claude/skills/interface/SKILL.md` | Règles d'interface, chargées à la demande |

Interdictions principales : lire ou modifier `.env.local`, modifier `drizzle/`, le schéma d'authentification généré et le dossier `.claude/`, lancer `curl`, `npm audit fix`, un envoi forcé, ou un script qui change un mot de passe.

**Résultat vérifié.** L'assistant refuse de lire `.env.local`, refuse d'installer un paquet sans justification, et ses fichiers sont formatés automatiquement.

## Étape 13 — Protection de la branche principale

**But.** Empêcher toute modification directe de `main`.

Dans **Settings**, **Rules**, **Rulesets**, règle `protection-main` sur la branche par défaut : suppression interdite, pull request obligatoire, envoi forcé interdit, et trois contrôles obligatoires (Qualité, Base de données et bout en bout, CodeQL). Liste d'exceptions vide.

Dans **Advanced Security** : alertes et mises à jour Dependabot, détection de secrets, blocage à l'envoi, analyse CodeQL.

**Résultat vérifié.** Un envoi direct sur `main` est refusé. Une PR dont la CI échoue ne peut pas être fusionnée.

## Étape 14 — Vérification d'ensemble

**But.** Faire traverser toute la chaîne à un vrai changement.

Une branche, une modification confiée à Claude Code avec le test écrit d'abord, une PR, la prévisualisation sur Vercel, la fusion, la mise en production. La première PR a corrigé le titre et la langue de la page.

## Intégration continue

Deux fichiers dans `.github/workflows/`.

| Workflow | Déclenchement | Contenu |
|---|---|---|
| `ci.yml`, groupe Qualité | Chaque PR, chaque envoi sur `main` | Formatage, analyse du code, types, tests unitaires, construction, audit du code livré |
| `ci.yml`, groupe Base de données et bout en bout | Idem | PostgreSQL 18 temporaire, rôle restreint, migrations, rôles, isolation, Better Auth, construction, tests dans Chromium |
| `migrations.yml` | À la demande, depuis `main` | Migrations de `preview`, ou de `production` après approbation |

Les deux workflows n'ont que le droit de lire le code. Les mots de passe écrits dans `ci.yml` ne protègent qu'une base qui vit quelques minutes.

## Commandes de référence

| Besoin | Commande |
|---|---|
| Lancer l'application | `npm run dev` |
| Tout vérifier avant une PR | `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build` |
| Vérifier les connexions | `node scripts/verifier-connexion.mjs` |
| Vérifier l'isolation | `node scripts/verifier-isolation.mjs` |
| Vérifier Better Auth | `npm run verifier:auth` |
| Renouveler le mot de passe applicatif de `dev` | `node scripts/renouveler-mot-de-passe-app.mjs` |
| Rétablir l'accès à `dev` après recréation de la branche | `node scripts/retablir-acces-dev.mjs` |
| Afficher les adresses sans les mots de passe | `sed -E 's#://([^:]+):[^@]+@#://\1:****@#' .env.local \| grep DATABASE` |
| Auditer le code livré | `npm audit --omit=dev` |
