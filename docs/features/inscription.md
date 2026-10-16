# Fonctionnalité : inscription et vérification de l'email

Statut : validée ; PR 1 et tâche quotidienne fusionnées ; PR 2 implémentée le 2026-10-13, preuve sur la prévisualisation faite et conforme le 2026-10-14 (section 7). Fiche rédigée le 2026-10-13 ; les trois vrais choix tranchés par le développeur le même jour (section « Décisions »), les autres points selon la recommandation de l'assistant (section « Décisions par défaut »). Ordre retenu : PR 1 de cette fiche, puis fiche et PR de la tâche quotidienne (8.3 avancée), puis PR 2.

Jalon 1, fonctionnalité 1.1 de `docs/PLAN.md`. Taille M. Cas d'utilisation : UC-01. Exigences : F-001, S-10, S-11, S-15, S-54, S-55, S-81, S-82, S-85. Menaces : T-07, T-39, T-40, T-41, T-55 ; T-01 et T-43 préparées (limites de Better Auth, connexion en 1.2).

## Contexte

Un visiteur doit pouvoir créer un compte et prouver qu'il possède son adresse avant tout accès (F-001, UC-01). C'est la première fonctionnalité qui expose la route de Better Auth (`/api/auth`), donc la première surface anonyme qui écrit en base et envoie des emails (frontière F1 de `THREATS.md`).

Aujourd'hui :

- `src/server/auth/config.ts` configure Better Auth 1.7.7 (`emailAndPassword: { enabled: true }`, `twoFactor()`, `organization()`, `nextCookies()`), sans route : `src/app/api/` n'existe pas. `src/server/actions/inventaire.test.ts` admet déjà `api/auth/[...all]` « après fermeture de `/organization/*` ».
- La porte d'envoi (`envoyerEmail`, 0.7) ne connaît qu'un modèle, `essai.verification_envoi`. La règle T réserve `envoyerEmail` à `src/server/actions/action.ts` ; la 0.7 a prévu que la 1.1 l'ouvre aux rappels de Better Auth.
- Le compteur de débit (0.5) ne sert qu'à la chaîne (`membre.action`) et aux emails des actions. Better Auth garde sa limitation en mémoire, inefficace sur Vercel (`limitation-debit.md`, section 8).

Points reportés à la 1.1 par les fiches précédentes, tous traités ici :

| Point | Origine | Section |
|---|---|---|
| T-39 : journal de Better Auth coupé ou filtré, aucun jeton dans les journaux, base en panne comprise, avec un test | `THREATS.md` 5.4 et 10.4 ; `PLAN.md` 1.1 | 1 |
| T-55 : points d'entrée natifs fermés avant toute exposition ; lesquels restent ouverts et pourquoi | `chaine-controles.md` décision 15 ; `PLAN.md` 1.1 | 2 |
| Origine acceptée sur `preview` (adresse de branche) et réglage équivalent de Better Auth | `chaine-controles.md` décision 4 | 2.4 |
| Débit de Better Auth sur notre compteur (`customStorage`), activé explicitement ; adresse IP selon la règle de `limitation-debit.md` section 9, vérifiée sur `preview` avec un en-tête forgé ; écart avec `DESIGN.md` 3.1 ; réponse 429 | `limitation-debit.md` sections 8 et 9, décision 7 | 3 |
| Premier vrai email, par `envoyerEmail` seulement ; règle T ; forme des liens (question 8 de la 0.7) ; rappels appelés dans une transaction ? (règle 15) ; T-07 | `envoi-emails.md` sections 1.2 et 11, « Reporté » | 4 |
| Essai réel depuis le poste (`npm run essai:email`), puis preuve Vercel → Gmail sur la prévisualisation de la 1.1, avant fusion | `envoi-emails.md` section 9, étapes 4 et 8 | 7 |
| `Referrer-Policy: same-origin` laisse passer `Origin` sur la première requête exposée ; `@axe-core/playwright` à revoir | `socle-interface.md` « Reporté » | 5.3, décision par défaut 14 |
| Contrôle après déploiement : `/api/auth/organization/*` répond comme une adresse inexistante | `controle-deploiement.md` « Reporté » | 2.3 |

**Prérequis non rempli.** `PLAN.md` (jalon 1) avance la tâche quotidienne (8.3) avant la 1.1 : sa route et `purgerCompteurs` doivent être en service avant la première limite par adresse IP ou par email. Elle n'existe pas (`src/app/api/` absent). Elle a sa propre fiche (`docs/features/tache-quotidienne.md`, à écrire) et doit être fusionnée **avant la PR 2** de cette fiche (section « Découpage en PR »). La 1.1 y ajoute la purge des comptes non vérifiés (section 4.6).

## Problème

- Un visiteur ne peut pas créer de compte.
- Exposer `/api/auth` tel que Better Auth le fournit ouvrirait d'un coup tous les points d'entrée du noyau et des extensions, dont ceux de `/organization/*` (36 déclarés par le module, `chaine-controles.md` section 1.1), qui changent rôles et membres sans la chaîne de contrôles (T-55).
- En cas de panne de la base, Better Auth écrit dans le journal du serveur la requête et ses paramètres, dont la valeur du jeton de session (T-39, constaté le 2026-10-12). Il y écrit aussi, au niveau `info`, l'adresse d'une inscription en double (`api/routes/sign-up.mjs` ligne 194).
- Sa limitation de débit est en mémoire, perdue d'une instance Vercel à l'autre.
- Sans précaution, l'inscription dit si une adresse a un compte : message d'erreur, forme de la réponse, ou durée (envoi d'un email seulement pour un compte neuf) (T-07).

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Journal de Better Auth | `src/server/auth/config.ts`, `src/server/auth/journal.ts` | Une ligne fixe par évènement, sans message ni argument (T-39) |
| Liste fermée des points d'entrée | `src/server/auth/points-entree.ts`, `src/app/api/auth/[...all]/route.ts` | Trois points d'entrée ouverts ; tout le reste répond comme une adresse inexistante (T-55) ; origine, taille, schéma Zod, réponses normalisées |
| Débit de Better Auth | `src/server/debit/better-auth.ts`, `src/server/debit/limites.ts` | `customStorage` sur `compteur_debit`, limites par adresse IP dans `limites.ts` |
| Emails de compte | `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | Rappels de Better Auth → limites → `envoyerEmail`, après la réponse |
| Pages | `src/app/(public)/inscription/`, `src/app/lien/verification/` | Formulaire, « vérifiez votre boîte », confirmation, résultat |
| Purge | `src/server/db/comptes.ts` | Comptes non vérifiés de plus de 7 jours (`THREATS.md` 7.2), appelée par la tâche quotidienne |

### 1. Le journal de Better Auth (T-39, S-54, S-85)

#### 1.1 Ce que fait Better Auth 1.7.7

Lu dans `node_modules/@better-auth/core/dist/env/logger.mjs` : le journal est créé par `createLogger(options.logger)`. Niveau par défaut `warn`. Chaque appel `logger.<niveau>(message, ...args)` écrit le message formaté **et les arguments** sur `console.error` ou `console.warn`, ou les passe à `options.logger.log(niveau, message, ...args)` si cette fonction est fournie. `options.logger.disabled: true` coupe tout.

Ce qui y passe, entre autres : l'erreur de base complète, dont la requête SQL et ses paramètres (T-39) ; `Failed to create user` avec l'erreur (`sign-up.mjs` lignes 230 et 231) ; l'adresse d'une inscription en double (`info`, ligne 194) ; une adresse de rappel refusée (`origin-check.mjs` lignes 57, 79, 115). Les messages ne sont pas tous fixes : certains interpolent une adresse email ou une URL.

#### 1.2 Retenu : `log` qui ne lit ni le message ni les arguments

```ts
// src/server/auth/config.ts
logger: { level: "warn", log: consignerAuth },

// src/server/auth/journal.ts
export function consignerAuth(niveau: "info" | "warn" | "error" | "debug"): void
```

`consignerAuth` écrit une seule ligne au journal technique, par `src/server/erreurs/consigner.ts` : `[auth] <niveau> incident=<identifiant>`. Sa signature n'a qu'un paramètre : le message et les arguments ne sont **jamais lus**, donc jamais transmis. Rien n'est écrit pour `info` et `debug`.

- **Pourquoi pas `disabled: true`** : une panne de la base deviendrait invisible dans le journal du serveur pour les points d'entrée de Better Auth. La ligne fixe garde le signal (« une erreur de Better Auth, à telle heure ») sans aucun contenu.
- **Pourquoi pas un filtre** (retirer les jetons d'un message) : il faudrait reconnaître toutes les formes de secret et de donnée personnelle, aujourd'hui et après chaque mise à jour. Une liste de ce qu'on garde (le niveau) ne peut pas fuir ce qu'elle ignore.
- **L'erreur elle-même.** Une erreur de base levée pendant `auth.api.getSession` remonte à notre code (`lireSession`, puis `etablirContexte` ou la chaîne), qui la consigne déjà sans message (`consigner.ts`, 0.6). Pour la route, le gestionnaire attrape toute exception de `auth.handler` et répond 500, corps fixe, identifiant d'incident (section 2.2) : aucune exception ne remonte à Next.js, qui l'écrirait avec son message.
- **Le routeur `better-call` écrit lui-même l'erreur** (constaté à la mise à jour de la fiche, `node_modules/better-call/dist/router.mjs` ligne 93, version 1.4.0) : quand le gestionnaire d'erreur de Better Auth (`api/index.mjs` lignes 195 à 214) ne renvoie pas de réponse, ce qui est le cas pour toute erreur qui n'est pas une `APIError` (panne de base comprise), le routeur appelle `console.error("# SERVER_ERROR: ", error)` avec l'erreur complète, sans passer par le journal de Better Auth. Retenu : `onAPIError: { throw: true }`. Better Auth relance alors l'erreur ; le routeur rend une `APIError` en réponse et relance toute autre erreur hors d'`auth.handler`, où notre gestionnaire l'attrape (section 2.2, étape 5). Le test 1 passe par `auth.handler` pour couvrir ce chemin.

#### 1.3 La preuve

Deux tests, écrits en premier (« Tests à écrire ») :

1. **Sans base réelle, sous Vitest** (`src/server/auth/journal.attaque.test.ts`). Une instance de Better Auth construite avec `optionsAuth` (même journal) et un adaptateur sur une base injoignable (`127.0.0.1:1`, outil `basePanne()` de `src/server/db/outils-test/`). Cookie de session au jeton aléatoire, signé avec le secret de test (même méthode qu'`e2e/serveur-panne.ts`). Espions sur `console.*`, `process.stdout.write` et `process.stderr.write`. Appels : `getSession`, puis une inscription par `auth.handler`. Attendu : la lecture échoue ; aucune sortie ne contient le jeton, sa signature, l'adresse saisie, `Failed query`, `select`, ni `params`. Témoin : le même scénario avec le journal par défaut de Better Auth fait apparaître le jeton (sinon le test ne prouverait rien).
2. **Sur le site construit** (`e2e/erreurs.attaque.spec.ts`, serveur en panne du port 3101). Le serveur en panne écrit sa sortie dans un fichier temporaire (lanceur `e2e/lancer-serveur-panne.mjs`, devenu `e2e/lancer-serveur.mjs` et `.e2e-journaux/` le 2026-10-14, `e2e-base-jetable.md`, à la place de la commande directe de `playwright.config.ts`). Le test pose le cookie signé, ouvre `/tableau-de-bord` et appelle `POST /api/auth/sign-up/email`, puis lit le fichier : ni le jeton, ni l'adresse, ni `Failed query`. C'est la reproduction exacte du constat du 2026-10-12.

### 2. Les points d'entrée exposés (T-55, S-81, S-84)

#### 2.1 Ce que fait Better Auth 1.7.7

- `disabledPaths` (`api/index.mjs` ligne 166) compare le chemin **exactement** : `/organization/*` n'est pas un motif. Fermer le module demanderait d'énumérer ses 36 chemins, et d'en ajouter à chaque mise à jour.
- Le routeur accepte tout chemin déclaré par le noyau et par chaque extension (`twoFactor`, `organization`, `haveIBeenPwned` n'en ajoute pas).
- Les appels serveur `auth.api.*` ne passent pas par le routeur : `lireSession` et les outils de test ne sont pas concernés par la liste.

#### 2.2 Retenu : une liste fermée de points d'entrée ouverts, dans notre gestionnaire

```ts
// src/app/api/auth/[...all]/route.ts — forme exacte, vérifiée par le test d'inventaire
import { traiterRequeteAuth } from "@/server/auth/points-entree";
export const GET = traiterRequeteAuth;
export const POST = traiterRequeteAuth;
```

`traiterRequeteAuth(requete)`, dans l'ordre :

1. **Point d'entrée.** Méthode et chemin (relatif à `/api/auth`, sans barre finale) cherchés dans `POINTS_ENTREE_OUVERTS`. Absent : réponse **inexistante**, construite par une seule fonction, `reponseInexistante()` (statut 404, corps vide, aucun en-tête propre). Un chemin fermé, une méthode non admise sur un chemin ouvert et un chemin qui n'existe pas reçoivent donc la même réponse, octet pour octet. `auth.handler` n'est pas appelé.
2. **Origine** (`POST` seulement). `verifierOrigine` de la chaîne (`src/server/actions/origine.ts`) : `Origin` obligatoire, égale à l'origine de `BETTER_AUTH_URL` ; `Sec-Fetch-Site`, s'il est présent, vaut `same-origin`. Refus : 403, corps fixe. Le contrôle de Better Auth (`originCheckMiddleware`) reste actif derrière.
3. **Taille et type** (`POST`). `Content-Type: application/json` ; corps de 4 Kio au plus, lu une fois. Sinon 400, corps fixe.
4. **Validation.** Schéma Zod strict du point d'entrée (`src/schemas/compte.ts`). Tout champ non prévu est refusé : `image`, `callbackURL`, `rememberMe` et les champs supplémentaires ne parviennent jamais à Better Auth. Pour `POST /verify-email`, le corps `{ jeton }` : format JWT (trois segments `base64url`, 1 024 caractères au plus). Refus : 400, corps fixe.
5. **Better Auth.** Une requête neuve est construite avec le corps validé et passée à `auth.handler`. Pour `POST /verify-email`, cette requête interne est un `GET /api/auth/verify-email?token=<jeton>` sans `callbackURL`, construite en mémoire seulement : elle ne traverse aucun réseau et n'apparaît dans aucun journal de requêtes (section 4.3). Elle reprend l'en-tête de l'adresse IP de la requête reçue, pour que la limite `auth.verification` s'applique. Toute exception est attrapée : 500, corps fixe, identifiant d'incident, ligne au journal technique sans message (section 1.2).
6. **Réponse normalisée.** Pour `POST`, le corps de Better Auth n'est **jamais** renvoyé tel quel : il est traduit en une réponse de la liste fermée `{ ok: true }` ou `{ ok: false, raison }`, raisons `mot_de_passe_trop_court`, `mot_de_passe_compromis`, `invalide`, `trop_de_requetes`, `erreur`. Seuls les en-têtes `Set-Cookie` de `/verify-email` sont gardés ; une vérification refusée par Better Auth (jeton expiré, altéré, utilisateur inconnu) devient `{ ok: false, raison: "lien_invalide" }`. Le 429 de Better Auth devient `trop_de_requetes`, **sans** `X-Retry-After` (décision 2 de la 0.5 : ni délai, ni compte).
7. **Durée plancher** (`POST /sign-up/email` et `POST /send-verification-email`). La réponse ne part pas avant 800 ms après la réception, quel que soit le chemin suivi (section 4.4, T-07).

#### 2.3 Lesquels restent ouverts, et pourquoi

| Méthode et chemin | Pourquoi ouvert en 1.1 | Protections propres |
|---|---|---|
| `POST /sign-up/email` | UC-01, étapes 1 à 3 : créer le compte, non vérifié | Origine, schéma strict, limite par adresse IP, mots de passe compromis, durée plancher, réponse uniforme |
| `POST /verify-email` | UC-01, étapes 4 et 5 : marquer l'adresse vérifiée et ouvrir la session. Better Auth n'accepte que `GET`, jeton dans l'adresse : notre gestionnaire reçoit le jeton dans le corps et appelle Better Auth en mémoire (section 2.2, étape 5). `GET /verify-email` reste fermé | Origine, schéma strict, jeton signé expiré en 1 heure, limite par adresse IP |
| `POST /send-verification-email` | UC-01, erreur 4a : renvoyer un lien expiré | Origine, schéma strict, limite par adresse IP et par destinataire, durée plancher, réponse uniforme |

Tout le reste répond comme une adresse inexistante, et en particulier :

| Points d'entrée fermés | Jusqu'à |
|---|---|
| `/organization/*` (tous) | **Toujours.** Toute opération sur l'organisation et ses membres passe par la chaîne (T-55, décision 15 de la 0.4) |
| `/sign-in/*`, `/sign-out`, `/get-session` | 1.2. La session se lit côté serveur (`lireSession`), jamais par le navigateur |
| `/request-password-reset`, `/reset-password/*` | 1.3 |
| `/two-factor/*` | 1.4 |
| `/list-sessions`, `/revoke-session*` | 1.5 |
| `/update-user`, `/change-email`, `/change-password`, `/delete-user`, `/ok`, `/error`, `/callback/*`, tout autre | Une fiche qui en a besoin |

**En production, les trois sont fermés jusqu'à la 1.3** (décision 1) : la constante `INSCRIPTION_OUVERTE_EN_PRODUCTION`, à `false` dans `points-entree.ts`, retirée par la PR de la 1.3. Quand `VERCEL_ENV` vaut `production`, chacun reçoit `reponseInexistante()`, la même réponse qu'un chemin fermé, octet pour octet (test dédié). Ouverts en local, en test et en prévisualisation. Aucune variable d'environnement ne change ce choix.

Ouvrir un point d'entrée, c'est ajouter une ligne à `POINTS_ENTREE_OUVERTS` avec sa fiche, son schéma et ses tests, dans la PR de la fonctionnalité.

**Test d'inventaire des points d'entrée.** Un test énumère, à l'exécution, tous les points d'entrée déclarés par l'instance (`auth.api`, chemin et méthode de chaque point) et appelle `traiterRequeteAuth` pour chacun : seuls ceux de la liste ne reçoivent pas `reponseInexistante()`. Une mise à jour de Better Auth qui ajoute un point d'entrée ne l'ouvre donc pas. Il vérifie aussi que chaque entrée de la liste existe bien dans `auth.api` (une faute de frappe n'ouvre rien, mais doit se voir).

**Contrôle après déploiement.** `scripts/controle-deploiement.mjs` gagne un contrôle, `GET` seulement : `/api/auth/organization/list` et `/api/auth/organization/get-full-organization` reçoivent la même réponse que `/api/auth/n-existe-pas` (statut et corps).

#### 2.4 L'origine sur `preview` (décision 4 de la 0.4)

Retenu : **une seule origine, toujours** : celle de `BETTER_AUTH_URL`, déduite de `VERCEL_URL` sur `preview` (adresse propre au déploiement). L'adresse de branche de Vercel n'est acceptée ni par `verifierOrigine`, ni par Better Auth (`trustedOrigins` laissé à sa valeur par défaut, l'origine de `baseURL`).

- Le lien de vérification est construit depuis `BETTER_AUTH_URL` : il mène à l'adresse propre au déploiement, la même que celle des requêtes. L'essai de la section 7 s'y fait de bout en bout.
- Accepter l'adresse de branche demanderait de lire une seconde variable (`VERCEL_BRANCH_URL`) et d'élargir `trustedOrigins` sur `preview` seulement : un réglage par environnement de plus, pour un confort d'essai.
- Conséquence : ouverte par l'adresse de branche, la prévisualisation affiche les pages, mais l'inscription répond 403. Noté dans `docs/CONFIGURATION.md`.

### 3. Le débit de Better Auth sur notre compteur (S-11, T-41, T-01)

#### 3.1 Configuration

```ts
rateLimit: {
  enabled: true,                 // explicite : ne dépend plus de NODE_ENV
  window: LIMITES["auth.defaut"].fenetreSecondes,
  max: LIMITES["auth.defaut"].maximum,
  customRules: reglesBetterAuth(),   // depuis LIMITES, section 3.2
  customStorage: stockageBetterAuth, // src/server/debit/better-auth.ts
},
advanced: {
  ipAddress: { ipAddressHeaders: ["x-forwarded-for"] }, // confirmé par l'essai sur preview (3.4)
  database: { generateId: "uuid" },
},
```

Le stockage `"memory"` (option B1 de la 0.5) et `"database"` (B2) restent écartés ; B3 est mise en œuvre.

#### 3.2 Les limites, dans `limites.ts` (règle 15)

`Limite.par` gagne la valeur `"adresse_ip"`. Les règles par chemin de Better Auth sont **construites depuis `LIMITES`** par `reglesBetterAuth()` : aucune valeur n'est écrite dans `config.ts`.

| Nom | Maximum | Fenêtre | Chemin | But |
|---|---|---|---|---|
| `auth.inscription` | 5 | 1 h | `/sign-up/email` | Comptes en masse (abus de UC-01, T-41) |
| `auth.renvoi_verification` | 3 | 1 h | `/send-verification-email` | Boîte inondée, épuisement des envois |
| `auth.verification` | 10 | 10 min | `/verify-email` (appel interne, section 2.2) | Essais de jetons |
| `auth.defaut` | 30 | 1 min | Tout autre chemin ouvert plus tard | Valeur sûre pour une ouverture future |

S'y ajoute, pour les emails de compte (section 4.2) :

| Nom | Maximum | Fenêtre | Clé | But |
|---|---|---|---|---|
| `email.compte` | 100 | 24 h | Valeur fixe | Les emails sans organisation (vérification, « compte existant », puis réinitialisation en 1.3) ne prennent jamais plus de la moitié d'`email.application` (200) : une vague d'inscriptions ne bloque pas les emails des organisations |

Toutes les fenêtres restent sous 24 heures : `fenetreMaxSecondes` et la purge ne changent pas.

#### 3.3 Le stockage

`stockageBetterAuth.consume(cle, { window, max })` :

- **Règle connue seulement.** `(window, max)` doit être exactement celle d'une limite `auth.*` de `LIMITES` ; sinon `allowed: false`. Une règle introduite par une mise à jour de Better Auth (ses règles spéciales par défaut, `rate-limiter/index.mjs` lignes 305 à 318) est donc refusée plutôt que comptée sur une fenêtre inconnue. Les règles spéciales par défaut sont toutes remplacées par `customRules` pour les chemins ouverts ; le test d'inventaire (section 2.3) le vérifie.
- **Clé.** La clé de Better Auth (`<adresse IP>|<chemin>`, en clair) passe par `cleCompteur` (0.5) sous le nom de la limite : seule l'empreinte HMAC est stockée. L'adresse IP n'est jamais écrite en base ni au journal.
- **Compte.** `compteur.consommer` (incrément atomique, fenêtre fixe ancrée sur la première tentative) ; `allowed` vaut `compte <= max`.
- **`retryAfter: null`** toujours : Better Auth retombe sur la fenêtre de la règle, et notre gestionnaire retire de toute façon `X-Retry-After` (section 2.2, étape 6).
- **Base en panne.** `consume` lève ; Better Auth répond 500 ; le gestionnaire le traduit en `erreur`. Fermé par défaut, comme la 0.5 (section 6).
- `consume` n'est jamais appelé pendant une transaction : Better Auth l'appelle au début de la requête, avant le point d'entrée (règle 15).

#### 3.4 L'adresse IP (décision 7 de la 0.5)

Better Auth applique lui-même la règle de `limitation-debit.md` section 9 (lu dans `@better-auth/core/dist/utils/ip.mjs`, lignes 175 à 193) : un seul en-tête, fixé par la configuration ; une liste de plusieurs valeurs est refusée ; une valeur qui n'est pas une adresse IPv4 ou IPv6 valide est refusée ; l'adresse est normalisée (IPv6 réduite à son sous-réseau). Adresse refusée ou absente : en production, compteur partagé `no-trusted-ip` par chemin, donc plus strict ; jamais « pas de limite ». Notre propre fonction de lecture n'est pas écrite en 1.1 (aucun usage hors de Better Auth) : elle viendra avec S-22 au jalon 4, sur le même en-tête.

Un test unitaire fige ce comportement sur la version installée (liste refusée, valeur invalide refusée, IPv6 normalisée) : une mise à jour qui le change fait échouer la suite.

**Essai sur `preview`, par le développeur** (jamais par l'assistant), avant la fusion de la PR 2 : six requêtes `POST /api/auth/sign-up/email` vers l'adresse du déploiement, avec `Origin` égale à cette adresse et le corps `{"nom":"Essai","email":"essai-limite@exemple.invalid","motDePasse":"password1234"}`, chacune avec un `X-Forwarded-For` forgé différent (`203.0.113.1` à `203.0.113.6`, plage de documentation). Corrigé à la PR 2 : un corps vide est refusé par notre gestionnaire (`invalide`) avant Better Auth, donc avant le compteur, et ne prouverait rien. Le mot de passe `password1234`, connu de Have I Been Pwned, fait refuser l'inscription après le compteur (`mot_de_passe_compromis`) : aucun compte, aucun email. Le même essai, service simulé, tourne en local (`e2e/auth.attaque.spec.ts`, T-41).

- Si la sixième reçoit `trop_de_requetes` (statut 429), ou une requête plus tôt (les inscriptions de la preuve comptent dans la même fenêtre d'une heure, section 7, point 4) : Vercel remplace l'en-tête par l'adresse réelle. `x-forwarded-for` est confirmé.
- Si les six reçoivent `mot_de_passe_compromis` : l'en-tête forgé est cru. On remplace par `x-real-ip`, on refait l'essai ; si les deux échouent, la PR 2 n'est pas fusionnée.

Le résultat est noté dans « Notes de l'implémentation ». En local, l'en-tête est falsifiable et accepté (aucun vrai utilisateur) : les tests de bout en bout s'en servent pour ne pas épuiser une même limite (section « Tests à écrire »).

#### 3.5 Écart avec `DESIGN.md` section 3.1

`DESIGN.md` n'incrémente le compteur de connexion qu'en cas d'échec ; Better Auth compte **toutes** les requêtes. Retenu : toutes les requêtes, plus simple et plus strict. Un utilisateur légitime n'atteint pas 5 inscriptions par heure. `DESIGN.md` section 3.1 est corrigée dans la PR 2 ; la 1.2 fixe la limite de connexion sur la même base.

### 4. Les emails de compte

#### 4.1 Les rappels de Better Auth

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,   // réponse générique pour une adresse déjà prise
  minPasswordLength: 12,            // S-10
  maxPasswordLength: 128,
  onExistingUserSignUp: planifierEmailCompteExistant,   // UC-01, 3a
},
emailVerification: {
  sendOnSignUp: true,
  autoSignInAfterVerification: true, // UC-01, étape 5
  expiresIn: 3600,                   // 1 heure
  sendVerificationEmail: planifierEmailVerification,
},
```

Les deux rappels vivent dans `src/server/auth/emails.ts`. Chacun :

1. **Ne fait que planifier** l'envoi par `after()` de Next.js 16 (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` : utilisable dans un gestionnaire de route ; sur Vercel, `waitUntil` garde la fonction en vie jusqu'à la fin) et rend la main aussitôt. Better Auth n'attend donc jamais l'échange avec Gmail.
2. **Ne lève jamais.** Toute erreur est attrapée et consignée sans adresse. C'est indispensable : sur `/send-verification-email`, Better Auth relance l'erreur du rappel (`email-verification.mjs`, `if (error) throw error`), ce qui distinguerait un compte non vérifié d'une adresse inconnue (T-07).
3. Dans la tâche planifiée, après la réponse : `verifierDebit` de `email.destinataire`, `email.destinataire_jour`, `email.compte`, `email.application`, dans cet ordre, puis `envoyerEmail`. Une limite atteinte arrête l'envoi, sans rien dire au visiteur.
4. **Ignore `url`** fournie par Better Auth (qui contient le jeton dans l'adresse, et la `callbackURL` reçue de la requête) : le lien est construit par la porte, depuis `token` seulement (section 4.3).

`envoyerEmail` et `verifierDebit` sont donc appelés hors de toute transaction : la règle 15 est respectée. Vérifié dans `node_modules` : l'inscription passe par `runWithTransaction` (`sign-up.mjs` ligne 144), mais l'adaptateur Drizzle n'ouvre de transaction que si `transaction: true` (`@better-auth/drizzle-adapter/dist/index.mjs` ligne 559, défaut `false`). Un test de `config.test.ts` fige `transaction` à `false` ; même s'il changeait, l'envoi planifié par `after()` part après la réponse, donc après toute transaction.

#### 4.2 Règle T et `STRUCTURE.md`

- `envoyerEmail` s'importe dans `src/server/actions/action.ts`, **`src/server/auth/emails.ts`** et les tests. Modification de la règle T dans `eslint.config.mjs`, par la méthode de `CLAUDE.md` (script Python, `chr(92)`, comptage des barres inverses, puis `regles-import.test.ts`).
- `STRUCTURE.md`, section 7 : `server/auth/` peut importer `server/email/envoi.ts` et `server/debit/` (`emails.ts` seulement), `server/erreurs/` (`journal.ts`).

#### 4.3 Les liens : jeton dans le fragment (question 8 de la 0.7, décision 3)

Le jeton de vérification de Better Auth 1.7.7 est un JWT signé (`createEmailVerificationToken`, `email-verification.mjs` ligne 14), d'environ 250 caractères, sans état en base. Sa charge utile contient l'adresse email, encodée et non chiffrée. Better Auth le met dans l'adresse (`/verify-email?token=...`) : il apparaîtrait dans les journaux de requêtes de Vercel et dans tout journal qui note une adresse (S-54).

Retenu : **le jeton ne figure jamais dans une adresse reçue par le serveur.**

- **Lien de l'email** : `<origine de BETTER_AUTH_URL>/lien/verification#<jeton>`. Le fragment (après `#`) n'est jamais envoyé au serveur par un navigateur, ni dans la requête, ni dans `Referer`. La porte le construit : nouvelle fonction `lienFragment(origine, type, jeton)` à côté de `lienPublic`, type `verification`, jeton validé par la nouvelle brique `jetonVerification()` (trois segments `base64url` séparés par des points, 1 024 caractères au plus). Un appelant ne fournit que le jeton : ni l'origine, ni le chemin (T-65, règle 17).
- **Page `/lien/verification`** (zone par lien : ne lit jamais la session ; PR 2). Composant client : il lit `location.hash`, l'efface aussitôt de la barre d'adresse et de l'historique (`history.replaceState`), vérifie sa forme, et affiche un bouton « Confirmer mon adresse ». Le bouton envoie `POST /api/auth/verify-email` avec `{ jeton }` dans le corps (JSON, `Origin` de la page). Réponse `{ ok: true }` (cookie de session posé) : passage à `/inscription/verifiee`. `lien_invalide` : « Ce lien n'est plus valable », avec le formulaire de renvoi (UC-01, 4a). Sans JavaScript : message fixe (`<noscript>`), rien n'est envoyé. Le serveur rend le même document pour tout fragment, puisqu'il ne le voit pas.
- **Pourquoi un bouton** : les filtres de messagerie ouvrent les liens d'un email. Une confirmation automatique ferait consommer la vérification, et ouvrir la session, par le robot du filtre. Un robot ne clique pas un bouton qui envoie un `POST`.
- **Côté serveur** : section 2.2, étape 5. `GET /verify-email` reste fermé : un jeton placé dans une adresse reçoit la réponse inexistante, sans appel à Better Auth (test dédié).

#### 4.4 Uniformité des réponses (T-07, S-11)

| Situation | Réponse au visiteur | Email envoyé |
|---|---|---|
| Adresse nouvelle | `{ ok: true }` après 800 ms au moins | `compte.verification` |
| Adresse d'un compte vérifié ou non | `{ ok: true }` après 800 ms au moins | `compte.existant` |
| Mot de passe trop court | `mot_de_passe_trop_court` (vérifié avant la recherche du compte) | Aucun |
| Mot de passe compromis | `mot_de_passe_compromis` (vérifié dans les deux chemins, par le hachage) | Aucun |
| Limite par adresse IP atteinte | `trop_de_requetes` | Aucun |
| Renvoi, quelle que soit l'adresse | `{ ok: true }` après 800 ms au moins | `compte.verification` si un compte non vérifié existe, sinon rien |

- `requireEmailVerification: true` fait répondre Better Auth par un utilisateur synthétique pour une adresse prise (`sign-up.mjs` lignes 155 à 205) ; notre gestionnaire ne renvoie de toute façon que `{ ok: true }` (section 2.2, étape 6).
- **Durée.** Les deux chemins diffèrent encore de deux écritures en base (création de l'utilisateur et du compte). La durée plancher de 800 ms, mesurée par le gestionnaire, couvre cet écart et le hachage ; l'envoi, planifié par `after()`, n'entre plus dans la durée. Une durée au-delà de 800 ms (base lente) reste observable : « Limites connues ».

#### 4.5 Les modèles

Ajoutés à `MODELES_EMAIL`, textes dans `src/textes/emails.ts`, texte brut, phrase fixe « ne pas répondre » :

| Modèle | Paramètres | Contenu |
|---|---|---|
| `compte.verification` | `jeton: jetonVerification()` | Confirmer l'adresse, lien valable 1 heure, ignorer si vous n'êtes pas à l'origine de la demande |
| `compte.existant` | aucun | Une inscription a été tentée avec cette adresse, qui a déjà un compte ; si c'est vous, utilisez la connexion ou la réinitialisation (sans lien en 1.1) ; sinon, ignorez |

`essai.verification_envoi` reste, pour `npm run essai:email`.

#### 4.6 Comptes non vérifiés

- `lireSession` (`src/server/auth/session.ts`) renvoie `null` pour un utilisateur dont `emailVerified` est faux. Aujourd'hui une telle session ne peut pas exister (pas de connexion automatique à l'inscription) ; la règle protège contre un changement de configuration. Conséquence sur l'outillage : `creerMembre` (`outils-test/membres.ts`) crée désormais un utilisateur à l'adresse vérifiée, comme tout vrai membre ; sans cela, toutes les sessions de test seraient lues comme absentes.
- `purgerComptesNonVerifies()` (`src/server/db/comptes.ts`) supprime les utilisateurs non vérifiés créés il y a plus de 7 jours (`THREATS.md` 7.2), leurs comptes et sessions suivant par `ON DELETE CASCADE`. Appelée par la tâche quotidienne. Elle touche une table de Better Auth sans `organisation_id` : requête par `db`, dans `src/server/db/`, sans organisation active, comme `db/debit.ts`.

### 5. Les pages et la validation

#### 5.1 Pages

| Adresse | Zone | Contenu |
|---|---|---|
| `/inscription` | `(public)` | Nom, email, mot de passe ; règles affichées (12 caractères au moins) ; envoi par `fetch` en JSON vers `/api/auth/sign-up/email` (Better Auth n'accepte que `application/json`) ; succès : `/inscription/envoyee` |
| `/inscription/envoyee` | `(public)` | « Si l'adresse est valable, un email vient de partir », formulaire de renvoi |
| `/lien/verification` | `lien` | Section 4.3 |
| `/inscription/verifiee` | `(public)` | « Adresse vérifiée » |

Interface selon `docs/DESIGN-SYSTEM.md` (compétence `interface`), textes dans `src/textes/`, vérifiée à 390 et 1280 px. Le formulaire d'inscription demande JavaScript ; sans lui, il affiche un message fixe (`<noscript>`), aucun envoi.

#### 5.2 Validation (règle 7)

`src/schemas/compte.ts`, partagé par le formulaire et le gestionnaire :

- `nom` : `texteAffichable(100)` (sans caractère de contrôle), non vide après retrait des espaces ;
- `email` : la règle d'adresse de la porte (`src/server/email/adresse.ts`, 0.7), plus étroite que `z.email()` ; un email que la porte refuserait est refusé à l'inscription, avant toute écriture ;
- `motDePasse` : 12 à 128 caractères ;
- objets stricts : tout autre champ refusé.

S-10, mots de passe compromis : extension `haveIBeenPwned()` de Better Auth (`better-auth/plugins`, **aucune dépendance nouvelle**), sur `/sign-up/email` (puis `/reset-password` en 1.3, `/change-password` plus tard). Seuls les 5 premiers caractères hexadécimaux de l'empreinte SHA-1 partent vers `api.pwnedpasswords.com`, avec remplissage (`Add-Padding`). Service injoignable ou réponse en erreur : l'inscription est refusée (`erreur`), fermé par défaut (décision 2). Destinataire extérieur inscrit dans `THREATS.md` 7.5 et `STACK.md`.

**Aucun test n'appelle le vrai service, et aucun interrupteur ne désactive l'extension.** Lu dans `node_modules` : l'extension appelle `betterFetch` (`@better-fetch/fetch`), qui prend `globalThis.fetch` **à chaque appel** (`getFetch`, `dist/index.js` ligne 236). D'où :

- **Vitest** : la garde réseau (`tests/garde-reseau.ts`) remplace `globalThis.fetch` par une version qui lève pour l'hôte `api.pwnedpasswords.com` : un test qui oublie de simuler le service voit l'inscription refusée, jamais un appel réel. Les tests qui en ont besoin simulent la réponse par `vi.stubGlobal("fetch", ...)`, pour cet hôte seulement.
- **Bout en bout** (PR 2) : `playwright.config.ts` lance chaque serveur avec `NODE_OPTIONS=--import ./e2e/simuler-hibp.mjs`, module de préchargement hors de `src/` qui remplace `globalThis.fetch` pour cet hôte seulement (empreinte d'un mot de passe compromis connu du test : réponse « compromis » ; sinon réponse vide). Rien dans `src/` ne sait qu'il est simulé.

#### 5.3 `Referrer-Policy` et `Origin` (report de la 0.6)

Un test de bout en bout sur le site construit soumet le formulaire et vérifie que la requête vers `/api/auth/sign-up/email` porte `Origin` égal à l'origine du site et reçoit `{ ok: true }`. Il confirme que `Referrer-Policy: same-origin` n'efface pas `Origin`.

### 6. Les cookies (S-82)

Réglages par défaut de Better Auth gardés : `HttpOnly`, `SameSite=Lax`, `Secure` dès que `baseURL` est en `https` (production et prévisualisation). Un test unitaire lit les attributs calculés pour une `baseURL` en `https` ; un test de bout en bout lit le `Set-Cookie` réel après la vérification (`http` local : `HttpOnly` et `SameSite=Lax`).

### 7. Le premier vrai email et la preuve Vercel → Gmail

Par le développeur, jamais par l'assistant (`envoi-emails.md`, section 9). L'assistant ne lance aucune commande contre `preview` ni `production`.

1. **Essai depuis le poste** (étape 4 de la 0.7), au début de la PR 2 : `npm run essai:email` avec le second compte, mot de passe saisi sans écho. Vérifier la réception, `From`, un seul destinataire, `SPF` et `DKIM` en `pass`, la copie dans « Messages envoyés », et toute alerte de Google. **Échec : on s'arrête là.** **Non fait pour cette PR, par décision du développeur du 2026-10-14** : remplacé par la preuve Vercel → Gmail du point 3, plus complète (même compte, vrai chemin, code réel, `SPF`, `DKIM` et `DMARC`, journaux du déploiement) et sans saisie du mot de passe d'application sur le poste.
2. **Variables de prévisualisation**, limitées à la branche `feat/1.1-inscription-pr2` (champ « Preview Branch » de Vercel ; la branche de la PR 2 porte ce nom), posées seulement quand elle porte la PR 2 : `GMAIL_UTILISATEUR` et `GMAIL_MOT_DE_PASSE_APPLICATION` (second compte, Sensitive), `EMAIL_TRANSPORT=smtp`, `EMAIL_DESTINATAIRES_AUTORISES` (adresse personnelle du développeur).
3. **Preuve** (étape 8 de la 0.7) : sur la prévisualisation, ouverte par l'adresse du déploiement (section 2.4), s'inscrire avec l'adresse autorisée ; recevoir `compte.verification` ; ouvrir le lien, confirmer ; arriver sur « Adresse vérifiée » avec un cookie de session. Dans les journaux du déploiement, aucune requête ne porte le jeton. Mêmes vérifications qu'au point 1, et surtout les alertes de Google (connexion depuis Francfort, RR-10). Puis une seconde inscription avec la même adresse : `compte.existant` reçu, réponse identique à l'écran.
4. **Essai de l'adresse IP** (section 3.4) sur le même déploiement, **après la preuve du point 3** (décision du développeur, PR 2). La limite `auth.inscription` admet 5 inscriptions par adresse IP sur une **fenêtre fixe d'une heure** (3 600 s), ouverte par la première tentative de cette adresse (section 3.3) ; les deux inscriptions de la preuve y comptent déjà si Vercel remplace l'en-tête par l'adresse réelle. Une réponse `trop_de_requetes` (429) avant la sixième requête est donc tout aussi concluante : l'en-tête forgé n'est pas cru. Six réponses `mot_de_passe_compromis` : il est cru. Pour repartir d'un compteur vide, attendre une heure après la première inscription de la preuve.
5. **Journal** : dans les journaux du déploiement (Vercel, « Logs »), aucune adresse email, aucun jeton, aucune ligne `[Better Auth]` ; seulement les lignes `[auth]` et `[email]` fixes.
6. **Échec du point 3** : la 1.1 n'est pas fusionnée ; on passe à l'API web de Gmail en HTTPS (`envoi-emails.md`, section 8), par une fiche.
7. Après la preuve : retirer les quatre variables de prévisualisation de la branche, ou les laisser jusqu'à la suppression de la branche (elles ne s'appliquent qu'à elle). Recommandé : les retirer après la fusion.

Résultats notés dans « Notes de l'implémentation ».

#### Résultats de la preuve sur la prévisualisation, le 2026-10-14

Par le développeur, sur la prévisualisation de la branche `feat/1.1-inscription-pr2`, ouverte par l'adresse propre du déploiement. Tout est conforme. L'essai depuis le poste (`npm run essai:email`, point 1) n'est pas fait : cette preuve le remplace, par décision du développeur (point 1).

- **Have I Been Pwned réel** : un mot de passe compromis est refusé, avec le message « Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre. »
- **Email de vérification** (point 3), envoyé par `mataderleii@gmail.com` à l'adresse autorisée : `SPF` PASS, `DKIM` PASS (`gmail.com`), `DMARC` PASS. Lien sur l'adresse propre du déploiement, jeton dans le fragment (`/lien/verification#<jeton>`) ; bouton « Confirmer mon adresse » ; page « Adresse vérifiée ».
- **Cookie de session** : `__Secure-better-auth.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax` (S-82). Le second cookie visible, `_vercel_jwt`, est celui de la protection des prévisualisations de Vercel, absent en production.
- **Réinscription avec la même adresse** : écran identique, email « Tentative d'inscription avec votre adresse » reçu (UC-01, 3a ; T-07).
- **Compte d'envoi et journaux** : « Messages envoyés » conforme, aucune alerte de Google ; journaux du déploiement sans adresse email, sans jeton, sans ligne `[Better Auth]` (point 5).
- **Essai de l'adresse IP** (section 3.4, point 4), après la preuve : six requêtes, chacune avec un `X-Forwarded-For` forgé différent ; réponses 400, 400, puis 429 dès la troisième. Le compteur ne tient pas compte de l'en-tête forgé : Vercel le remplace par l'adresse réelle, et les inscriptions de la preuve comptaient déjà dans la fenêtre d'une heure. **`x-forwarded-for` est confirmé** ; le repli `x-real-ip` n'est pas nécessaire. Une requête refusée sur l'origine (adresse `-git-`) ne compte pas dans la limite : elle est refusée avant Better Auth, donc avant le compteur.

Notes :

- **Adresse `-git-` d'une prévisualisation** : l'inscription y répond « Cette action n'est pas disponible. » (origine refusée, voulu, section 2.4). Toujours tester sur l'adresse propre du déploiement.
- **L'email « Tentative d'inscription » invite à se connecter**, alors que la page de connexion n'arrive qu'en 1.2. Acceptable tant que l'inscription reste fermée en production (jusqu'à la 1.3, décision 1) ; texte et liens du modèle `compte.existant` à revoir en 1.2.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| `toNextJsHandler(auth)` tel quel | Expose tous les points d'entrée, renvoie les corps et messages de Better Auth (T-07, T-55) |
| `disabledPaths` seul | Correspondance exacte : 36 chemins à énumérer pour `/organization/*`, plus ceux de chaque extension et de chaque mise à jour. Liste d'interdits au lieu d'une liste d'autorisés |
| Inscription par une action serveur appelant `auth.api.signUpEmail`, sans route | La chaîne n'a pas de variante sans session ; la limitation de Better Auth ne s'applique pas aux appels serveur ; la vérification par lien demande de toute façon une route qui pose le cookie. À reconsidérer si une variante « publique » de la chaîne naît |
| `logger.disabled: true` | Panne de Better Auth invisible au journal du serveur (section 1.2) |
| Filtre des messages du journal | Une liste d'interdits : fuit toute forme non prévue (section 1.2) |
| Jeton dans le chemin (`/lien/verification/<jeton>`) ou dans la requête | L'adresse email encodée et un jeton valable 1 heure dans les journaux de requêtes (décision 3) |
| Table de jetons opaques | Une table, une migration et une purge pour ce que le fragment obtient sans rien stocker (décision 3) |
| Confirmation automatique à l'ouverture de la page | Les robots des messageries consomment la vérification (section 4.3) |
| Lien `/api/auth/verify-email?...` dans l'email (option b de la 0.7) | Jeton dans l'adresse ; `callbackURL` dans l'email ; aucune protection contre les robots |
| Interrupteur de l'extension Have I Been Pwned pour les tests | Un réglage qui désactive S-10 ; l'interception de `globalThis.fetch` suffit (section 5.2) |
| Envoi attendu dans le rappel | La durée de réponse dirait si l'adresse a un compte ; une erreur d'envoi remonterait (T-07) |
| Adresse de branche acceptée sur `preview` | Une variable et un réglage de plus, pour un confort d'essai (section 2.4) |
| Liste locale de mots de passe compromis | Fichier lourd dans le dépôt, couverture bien moindre (décision 2) |

## Règles de sécurité et permissions

- **S-10** : 12 caractères au moins, 128 au plus, mots de passe compromis refusés (section 5.2).
- **S-11** : limites par adresse IP sur les trois points d'entrée, par destinataire et globale sur les emails ; réponses et durées uniformes (sections 3 et 4.4).
- **S-15** : le jeton de vérification est signé, expire en 1 heure, et ne sert qu'une fois en pratique (une adresse déjà vérifiée ne rouvre pas de session). Il n'est pas stocké : rien à hacher. S-15 vise les jetons d'invitation et de réinitialisation (2.3, 1.3).
- **S-54, S-85** : journal de Better Auth réduit à une ligne fixe, erreurs relancées hors de `better-call` (section 1) ; aucune réponse ne contient de message de Better Auth ; aucune adresse dans le journal des emails ; le jeton de vérification, qui contient l'adresse, n'est jamais dans une adresse reçue (section 4.3).
- **S-55** : `email.compte` et les limites de la 0.7.
- **S-81** : `verifierOrigine` sur chaque `POST` de `/api/auth`, en plus du contrôle de Better Auth.
- **S-82** : section 6.
- **T-07, T-39, T-40, T-41, T-55** : sections 4.4, 1, 3 et 4, 3, 2.
- **Matrice des droits** : aucune ligne. L'inscription n'appartient à aucune organisation ; `THREATS.md` section 6 : « chaque utilisateur gère son propre compte ». Aucune action déclarée par `declarerAction`, aucune entrée au registre.
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3) : « sans session » est sans objet pour une route anonyme, remplacé par « origine absente ou étrangère » ; « autre organisation » et « rôle insuffisant » sont sans objet (aucune organisation, aucun rôle), remplacés par « point d'entrée fermé » (T-55) ; « entrée falsifiée » s'applique tel quel.
- **Tables** : aucune créée ni modifiée. `user`, `account`, `session` et `verification` sont des tables de Better Auth, sans `organisation_id`, dans `TABLES_SANS_ORGANISATION` (RR-8).
- **Journal d'audit** : rien. Un évènement de compte n'a pas d'organisation ; le lieu de ces évènements est tranché en 1.2 (`journal-audit.md`, « Reporté »).

## Dépendances nouvelles

Aucune. `haveIBeenPwned` et `after` sont fournis par `better-auth` 1.7.7 et `next` 16.4.0, déjà installés. `@axe-core/playwright` n'est pas ajouté (décision par défaut 14).

## Migration

Aucune. Les tables de Better Auth existent ; `compteur_debit` reçoit de nouvelles clés, sans changement de forme. Le dossier `drizzle/` n'est pas touché.

## Découpage en PR

1. **PR 1, sans exposition.** Journal (section 1) et ses tests ; débit de Better Auth (section 3) ; emails de compte, modèles, règle T (section 4) ; `lireSession` ; purge des comptes non vérifiés ; `points-entree.ts` et ses tests unitaires, **sans** `route.ts`. Après la fusion, rien de nouveau n'est joignable en production.
2. **PR 2, exposition.** `src/app/api/auth/[...all]/route.ts`, pages, tests de bout en bout, contrôle après déploiement, documents (`DESIGN.md` 3.1, `STRUCTURE.md`, `CONFIGURATION.md`). Préalables : tâche quotidienne fusionnée (« Contexte ») ; essai depuis le poste réussi (section 7, point 1). Fusion seulement après la preuve depuis la prévisualisation et l'essai de l'adresse IP (section 7, points 3 et 4).

## Critères d'acceptation

- [ ] Base injoignable : aucun jeton, aucune adresse, aucune requête SQL dans le journal du serveur, sous Vitest et sur le site construit (T-39).
- [ ] Les seuls points d'entrée de `/api/auth` qui ne répondent pas comme une adresse inexistante sont les trois de la section 2.3, vérifié pour chaque point d'entrée déclaré par l'instance (T-55).
- [ ] `/api/auth/organization/*` répond exactement comme `/api/auth/n-existe-pas`, en local et par le contrôle après déploiement.
- [ ] Un `POST` sans `Origin`, avec une autre origine ou `Origin: null` est refusé (S-81).
- [ ] Un champ non prévu (`image`, `callbackURL`, `rememberMe`), un corps de plus de 4 Kio ou un autre type que JSON est refusé, sans appel à Better Auth.
- [ ] Inscription avec une adresse nouvelle et avec une adresse prise : même statut, même corps ; durée de 800 ms au moins dans les deux cas ; email `compte.verification` ou `compte.existant` selon le cas (T-07, UC-01 3a).
- [ ] Mot de passe de 11 caractères, ou compromis : refusé avec la raison (UC-01 2a).
- [ ] La sixième inscription en une heure depuis une même adresse IP reçoit `trop_de_requetes`, sans `X-Retry-After` ; aucune adresse IP en clair dans `compteur_debit`.
- [ ] Le lien de vérification a la forme `<origine>/lien/verification#<jeton>` ; `GET /api/auth/verify-email?token=...` répond comme un chemin fermé ; la page confirme par un bouton qui envoie le jeton dans le corps ; la vérification ouvre une session dont le cookie est `HttpOnly` et `SameSite=Lax`.
- [ ] En production (`VERCEL_ENV=production`), les trois points d'entrée répondent comme un chemin fermé, octet pour octet (décision 1).
- [ ] Have I Been Pwned injoignable ou en erreur : inscription refusée ; aucun test n'appelle le vrai service (décision 2).
- [ ] Un lien expiré ou altéré mène à « Ce lien n'est plus valable » et au renvoi (UC-01 4a) ; un lien déjà utilisé n'ouvre pas de nouvelle session.
- [ ] Une session d'utilisateur non vérifié est lue comme absente.
- [ ] `envoyerEmail` n'est importable que par `action.ts`, `auth/emails.ts` et les tests (règle T) ; aucune limite n'est écrite hors de `limites.ts`.
- [x] Essai depuis le poste, preuve depuis la prévisualisation et essai de l'adresse IP réussis et notés (section 7). L'essai depuis le poste est remplacé par la preuve depuis la prévisualisation (décision du 2026-10-14, section 7, point 1).
- [ ] `npm run verifier` et `npm run test:integration` verts, sorties montrées.

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code. Les numéros 1 à 11 relèvent de la PR 1, 12 à 16 de la PR 2.

### Tests d'attaque, puis unitaires (PR 1)

1. [ ] **T-39, journal** — `src/server/auth/journal.attaque.test.ts` (sans base, base injoignable) : section 1.3, test 1, avec son témoin.
2. [ ] **T-55, liste fermée** — `src/server/auth/points-entree.attaque.test.ts` : pour chaque point d'entrée de `auth.api`, méthode et chemin, `traiterRequeteAuth` renvoie `reponseInexistante()` sauf les trois ouverts ; chaque point d'entrée `/organization/*` déclaré par l'instance est nommé dans le rapport d'échec ; méthode non admise sur un chemin ouvert, chemin avec barre finale, encodé (`%2F`), en majuscules, avec `..` : même réponse, octet pour octet, que `/api/auth/n-existe-pas` ; `auth.handler` n'est jamais appelé (espion).
3. [ ] **Origine et entrée falsifiée** — même fichier : `Origin` absente, étrangère, `null`, `Sec-Fetch-Site: cross-site` ; `Content-Type` autre ; corps de 4 Kio + 1 ; JSON invalide ; champs `image`, `callbackURL`, `rememberMe`, champ inconnu ; jeton de `verify-email` hors format ou dans la requête plutôt que le corps. Refus, `auth.handler` jamais appelé.
4. [ ] **Configuration** — `src/server/auth/config.test.ts`, ajouts : `logger.log` est `consignerAuth` ; `rateLimit.enabled` vaut `true`, `customStorage` est `stockageBetterAuth`, règles construites depuis `LIMITES` ; `ipAddressHeaders` vaut `["x-forwarded-for"]` ; `requireEmailVerification`, `sendOnSignUp`, `autoSignInAfterVerification` vrais, `expiresIn` 3600 ; `minPasswordLength` 12 ; extension `have-i-been-pwned` présente ; `trustedOrigins` absent ; adaptateur sans transaction ; attributs des cookies pour une `baseURL` en `https`.
5. [ ] **Stockage du débit** — `src/server/debit/better-auth.test.ts` (compteur factice) : clé HMAC, adresse absente de la clé ; règle inconnue refusée ; `allowed` à la limite et au-delà ; `retryAfter` nul ; erreur du compteur propagée. `limites.test.ts` : chaque limite `auth.*` sous 24 h, `par: "adresse_ip"` ; `reglesBetterAuth()` couvre exactement les chemins ouverts.
6. [ ] **Adresse IP** — `src/server/debit/adresse-ip-better-auth.test.ts` : comportement de `getIP` de la version installée (valeur unique, liste refusée, valeur invalide refusée, IPv6 normalisée, absente en production).
7. [ ] **Rappels d'email** — `src/server/auth/emails.test.ts` (transport `memoire`, planificateur injecté à la place d'`after`) : le rappel rend la main sans envoyer ; lien construit depuis `token`, `url` ignorée même si elle vise un autre site ; ordre des quatre limites ; limite atteinte ou transport en panne : aucune exception, ligne de journal sans adresse ; `compte.existant` pour une adresse prise.
8. [ ] **Modèles** — `modeles.test.ts` : `compte.verification` et `compte.existant`, brique `jetonVerification` (format, longueur, caractères de contrôle refusés), textes tirés de `src/textes/emails.ts`, phrase de fin ; le test des briques admises par `z.toJSONSchema` inclut la nouvelle.
9. [ ] **Règle T** — `regles-import.test.ts` : `envoyerEmail` importable dans `auth/emails.ts`, refusé ailleurs dans `auth/` et dans `app/`.
10. [ ] **Session non vérifiée** — `session.test.ts` : `emailVerified` faux, `lireSession` renvoie `null`.
11. [ ] **Durée plancher** — `points-entree.test.ts`, horloge simulée : réponse rapide retenue jusqu'à 800 ms ; réponse lente non retardée davantage.
11a. [ ] **Inscription fermée en production** — `points-entree.attaque.test.ts` : avec `estProduction` vrai, les trois `POST` reçoivent exactement `reponseInexistante()` (statut, en-têtes, corps), comme `/api/auth/n-existe-pas` ; `auth.handler` jamais appelé ; témoin : `estProduction` faux, ils sont ouverts.
11b. [ ] **Jeton jamais dans l'adresse reçue** — `points-entree.attaque.test.ts` et `modeles.test.ts` : le lien construit par la porte n'a pas le jeton avant `#` ; `GET /verify-email?token=<jeton valide>` reçoit `reponseInexistante()` sans appel à Better Auth ; `POST /verify-email` avec le jeton dans le corps est transmis.
11c. [ ] **Have I Been Pwned indisponible** — `src/server/auth/mots-de-passe.attaque.test.ts` (instance sur base injoignable, transport `memoire`) : `fetch` simulé qui lève, puis qui répond 503 : inscription refusée, raison `erreur` ; la garde réseau refuse un appel non simulé vers `api.pwnedpasswords.com`.

### Tests d'intégration, avec base (PR 1)

- [ ] `src/server/debit/better-auth.integration.test.ts` : six `consume` pour une même clé et la règle `auth.inscription` : le sixième refusé ; ligne de `compteur_debit` sans l'adresse en clair ; nettoyage des clés.
- [ ] `src/server/db/comptes.integration.test.ts` : `purgerComptesNonVerifies` supprime un non vérifié de 8 jours, garde un non vérifié de 6 jours et un vérifié de 8 jours ; sessions et comptes suivent.
- [ ] `src/server/auth/inscription.integration.test.ts` (par `traiterRequeteAuth`, transport `memoire`, planificateur synchrone, recherche de mots de passe compromis simulée) : adresse nouvelle puis prise, réponses identiques, bon modèle chacun ; vérification par `POST /verify-email` avec le jeton reçu : `emailVerified` vrai, `Set-Cookie` présent ; second usage : aucune nouvelle session ; jeton expiré : `lien_invalide`. Nettoyage par `nettoyerMembres` (utilisateurs `test-<uuid>@exemple.test`).

### Tests de bout en bout (PR 2)

12. [x] **Parcours UC-01** — `e2e/inscription.spec.ts` (ordinateur-1280 et mobile-390) : formulaire, `/inscription/envoyee`, lecture de l'email dans le dossier du transport `fichier`, ouverture du lien, fragment effacé de la barre d'adresse, bouton, « Adresse vérifiée », aucune requête du navigateur ne porte le jeton dans son adresse, cookie `HttpOnly` et `SameSite=Lax` ; la requête porte `Origin` (section 5.3). Chaque test pose un `X-Forwarded-For` propre (en local, accepté), pour ne pas épuiser `auth.inscription`. Adresses `e2e-<uuid>@exemple.invalid`, supprimées en fin de suite.
13. [x] **T-07 en bout en bout** — même fichier : adresse prise et adresse nouvelle, même écran, même corps de réponse.
14. [x] **T-55 sur le site construit** — `e2e/auth.attaque.spec.ts` : `GET` et `POST` sur des chemins fermés, dont `/organization/update-member-role`, `/sign-in/email`, `/get-session` : réponse identique à `/api/auth/n-existe-pas`.
15. [x] **T-39 sur le site construit** — `e2e/erreurs.attaque.spec.ts` : section 1.3, test 2.
16. [x] **Contrôle après déploiement** — `e2e/controle-deploiement.spec.ts` (serveur factice, comme les contrôles existants) : le nouveau contrôle échoue si `/api/auth/organization/list` diffère de `/api/auth/n-existe-pas`, passe sinon ; page `inscription` : échoue si l'un des trois `POST` de l'inscription répond autrement qu'un chemin inexistant (décision 1).

### Vérifications manuelles (PR 2, développeur)

- [x] Essai depuis le poste, preuve depuis la prévisualisation, essai de l'adresse IP, journaux du déploiement (section 7). Essai depuis le poste remplacé par la preuve depuis la prévisualisation (décision du 2026-10-14).

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `src/server/auth/config.ts` | Journal, débit, emails, mot de passe, `haveIBeenPwned` |
| `src/server/auth/journal.ts` | Nouveau : `consignerAuth` |
| `src/server/auth/emails.ts` | Nouveau : rappels, limites, `after`, `envoyerEmail` |
| `src/server/auth/points-entree.ts` | Nouveau : liste fermée, origine, validation, normalisation, durée plancher |
| `src/server/auth/gestionnaire.ts` | Nouveau (PR 2) : `traiterRequeteAuth`, lié à `auth.handler`, importé par `route.ts` |
| `src/server/auth/session.ts` | Session d'utilisateur non vérifié refusée |
| `src/server/debit/limites.ts` | `adresse_ip`, quatre limites `auth.*`, `email.compte` |
| `src/server/debit/better-auth.ts` | Nouveau : `stockageBetterAuth`, `reglesBetterAuth` |
| `src/server/email/modeles.ts`, `src/textes/emails.ts` | Deux modèles, brique `jetonVerification`, type de lien `verification` |
| `src/server/db/comptes.ts` | Nouveau : `purgerComptesNonVerifies` |
| `src/server/db/outils-test/panne.ts`, `src/server/db/outils-test/inscription.ts` | Nouveaux : base injoignable ; banc d'inscription sur la vraie base |
| `src/schemas/compte.ts` | Nouveau : schémas des trois points d'entrée et du formulaire |
| `src/app/api/auth/[...all]/route.ts` | Nouveau (PR 2) |
| `src/app/(public)/inscription/**`, `src/app/lien/verification/page.tsx` | Nouveaux (PR 2) |
| `tests/garde-reseau.ts` | Refus de `api.pwnedpasswords.com` sous Vitest |
| `e2e/simuler-hibp.mjs` | Nouveau (PR 2) : interception de Have I Been Pwned pour les serveurs de bout en bout |
| `src/server/db/outils-test/membres.ts` | `creerMembre` crée un utilisateur à l'adresse vérifiée (section 4.6) |
| `src/textes/compte.ts` | Nouveau : textes des pages |
| `eslint.config.mjs` | Règle T |
| `src/server/actions/inventaire.test.ts` | Forme exacte de `route.ts` |
| `playwright.config.ts`, `e2e/lancer-serveur-panne.mjs` (devenu `e2e/lancer-serveur.mjs`), `e2e/*.spec.ts` | Sortie du serveur en panne dans un fichier ; nouveaux tests |
| `scripts/controle-deploiement.mjs` | Contrôle T-55 |
| `docs/THREATS.md` 7.5, `docs/STACK.md` | Have I Been Pwned, destinataire extérieur (PR 1, décision 2) |
| `docs/DESIGN.md` 3.1, `docs/STRUCTURE.md` 2, 3 et 7, `docs/CONFIGURATION.md`, `docs/THREATS.md` 10.4 | Mises à jour (PR 2) |

## Reporté

- **1.2** (traité par `docs/features/connexion.md` ; `/get-session` reste fermé, la constante `INSCRIPTION_OUVERTE_EN_PRODUCTION` devient `COMPTES_OUVERTS_EN_PRODUCTION`, le texte de `compte.existant` est revu, l'identifiant d'incident est ajouté) : connexion, déconnexion, `/get-session` si le navigateur en a besoin ; limite de connexion par adresse IP et par email (`DESIGN.md` 3.1, corrigée ici) ; lieu des évènements de compte (création, vérification) ; renvoi automatique de la vérification à la connexion d'un compte non vérifié (`sendOnSignIn`).
- **1.3** : réinitialisation ; `haveIBeenPwned` sur `/reset-password` ; une réinitialisation sur un compte non vérifié le marque vérifié et ferme toutes ses sessions (pré-appropriation d'adresse, « Limites connues ») ; liens du modèle `compte.existant` vers la connexion et la réinitialisation.
- **Jalon 4 (S-22)** : notre propre lecture de l'adresse IP, sur l'en-tête confirmé ici.
- **8.1** : signalement des lignes `[auth] error` au service de suivi.

## Limites connues

- **Pré-appropriation d'une adresse.** Quelqu'un peut créer un compte non vérifié avec l'adresse d'un autre. Le vrai titulaire reçoit `compte.existant` à sa propre inscription, et ne peut rien faire avant la 1.3 (réinitialisation) ou la purge à 7 jours. Le compte usurpé ne donne aucun accès : il n'est jamais vérifié sans la boîte de la victime.
- **Jeton dans le fragment.** Il reste lisible dans l'email lui-même, dans « Messages envoyés » du compte d'envoi (RR-9), et par un script de la page `/lien/verification` (aucun script tiers, politique de sécurité du contenu stricte). La page l'efface de l'historique dès sa lecture.
- **Page de vérification sans JavaScript** : impossible de confirmer ; message fixe.
- **Durée au-delà du plancher.** Une base lente, ou un hachage plus long que 800 ms, rend de nouveau l'écart observable (T-07). Accepté : bruit du réseau, et limite de 5 essais par heure et par adresse IP.
- **Copie dans « Messages envoyés ».** Chaque lien de vérification y reste (RR-9) : quiconque lit cette boîte dans l'heure peut vérifier un compte et ouvrir sa session. Purge manuelle mensuelle ; liens d'une heure.
- **Recherche de mots de passe compromis.** Dépend d'un service tiers ; injoignable, l'inscription est refusée (décision 2).
- **Plusieurs adresses IP.** La limite par adresse IP ne freine pas un attaquant qui en a beaucoup ; `email.compte` (100 par 24 h) borne alors les emails, au prix de bloquer les inscriptions de tous jusqu'à la fin de la fenêtre.
- **Adresse de branche** : l'inscription y est refusée (section 2.4).

## Décisions

Prises par le développeur le 2026-10-13, sur les trois vrais choix de la fiche.

1. **Inscription fermée en production jusqu'à la 1.3**, par une constante du code (`INSCRIPTION_OUVERTE_EN_PRODUCTION`), jamais une variable d'environnement. Ouverte en prévisualisation et en local. Fermée : la même réponse qu'un chemin fermé, octet pour octet, prouvée par un test (section 2.3).
2. **Have I Been Pwned** : oui, extension intégrée, refus si le service ne répond pas. Aucun test n'appelle le vrai service ; interception de `globalThis.fetch` sous Vitest et en bout en bout ; aucun interrupteur de désactivation (section 5.2). Destinataire inscrit dans `THREATS.md` 7.5 et `STACK.md`.
3. **Jeton dans le fragment** : `/lien/verification#<jeton>` ; le serveur ne le voit jamais dans une adresse ; la page le lit et l'envoie dans le corps du `POST` du bouton de confirmation. Pas d'exception de sécurité, pas de table (section 4.3). Vérifié avant de l'écrire : aucune règle écrite ne l'interdit. La règle 17 et T-65 exigent un lien construit par la porte depuis un jeton, sur l'origine de l'application et sous `/lien/` : c'est le cas.

Ordre retenu : PR 1 maintenant, puis fiche et PR de la tâche quotidienne (8.3 avancée), puis PR 2.

## Décisions par défaut

Appliquées par l'assistant le 2026-10-13, selon sa recommandation, sauf avis contraire du relecteur.

1. **Journal de Better Auth** : `log` à un seul paramètre (le niveau), ligne fixe `[auth]` ; ni `disabled`, ni filtre (section 1.2).
2. **Points d'entrée** : liste fermée de trois, dans notre gestionnaire ; aucun `disabledPaths` (section 2).
3. **Corps de Better Auth** jamais renvoyé ; réponses de la liste fermée ; `X-Retry-After` retiré (section 2.2).
4. **Origine sur `preview`** : une seule, `BETTER_AUTH_URL` ; adresse de branche refusée (section 2.4).
5. **`customStorage`** sur `compteur_debit`, règles construites depuis `LIMITES`, règle inconnue refusée (section 3).
6. **Limites** : `auth.inscription` 5 par heure, `auth.renvoi_verification` 3 par heure, `auth.verification` 10 par 10 minutes, `auth.defaut` 30 par minute, par adresse IP ; `email.compte` 100 par 24 h (section 3.2).
7. **En-tête de l'adresse IP** : `x-forwarded-for`, valeur unique, à confirmer sur `preview` ; repli `x-real-ip` (section 3.4).
8. **Toutes les tentatives comptent** ; `DESIGN.md` 3.1 corrigée (section 3.5).
9. **Envoi après la réponse** par `after()`, rappels qui ne lèvent jamais (section 4.1).
10. **Liens** : remplacée par la décision 3.
11. **Durée plancher** : 800 ms sur les deux `POST` (section 4.4).
12. **Connexion automatique après vérification** : oui, comme UC-01 étape 5 ; jeton d'une heure.
13. **Purge des comptes non vérifiés** à 7 jours, par la tâche quotidienne (section 4.6).
14. **`@axe-core/playwright`** : toujours pas (aucune dépendance nouvelle) ; la règle Q et la vérification à 390 et 1280 px restent.
15. **Découpage** : deux PR, la première sans exposition (« Découpage en PR »).
16. **Évènements de compte** : rien au journal d'audit, rien de plus au journal technique que les lignes fixes ; lieu tranché en 1.2.
17. **`onAPIError: { throw: true }`** : aucune erreur écrite par `better-call` (section 1.2).

## Notes de l'implémentation

### PR 1, le 2026-10-13

**Phase rouge** (commit `test(1.1)`). Tests unitaires : 11 fichiers en échec ; 35 tests en échec par assertion (limites absentes, modèles et briques absents, `lireSession` qui accepte une adresse non vérifiée, règle T qui refuse `auth/emails.ts`), et 7 fichiers non chargés faute des modules à écrire (`points-entree.ts`, `emails.ts`, `journal.ts`, `debit/better-auth.ts`). Tests d'intégration : les 3 nouveaux fichiers non chargés, même raison. Passaient avant le code, et pourquoi : `adresse-ip-better-auth.test.ts` (il fige le comportement de la version installée de Better Auth, pas le nôtre ; la configuration de l'en-tête est vérifiée par `config.test.ts`, qui échouait) ; les cas « refusé » ajoutés à la règle T (`session.ts`, `points-entree.ts`, page) et les témoins de `session.test.ts` (garde-fous : l'exception ouverte pour `auth/emails.ts` ne doit pas s'étendre) ; l'invariant « deux limites `auth.*` n'ont pas la même règle », vide avant le code.

**Tests corrigés pendant l'implémentation, sans changer ce qu'ils prouvent** :

- `emails.test.ts` : la valeur comptée pour `Awa.Kone+essai@Exemple.invalid` est `awa.kone@exemple.invalid` (points gardés hors Gmail, décision 10 de la 0.7), et non `awakone@...` : erreur de l'attente.
- `debit/better-auth.test.ts` : le cas « règle d'une limite qui n'est pas `auth.*` » prenait `email.destinataire` (1 h, 3), qui a la même règle que `auth.renvoi_verification` ; il prend `email.application` (24 h, 200), qu'aucune limite `auth.*` n'a.
- `points-entree.attaque.test.ts` : espion typé par `vi.fn<...>()` au lieu d'un paramètre inutilisé (avertissement d'ESLint).

**Outillage modifié** : `creerMembre` crée des utilisateurs à l'adresse vérifiée (section 4.6) ; `LIMITES_TEST` (`outils-test/email.ts`) déclare les nouvelles limites, que son type exige ; nouveaux `outils-test/panne.ts` (base injoignable, cookie signé) et `outils-test/inscription.ts` (banc d'inscription sur la vraie base). `VALEUR_APPLICATION` passe de `actions/action.ts` à `debit/limites.ts`, partagée avec `auth/emails.ts`.

**Constat** : `better-call` écrit l'erreur complète par `console.error("# SERVER_ERROR: ", ...)` hors du journal de Better Auth (section 1.2) : `onAPIError: { throw: true }`. Avec le journal par défaut, le test 1 montre le jeton (lecture de session) et l'adresse saisie (inscription) dans la sortie ; avec la configuration de l'application, ni l'un ni l'autre. Dans `npm run verifier`, le serveur en panne du port 3101 n'écrit plus que des lignes `[auth] {"niveau":"error","incident":...}` (28 lignes) ; aucune occurrence de `Failed query`, `params:`, `SERVER_ERROR`, `[Better Auth]`, `session_token` ni `base_injoignable` dans tout le journal.

**Écart avec la fiche** : la liaison du gestionnaire à l'instance réelle (`traiterRequeteAuth`, avec `auth.handler`, `BETTER_AUTH_URL` et `estProduction`) vient avec `route.ts`, en PR 2 ; la PR 1 livre la fabrique `creerTraitementAuth`. Raisons refusées : `refuse` (403, origine) s'ajoute à la liste de la section 2.2.

**Vérifications** : `npm run verifier` vert (lint, typecheck, 51 fichiers et 1 706 tests unitaires, construction, 140 tests de bout en bout, ports 3000 et 3101 libres) ; `npm run test:integration` : 21 fichiers, 182 réussis et 1 échec attendu (déjà présent avant cette PR).

### PR 2, le 2026-10-13

**Numérotation.** La demande de la PR 2 citait « les tests 13 à 17 » ; la fiche numérote 12 à 16 ceux de la PR 2. Tous sont écrits, plus le contrôle « inscription fermée en production » et les tests de l'interface.

**Phase rouge** (commit `test(1.1)`). Sur le site construit avant le code : 126 tests de bout en bout en échec, chacun pour l'absence de la route ou des pages (page « introuvable » au lieu du titre attendu ; HTML de Next.js au lieu d'une réponse JSON ou d'un 404 vide ; 404 au lieu de 403 ou 400 ; serveur en panne qui répond 404 à l'inscription ; contrôles `auth:*` et `inscription:*` absents du script). Unitaires : 6 en échec (module `gestionnaire.ts` et `route.ts` absents). Passaient avant le code, et pourquoi : le texte « Ce lien n'est plus valable » mot pour mot (textes écrits avec les tests, contrat des pages) ; la redirection 308 de la barre finale (comportement de Next.js, figé pour qu'il reste le même pour un chemin ouvert et un chemin inexistant une fois la route en place) ; les défauts préexistants du serveur factice.

**Tests modifiés pendant l'implémentation, sans changer ce qu'ils prouvent** :

- `e2e/inscription.spec.ts`, en-tête `Origin` : lu par `request().allHeaders()` ; `headers()` de Playwright omet les en-têtes posés par le navigateur.
- `e2e/inscription.spec.ts`, sans JavaScript : le message est lu par `textContent` du `<noscript>` ; `getByText` et `toContainText` de Playwright ignorent le texte d'un `<noscript>` (le HTML servi le contient, vérifié).
- `e2e/auth.attaque.spec.ts`, barre finale : sortie de la liste des chemins fermés pendant la phase rouge, dans un test à part (Next.js redirige toute adresse à barre finale avant la route).
- `e2e/zones.attaque.spec.ts` (0.6) : « `/api/auth` n'est pas exposé, même document qu'une adresse inexistante » devient « `/api/auth/get-session` est fermé : même réponse qu'un chemin inexistant de `/api/auth` » ; sa prémisse disparaît avec l'exposition voulue par cette fiche.
- `e2e/controle-deploiement.spec.ts` : 17 requêtes par passage au lieu de 10, dont quatre `POST` sans corps ; sur le site construit en local, les deux contrôles `inscription:*` échouent, et eux seuls (inscription ouverte hors production : témoin).
- `src/server/actions/inventaire.test.ts` : le faux `env` déclare `configurationEmail`, lu par le gestionnaire que charge la route.

**Décisions par défaut appliquées** (aucune ne change une règle écrite) :

1. Contrôle « inscription fermée » par quatre `POST` sans corps ni `Origin` (seule façon de le prouver sur la production) ; sans effet par construction (`controle-deploiement.md`, section 1).
2. Production lue de `configurationEmail.estProduction` (même source `VERCEL_ENV`, déjà validée) plutôt qu'une nouvelle valeur exportée par `env.ts`.
3. Champs écrits à la main (`src/components/compte/champ.tsx`), aux jetons de Signal, au lieu d'ajouter le composant `input` de shadcn (qui demanderait un accord).
4. Formulaires affichés seulement après hydratation : sans JavaScript, un formulaire HTML partirait en `GET`, mot de passe dans l'adresse.
5. Longueurs des champs dans `src/schemas/regles-compte.ts`, sans Zod : Zod dans le navigateur déclenchait une violation `eval` de la politique.
6. Adresses de bout en bout tirées par exécution (`e2e/comptes-e2e.ts`) et inscrites dans `EMAIL_DESTINATAIRES_AUTORISES` des serveurs : la porte n'envoie qu'à la liste hors production, transport `fichier` compris. Comptes supprimés en fin de suite (8 par exécution), `DATABASE_URL` lue comme `vitest.config.mts`.

**Décisions du développeur sur la PR 2** (le 2026-10-13), chacune testée :

- Les quatre `POST` du contrôle après déploiement sont acceptés, sans corps, sans `Origin`, sans cookie, sans `Authorization` : `optionsRequete` (`scripts/controle-deploiement.mjs`) refuse tout autre `POST` ; le serveur factice vérifie ce qu'il reçoit (`e2e/controle-deploiement.spec.ts`).
- Le nettoyage des comptes de bout en bout est accepté : `DATABASE_URL` seule, jamais `DATABASE_URL_MIGRATION` ; la liste exacte des adresses de l'exécution, toutes en `.invalid`, par égalité (`email = ANY($1)`), sans `LIKE` ni motif ; refus si `VERCEL_ENV` est défini (`e2e/nettoyer-comptes.spec.ts`).
- Section 7 : la preuve Gmail d'abord, l'essai de l'adresse IP ensuite.
- Dettes inscrites dans `PLAN.md`, section 7 : identifiant d'incident absent de la réponse d'erreur de `/api/auth`, et `email.compte` partagée sur `dev`.
7. `BETTER_AUTH_URL` imposée à `http://localhost:3000` pour le serveur de bout en bout : l'origine acceptée ne dépend plus de `.env.local`.
8. L'erreur inattendue s'affiche « Une erreur est survenue. » sans identifiant d'incident : la réponse normalisée de la PR 1 n'en porte pas (l'identifiant est au journal technique).

**Limites constatées** (réglé le 2026-10-14 par `e2e-base-jetable.md`, sauf avec `E2E_BASE=dev`) : `email.compte` (100 par 24 h) est partagée par tous les tests de bout en bout lancés sur `dev` (environ 6 emails par exécution) : au-delà d'une quinzaine d'exécutions par jour, les emails ne partent plus et les tests du parcours échouent, jusqu'à la purge des compteurs. En CI, la base est neuve.

**Vérifications** : `npm run verifier` vert (format, lint, typecheck, 57 fichiers et 1 841 tests unitaires, construction, 279 tests de bout en bout, ports 3000 et 3101 libres) ; `npm run test:integration` : 21 fichiers, 185 réussis et 1 échec attendu (déjà présent).

**À faire par le développeur avant la fusion** : section 7, points 1 à 5, dans cet ordre (essai depuis le poste, variables de la branche `feat/1.1-inscription-pr2`, preuve Vercel → Gmail, puis essai de l'en-tête d'adresse IP selon la section 3.4 corrigée, journaux du déploiement). Fait le 2026-10-14, tout conforme : résultats en section 7 (« Résultats de la preuve sur la prévisualisation »).
