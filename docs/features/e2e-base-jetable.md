# Fonctionnalité : base jetable pour les tests de bout en bout

Statut : en cours (PR ouverte). Décisions du développeur le 2026-10-14, à la suite de la proposition faite pendant la PR 2 de la 1.1.

Outillage, hors jalon. Taille S. Aucune exigence fonctionnelle ; règle 1 de `CLAUDE.md` (secrets), risque « Tests sur la branche `dev` » de `docs/PLAN.md`, section 7.

## Contexte

Le développeur lance `npm run verifier` avant chaque PR, donc `npm run test:e2e`. Depuis la 1.1, la suite de bout en bout écrit en base : comptes d'inscription, compteurs de débit, emails comptés par `email.compte`.

État au départ, constaté le 2026-10-14 :

- En local, `next start` lit `DATABASE_URL` dans `.env.local` : les serveurs de bout en bout écrivent dans `dev`.
- En CI, le job « Base de données et bout en bout » a son service PostgreSQL 18, neuf à chaque exécution, préparé par `scripts/preparer-base-test.mjs` puis `npm run db:migrate`.
- Seul le serveur en panne (port 3101) écrit sa sortie dans un fichier, temporaire, relu par le test T-39. La sortie du site (port 3000) n'est conservée nulle part.

## Problème

- **Dette `email.compte` partagée sur `dev`** (`PLAN.md`, section 7) : environ 6 emails par exécution, 100 par 24 heures pour toutes les exécutions ; au-delà d'une quinzaine d'exécutions par jour, les tests du parcours d'inscription échouent sans faute du code. La 1.2 et la 1.3 ajoutent des emails.
- Une exécution interrompue laisse des comptes et des compteurs sur `dev`.
- Si une réponse 500 réapparaît pendant la suite, rien ne permet de l'expliquer après coup.

## Solution retenue

### 1. Trois modes, choisis par `scripts/e2e-base-jetable.mjs`

`npm run test:e2e` devient `node scripts/e2e-base-jetable.mjs`. Les arguments suivent jusqu'à Playwright (`npm run test:e2e -- e2e/inscription.spec.ts`).

| Mode | Condition | Base des serveurs |
|---|---|---|
| CI | `CI` défini (comme `forbidOnly` de `playwright.config.ts`) | Le service PostgreSQL du workflow, inchangé : Playwright est lancé tel quel |
| Secours | `E2E_BASE=dev` | `dev`, par `.env.local` lu par `next start`, comme avant cette fiche. La dette `email.compte` reste propre à ce mode |
| Jetable | Ni l'un ni l'autre | Un PostgreSQL 18 dans Docker, créé et supprimé par le script |

Toute autre valeur de `E2E_BASE` est refusée (une faute de frappe ne doit pas mener à `dev`). `.github/workflows/ci.yml` ne change pas.

### 2. Déroulé du mode jetable

1. `docker info` : en échec (Docker absent ou arrêté), message clair et code 1, sans rien lancer :
   « Docker est requis par npm run test:e2e hors CI (base PostgreSQL jetable). Démarrer Docker Desktop, attendre « Engine running », puis relancer. Sortie de secours, sur la branche dev : E2E_BASE=dev npm run test:e2e. »
2. Restes d'une exécution tuée (fenêtre fermée, `taskkill`) : les conteneurs portant l'étiquette `facturation-pme.e2e-base-jetable` sont supprimés. Une seule exécution à la fois, comme l'imposent déjà les ports 3000 et 3101.
3. `docker run --detach --rm --name facturation-pme-e2e-<hasard> --label facturation-pme.e2e-base-jetable=1 --env POSTGRES_PASSWORD --env POSTGRES_DB=facturation_test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql postgres:18@sha256:74935e72…` :
   - image épinglée par son empreinte (PostgreSQL 18.6, image du 2026-10-06), constante `IMAGE` du script ;
   - port publié sur `127.0.0.1` seulement, numéro choisi par Docker ;
   - mot de passe du propriétaire tiré au hasard, passé par l'environnement de la commande `docker` et non par ses arguments ;
   - données en mémoire (`tmpfs`) : aucun volume créé, rien sur le disque.
4. `docker port <nom> 5432/tcp` doit répondre une seule ligne `127.0.0.1:<port>` ; sinon refus.
5. Attente de la base par une connexion TCP (la base d'initialisation de l'image n'écoute que sur sa socket locale), 60 s au plus.
6. Préparation comme la CI : `node scripts/preparer-base-test.mjs` (rôle `app_facturation`, marque de test), puis `drizzle-kit migrate`, avec `DATABASE_URL_MIGRATION` et `DATABASE_URL` du conteneur.
7. Playwright, avec `DATABASE_URL` du conteneur et **sans** `DATABASE_URL_MIGRATION`. `next start` ne remplace pas une variable déjà posée par une valeur de `.env.local` ; `BETTER_AUTH_SECRET` en vient toujours. Le nettoyage des comptes (`e2e/nettoyer-comptes.ts`) lit la même `DATABASE_URL`.
8. Dans tous les cas (succès, échec d'une étape, Ctrl+C, `SIGTERM`, fermeture de la fenêtre) : `docker rm -f -v <nom>`. Après un signal, Playwright a 15 s pour arrêter ses serveurs, puis il est arrêté ; code 130. Un conteneur impossible à supprimer est signalé avec la commande à lancer, et l'exécution échoue.

Durées affichées à chaque exécution : préparation (étapes 3 à 6) et suppression.

### 3. Garde-fous

- Refus si `VERCEL_ENV` est défini, quelle que soit sa valeur, dans les trois modes, avant toute commande.
- Refus si l'hôte d'une adresse de base construite n'est pas `127.0.0.1` (ni `localhost`, ni `0.0.0.0`, ni un hôte distant), ou si le port publié n'est pas sur `127.0.0.1`.
- Le script ne lit jamais `.env.local` : ni `dotenv`, ni `node:fs`. Seuls `next start` (pour `BETTER_AUTH_SECRET`) et `drizzle.config.ts` le chargent, comme avant ; `drizzle.config.ts` n'écrase pas `DATABASE_URL_MIGRATION` déjà posée par le script, qui vise donc le conteneur.
- `DATABASE_URL_MIGRATION` n'apparaît que dans ce script (hors `src/`, règle 2), n'est construite que vers le conteneur et n'est transmise qu'à la préparation et aux migrations.
- **Verrou avant drizzle-kit** (ajouté le 2026-10-14, avant le push) : `drizzle.config.ts` charge `.env.local` sans écraser `DATABASE_URL_MIGRATION` ; si le script lançait un jour drizzle-kit sans l'avoir posée, les migrations partiraient sur `dev` avec le rôle propriétaire. Juste avant le lancement, `verifierAdresseMigration` exige que la variable soit définie dans l'environnement transmis, d'hôte `127.0.0.1` et du port du conteneur ; sinon refus, conteneur supprimé, code 1, drizzle-kit jamais lancé. Le message ne cite ni l'adresse refusée ni son mot de passe.
- Les mots de passe du conteneur sont tirés à chaque exécution, jamais affichés ni écrits.

### 4. Sortie des serveurs conservée

- Chaque serveur de `playwright.config.ts` passe par `e2e/lancer-serveur.mjs` (l'ancien `e2e/lancer-serveur-panne.mjs`, généralisé) : sortie standard et sortie d'erreur dans `.e2e-journaux/<horodatage>-site.log` et `-panne.log`, dossier ignoré par git. La sortie d'erreur du site reste aussi affichée dans le terminal, comme avant.
- Dans les trois modes, CI comprise. Les dix exécutions les plus récentes sont gardées (`e2e/journaux.ts`).
- Le test T-39 relit toujours `JOURNAL_PANNE_E2E`, désormais dans ce dossier.

### 5. Docker, prérequis de `npm run verifier`

Inscrit dans `docs/CONFIGURATION.md` (étape 9 et commandes de référence). Image tirée à la première exécution.

### 6. Boîte des emails et test 46 de la double authentification (correctif du 2026-10-25, `fix(e2e)`)

**Constat.** `e2e/double-authentification.spec.ts:46` (parcours complet : activation, connexion par code, par code de secours) dépassait sa limite de 30 s, de façon intermittente depuis plusieurs jours, avant comme après le filtre de `console.error` (T-39). Mesure sur `origin/main`, 10 passages lancés ensemble (`--repeat-each=10`, `ordinateur-1280`, traçage) : **2 réussis sur 10**, de 23,6 à 34,6 s, chute à l'attente de l'email « Code de secours utilisé ».

**Causes, établies par les traces de Playwright :**

1. **Boîte des emails jamais vidée et relue en entier.** Le transport `fichier` écrivait dans un dossier commun à toutes les exécutions (`<tmp>/facturation-pme-e2e-emails`), jamais vidé depuis la 0.7 : 3 131 fichiers (15 Mo) le 2026-10-25. Chaque tentative d'un `expect.poll` sur les emails (`messagesPour`) relisait et analysait tous les fichiers : 396 ms par tentative, davantage avec les tests lancés ensemble (10 lectures simultanées : `EMFILE`). Les deux attentes d'email du test coûtaient 3,2 à 7,4 s, et le coût croissait à chaque exécution.
2. **Près de 3 000 `expect` pour une vérification.** La vérification finale des adresses demandées (environ 240 adresses × 12 secrets) faisait un `expect` par paire, chacun une étape de Playwright : environ 5 s du test sous charge.

Écartés par les traces : hachage du mot de passe, redirections, hydratation (aucune étape au-delà de 2 s).

**Correctif, dans `e2e/` seulement, limite de 30 s inchangée :**

- `e2e/boite-emails.ts` : un dossier par exécution (`<tmp>/facturation-pme-e2e-emails/<exécution>`, l'identifiant de `comptes-e2e.ts`), posé sur chaque serveur par `playwright.config.ts` et supprimé en fin d'exécution par `e2e/nettoyer-comptes.ts` (seul un enfant direct de la racine au nom d'une exécution peut l'être) ; lecture incrémentale, chaque fichier lu une fois par processus, un fichier incomplet repris à la tentative suivante. `compte-verifie.ts` et `inscription.spec.ts` s'en servent au lieu de leur copie de `messagesPour`. Test : `e2e/boite-emails.spec.ts`, sans navigateur.
- Test 46 : une assertion par liste (adresses portant un secret, corps portant une valeur interdite), aussi stricte, qui nomme les éléments fautifs.

**Preuve**, mêmes conditions (10 passages lancés ensemble) : avec traçage, **10 sur 10**, de 12,8 à 25,9 s (moyenne 21,4 s, contre 30,9 s avant) ; avec la configuration normale (traçage au premier nouvel essai), **10 sur 10**, de 8,9 à 15,7 s (moyenne 12,1 s).

Le dossier commun laissé par les exécutions antérieures n'est plus lu ; il peut être supprimé à la main (`<tmp>/facturation-pme-e2e-emails/*.json`).

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Vider les compteurs de `dev` en fin de suite | Écrit dans `dev` ; ne règle ni une exécution interrompue, ni deux postes |
| Limite `email.compte` propre aux serveurs de test | Change la configuration de l'application pour les tests |
| Branche Neon jetable | Clé d'API de Neon sur le poste, réseau, quota de branches |
| `testcontainers` | Nouvelle dépendance, pour ce que quelques commandes `docker` font |
| PostgreSQL installé sur le poste | Ni jetable ni épinglé ; état conservé d'une exécution à l'autre |

## Règles de sécurité et permissions

- Menaces : aucune de l'application. Risques d'outillage : base exposée au réseau local (port sur `127.0.0.1` seulement), exécution contre un déploiement (`VERCEL_ENV`), secret lu ou recopié (`.env.local` jamais lu, mots de passe tirés et non affichés), migration visant une base réelle (adresse du conteneur seule).
- Aucune table, aucune route, aucune dépendance nouvelle.

## Critères d'acceptation

- [x] Hors CI, `npm run test:e2e` crée le conteneur, le prépare, lance la suite et le supprime ; aucun conteneur étiqueté ne reste après une exécution réussie, échouée ou interrompue.
- [x] En CI, aucune commande `docker` ; le workflow est inchangé.
- [x] `E2E_BASE=dev` lance la suite sur `dev` sans Docker.
- [x] Docker arrêté : le message de la section 2, code 1.
- [x] `.e2e-journaux/` contient la sortie des deux serveurs de la dernière exécution.
- [x] La dette « `email.compte` partagée sur `dev` » est retirée de `PLAN.md`.
- [x] `npm run verifier` vert deux fois de suite, puis `npm run test:integration` sur `dev`.

## Tests à écrire

`e2e/base-jetable.spec.ts`, sans serveur ni Docker : `docker`, les processus et l'attente de la base sont remplacés par des faux.

1. **Port sur 127.0.0.1 seulement** : un seul `--publish`, `127.0.0.1::5432` ; `docker port` répondant `0.0.0.0:…`, `[::]:…`, `localhost:…`, deux lignes ou rien : refus, conteneur supprimé, Playwright jamais lancé.
2. **Conteneur supprimé même en cas d'échec** : Playwright en échec, préparation en échec, migrations en échec, base jamais prête, signal pendant Playwright, succès ; à chaque fois `rm -f -v <nom>` est la dernière commande `docker`, une fois. Après un signal, Playwright est arrêté et le code vaut 130.
3. **Refus d'un hôte distant** : adresse de base vers un hôte distant, `localhost` ou `0.0.0.0` refusée ; les adresses transmises visent `127.0.0.1` ; `DATABASE_URL_MIGRATION` n'est transmise qu'à la préparation et aux migrations, jamais à Playwright.
4. **Refus si `VERCEL_ENV`** : `production`, `preview`, `development` et la chaîne vide, dans les trois modes : code 1, aucune commande.
5. **Aucune lecture de `.env.local`** : le source du script ne cite ni `.env.local`, ni `dotenv`, ni `node:fs`.
6. Compléments : Docker arrêté (message, aucun `run`) ; `E2E_BASE` inconnue refusée ; modes CI et secours sans `docker`, arguments transmis ; restes étiquetés supprimés avant le `run`.
7. **Verrou de l'adresse de migration** : variable absente (supprimée, vide, `undefined`, illisible) ; hôte ou port différent (Neon, `localhost`, `0.0.0.0`, `[::1]`, port 5432, port absent, `127.0.0.1.exemple.com`). Chaque fois : code 1, seule la préparation lancée, conteneur supprimé, mot de passe non affiché. L'évolution fautive est simulée par un point d'essai (`outils.envMigrations`, identité par défaut).

`e2e/journaux.spec.ts` : deux chemins neufs par exécution dans le dossier, dix exécutions gardées au plus.

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `scripts/e2e-base-jetable.mjs` | Nouveau |
| `package.json` | `test:e2e` passe par le script |
| `playwright.config.ts`, `e2e/journaux.ts`, `e2e/lancer-serveur.mjs` | Sortie des deux serveurs dans `.e2e-journaux/` |
| `e2e/base-jetable.spec.ts`, `e2e/journaux.spec.ts` | Nouveaux tests |
| `.gitignore` | `/.e2e-journaux/` |
| `docs/CONFIGURATION.md`, `docs/PLAN.md`, `CLAUDE.md` | Prérequis Docker, dette retirée, commande décrite |

## Notes de réalisation (2026-10-14)

**Phase rouge** (commit `test:`) : code 1, les deux fichiers refusés au chargement (`scripts/e2e-base-jetable.mjs` et `e2e/journaux.ts` absents), aucun des 15 tests exécuté.

**Test modifié pendant l'implémentation, sans changer ce qu'il prouve** : restes étiquetés, identifiants factices `aaa111` remplacés par des identifiants de 12 caractères hexadécimaux ; le script ne garde que les identifiants de 12 à 64 caractères hexadécimaux, pour qu'aucune sortie inattendue de `docker ps` ne devienne un argument. Un identifiant non hexadécimal est ajouté au cas, et ignoré.

**Vérifié en réel, en plus des tests** :

- port publié : `127.0.0.1:<port>` seul (`docker port`), `PortBindings` sur `127.0.0.1`, aucun volume (`Mounts` vide) ;
- Docker injoignable (`DOCKER_HOST=tcp://127.0.0.1:1`) : message de la section 2, code 1 ; `E2E_BASE=prod` et `VERCEL_ENV=preview` refusés ;
- exécution tuée par `taskkill /T /F` après la préparation : conteneur resté (9 migrations, 11 tables, marque `environnement:test`, donc les migrations visaient bien le conteneur), puis supprimé par l'exécution suivante (« Suppression de 1 conteneur(s) ») ;
- « Comptes de bout en bout supprimés : 8 » en fin de suite : le nettoyage, qui lit la même `DATABASE_URL` que le serveur, a trouvé les comptes dans le conteneur.

**Non vérifié en réel** : un vrai Ctrl+C. Sous Windows, un signal envoyé par un autre processus termine le processus sans passer par son gestionnaire ; le chemin est couvert par le test 2 (signal émis pendant Playwright), et le reste d'une interruption non gérée l'est par la suppression des restes étiquetés.

**Durée ajoutée par exécution** : préparation 7,9 à 8,8 s (conteneur, rôle, migrations), suppression 0,7 à 0,8 s, soit environ 9 à 10 s ; plus le tirage unique de l'image (162 Mo) à la première exécution.

**Vérifications** : `npm run verifier` vert deux fois de suite (217 s puis 195 s : format, lint, typecheck, 57 fichiers et 1 841 tests unitaires, construction, 303 tests de bout en bout, ports libres), aucun conteneur restant ; `npm run test:integration` sur `dev` : 21 fichiers, 185 réussis et 1 échec attendu (déjà présent).
