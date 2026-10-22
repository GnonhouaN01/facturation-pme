# Fonctionnalité : double authentification et codes de secours

Statut : validée le 2026-10-18 ; PR 1 implémentée le 2026-10-19 et fusionnée (#58) ; PR 2 implémentée le 2026-10-19 (« Notes de l'implémentation ») ; preuve manuelle regroupée des deux PR à faire par le développeur (« Vérifications manuelles »). Fiche rédigée le 2026-10-18 ; les vrais choix tranchés par le développeur le même jour (section « Décisions »), les autres points selon la recommandation de l'assistant (section « Décisions par défaut »).

Jalon 1, fonctionnalité 1.4 de `docs/PLAN.md`. Taille M (plutôt haute). Cas d'utilisation : UC-04, UC-02 (étape 3, erreurs 3a, 3b, 4a), UC-03 (« Abus » : la double authentification reste exigée). Exigences : F-003, S-12, S-13, S-10, S-11, S-14 (partie compte), S-15, S-17, S-54, S-55, S-63, S-70 (« connexions sensibles »), S-81, S-82, S-85, S-87, S-88. Menaces : T-02, T-06, T-04 (report de la 1.3), T-01, T-03, T-07, T-39, T-43, T-55, T-65.

## Contexte

Un mot de passe seul ne protège pas un compte dont l'utilisateur a réutilisé le mot de passe ailleurs, ou qui s'est fait voler le sien (T-01, T-02). F-003 demande un second facteur par code temporaire (application d'authentification, TOTP) et des codes de secours à usage unique ; S-12 le rend obligatoire pour les Propriétaires et les Comptables.

Aujourd'hui :

- `src/server/auth/config.ts` charge `twoFactor()` sans option depuis le jalon 0 : la table `two_factor` et la colonne `user.two_factor_enabled` existent (migrations `20261003110224_glamorous_red_ghost` et `20261008120429_creer-tables-auth-uuid`, avec `verified`, `failed_verification_count` et `locked_until`). Aucun utilisateur ne peut l'activer : `/two-factor/*` répond comme une adresse inexistante (`connexion.md`, section 1.2).
- `src/server/auth/points-entree.ts` ouvre sept points d'entrée, fermés en production par `COMPTES_OUVERTS_EN_PRODUCTION = false`. Une connexion dont la réponse porte `twoFactorRedirect` devient `erreur` (branche fermée par défaut, `connexion.md`, section 1.1).
- `lireSession` (`src/server/auth/session.ts`) ne rend que l'utilisateur et l'organisation active ; la chaîne de contrôles réserve son étape 7 à la double authentification par rôle (`chaine-controles.md`, sections 5 et 11).
- Les comptes restent fermés en production : la PR 2 de la 1.3 (#52) attend la page `/donnees-personnelles` et la formalité ARTCI (décision D de la 1.3, `PLAN.md`). Base de production vérifiée le 2026-10-18 : 9 migrations, 11 tables, droits conformes, aucun compte.

Points reportés à la 1.4 par les fiches précédentes, tous traités ici :

| Point | Origine | Section |
|---|---|---|
| Étape 3 d'UC-02, erreurs 3a, 3b et 4a ; branche `twoFactorRedirect` | `connexion.md`, « Reporté » | 4, 9 |
| « Connexions sensibles » de S-70 : définition et lieu | `connexion.md`, section 9 et « Reporté » ; `SPEC.md` section 8, point 5 | 12 |
| Étape 7 de la chaîne et test de T-02 | `chaine-controles.md`, section 11 ; `PLAN.md`, jalon 1 | 9 (PR 2) |
| Test « la double authentification reste exigée après une réinitialisation » (T-04, UC-03 « Abus ») ; choix du stockage des codes dans `verification` | `mot-de-passe.md`, « Reporté », section 3.2 | 3.3, tests |

## Problème

- Aucun utilisateur ne peut protéger son compte par un second facteur ; aucun Propriétaire ni Comptable ne le peut alors que S-12 l'exige.
- Tel que Better Auth 1.7.7 le fournit (section 1), l'extension :
  - renvoie dans les **corps** le secret TOTP (adresse `otpauth://`), les codes de secours en clair et le **jeton de session** (`token`) ;
  - stocke les codes de secours **chiffrés et réversibles** (clé tirée de `BETTER_AUTH_SECRET`), pas hachés (`THREATS.md` 7.2 les veut hachés) ;
  - stocke l'identifiant de la connexion en attente du code **en clair** dans `verification` ;
  - propose un « appareil de confiance » de 30 jours (`trustDevice`), qui dispense ensuite du code ;
  - désactive la double authentification sur le **seul mot de passe** (UC-04 exige aussi un code, et l'interdit aux Propriétaires et Comptables) ;
  - régénère les codes de secours sur le seul mot de passe : une session volée plus le mot de passe donneraient dix codes valables, donc le compte sans téléphone ;
  - ne limite les codes que par connexion en attente (5) et par un verrou de compte (10 échecs, 15 minutes) : un détenteur du mot de passe essaie 960 codes par jour ;
  - accepte un code TOTP déjà utilisé tant qu'il reste dans sa fenêtre (environ 90 secondes) ;
  - ne vérifie aucun code ni aucune limite quand la vérification passe par une session (activation) ;
  - rend toute nouvelle session valable 7 jours pleins à l'activation et à la désactivation (rotation de session), et laisse vivre les autres sessions, ouvertes sans second facteur.

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Sept points d'entrée de plus | `src/server/auth/points-entree.ts`, `src/server/auth/double-authentification.ts` | Connexion par code ou code de secours ; activation, confirmation, remplacement, régénération, désactivation |
| Réglages de Better Auth | `src/server/auth/config.ts` | Options de `twoFactor`, codes de secours sous empreinte, identifiant d'attente sous empreinte |
| Codes de secours | `src/server/auth/codes-secours.ts` | Génération, normalisation de la saisie, empreinte HMAC |
| Code QR | `src/server/auth/qr.ts`, `src/components/compte/code-qr.tsx` | Matrice calculée sur le serveur par `uqr` (décision 1), tracée en SVG par React |
| Sessions | `src/server/db/sessions.ts` | Autres sessions fermées après un changement du second facteur |
| Anti-rejeu | `src/server/auth/tranche-totp.ts`, `src/server/db/double-authentification.ts` | Dernière tranche de temps acceptée par compte (décision 4) |
| Récupération manuelle | `docs/exploitation/remise-a-zero-double-authentification.md`, `src/server/journal/actions.ts` | Procédure pas à pas, trace au journal d'audit (décision 2) |
| Limites | `src/server/debit/limites.ts`, `src/server/auth/gestionnaire.ts` | Par adresse IP (Better Auth), par compte, gestion |
| Emails | `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | Six notifications, budget `email.double_auth` |
| Pages | `src/app/(public)/connexion/`, `src/app/(compte)/compte/`, `src/app/(compte)/compte/double-authentification/` | Étape du code, état sur `/compte`, activation et gestion |
| Exigence par rôle (PR 2) | `src/server/actions/action.ts`, `src/server/auth/session.ts`, `src/server/autorisation/matrice.ts` | Étape 7 de la chaîne (S-12, S-13, T-02) |

### 1. Ce que fait Better Auth 1.7.7

Lu dans `node_modules/better-auth/dist/plugins/two-factor/index.mjs`, `verify-two-factor.mjs`, `totp/index.mjs`, `backup-codes/index.mjs`, `otp/index.mjs`, `schema.mjs`, `constant.mjs`, `error-code.mjs`, `crypto/index.mjs`, `db/verification-token-storage.mjs`, `db/internal-adapter.mjs` (`createSession`), `api/routes/password.mjs` (`verifyPassword`), `utils/password.mjs` et `node_modules/@better-auth/utils/dist/otp.mjs`.

**Points d'entrée** :

| Point | Ce qu'il fait |
|---|---|
| `POST /two-factor/enable` | Session exigée. Corps `{ password, method: "totp" \| "otp", issuer? }`. Vérifie le mot de passe (`400 INVALID_PASSWORD`). Si une ligne `two_factor` **vérifiée** existe : `400 TOTP_ALREADY_ENABLED`. Sinon crée ou remplace la ligne : secret `generateRandomString(32)` (alphabet `a-z0-9A-Z-_`, environ 192 bits), **chiffré** ; dix codes de secours ; `verified: false` ; `two_factor_enabled` inchangé. Corps : `{ method, totpURI, backupCodes }`, l'adresse `otpauth://totp/<émetteur>:<email>?secret=<base32>&issuer=...&digits=6&period=30` et les codes **en clair**. `method: "otp"` sans `sendOTP` : `400 OTP_NOT_CONFIGURED` |
| `POST /two-factor/verify-totp` | Corps `{ code, trustDevice? }`. **Deux usages**, choisis par Better Auth selon la présence d'une session (`verifyTwoFactor`) : **avec session**, vérification simple, sans limite ni verrou ; si la ligne n'est pas vérifiée, elle le devient, `two_factor_enabled` passe à vrai et la session est remplacée par une nouvelle (`createSession` puis `deleteSession`). **Sans session**, avec le cookie signé `two_factor` : connexion en attente (ci-dessous). Corps de succès : `{ token, user }`, **jeton de session en clair** |
| `POST /two-factor/verify-backup-code` | Corps `{ code, disableSession?, trustDevice? }`. Mêmes deux usages. Déchiffre la liste, cherche le code (`includes`), écrit la liste sans lui par une mise à jour **conditionnée à l'ancienne valeur** (`incrementOne ... where backupCodes = <ancienne>`) : de deux usages simultanés du même code, un seul réussit, l'autre reçoit `409 CONFLICT`. Ne regarde pas `verified` |
| `POST /two-factor/generate-backup-codes` | Session et `two_factor_enabled` exigés ; mot de passe (`checkPassword`). Dix nouveaux codes ; les anciens ne servent plus. Corps : `{ status, backupCodes }` en clair |
| `POST /two-factor/disable` | Session (`sensitiveSessionMiddleware`, simple lecture de la session), mot de passe. `two_factor_enabled` à faux, ligne `two_factor` supprimée, session remplacée par une nouvelle, cookie d'appareil de confiance effacé. **Aucun code demandé** |
| `POST /two-factor/get-totp-uri` | Session, mot de passe ; rend à nouveau l'adresse `otpauth://`, donc le secret |
| `POST /two-factor/send-otp`, `POST /two-factor/verify-otp` | Code envoyé par email ou SMS ; `400 OTP_NOT_CONFIGURED` sans `otpOptions.sendOTP` |
| `generateTOTP`, `viewBackupCodes` | `serverOnly` : aucun chemin |

**Connexion d'un compte à double authentification** (crochet `after` sur `/sign-in/email`) : quand `newSession.user.twoFactorEnabled` est vrai, Better Auth lit d'abord un cookie d'appareil de confiance (`trust_device`, signé, 30 jours) qui, valable, laisse passer la connexion **sans code**. Sinon, il **supprime la session** qu'il vient de créer et efface son cookie, crée deux lignes `verification` (`2fa-<20 caractères>` → identifiant de l'utilisateur, et `2fa-attempts-2fa-<...>` → `"0"`), pose le cookie signé `two_factor` (`Max-Age` 600 par défaut, `twoFactorCookieMaxAge`), et répond `200 { twoFactorRedirect: true, twoFactorMethods: ["totp"] }`. Aucune session n'existe avant le code (T-02).

**Vérification sans session** (`verifyTwoFactor`) : cookie `two_factor` absent, mal signé, ou ligne absente ou expirée : `401 INVALID_TWO_FACTOR_COOKIE`. Verrou du compte posé : `429 ACCOUNT_TEMPORARILY_LOCKED`. **5 essais par connexion en attente** (`beginAttempt(5)`) ; au sixième, la connexion en attente est détruite : `400 TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`. Code faux : `401 INVALID_CODE` (ou `INVALID_BACKUP_CODE`), essai compté, et échec compté sur le compte. Code juste : l'attente est **consommée** (usage unique), une session est créée (7 jours), le cookie de session posé, `two_factor` effacé ; corps `{ token, user }`.

**Verrou du compte** (`accountLockout`, actif par défaut) : 10 échecs consécutifs, toutes connexions et tous facteurs confondus, verrouillent le compte 15 minutes (`failed_verification_count`, `locked_until` de `two_factor`, incrément atomique). Un succès remet le compte à zéro.

**TOTP** : `@better-auth/utils/otp`, HMAC-SHA-1, 6 chiffres, période de 30 secondes, **fenêtre de ±1 pas** (`window = 1`) : un code est accepté pendant environ 90 secondes ; comparaison en temps constant. **Aucune protection contre le rejeu** d'un code dans sa fenêtre.

**Stockage.** Secret : `symmetricEncrypt`, XChaCha20-Poly1305, clé = SHA-256 de `BETTER_AUTH_SECRET` (ou enveloppe versionnée si plusieurs secrets sont déclarés) ; aucune empreinte possible, le serveur doit relire le secret pour calculer le code. Codes de secours : par défaut `storeBackupCodes: "encrypted"` (même chiffrement, réversible) ; l'option `{ encrypt, decrypt }` laisse fournir les deux fonctions ; `customBackupCodesGenerate` remplace la génération (par défaut 10 codes de 10 caractères `[a-zA-Z0-9]`, présentés `xxxxx-xxxxx`). Lignes `verification` : identifiants en clair, sauf surcharge `storeIdentifier` par préfixe (`getStorageOption`, `startsWith`), déjà utilisée par la 1.3 pour `reset-password:`.

**Débit.** L'extension ajoute la règle `/two-factor/*` à 3 par 10 secondes par adresse IP ; nos `customRules` (1.1) la remplacent par chemin.

**Journal.** `logger.error` seulement quand `totp` ou `otp` n'est pas configuré (chemins fermés ici). Avec `consignerAuth` (1.1), une ligne fixe `[auth] error`, sans message.

**Effet sur les sessions.** `createSession(userId, false, ancienne)` reprend l'adresse IP, le navigateur et l'organisation active de l'ancienne session, mais lui donne une **échéance neuve de 7 jours** (`expiresAt` calculé après la reprise). Les autres sessions de l'utilisateur ne sont jamais touchées. La réinitialisation du mot de passe (1.3) ne touche ni `two_factor_enabled` ni le secret.

### 2. Les points d'entrée (T-55, S-81, S-82)

#### 2.1 Ouverts par cette fiche

Les points suivent les étapes de la section 2.2 de `inscription.md` (origine, taille et type, schéma strict, requête interne construite en mémoire, réponse traduite en une liste fermée, jamais le corps de Better Auth). Deux chemins publics n'existent pas chez Better Auth : ce sont des opérations composées par notre passerelle (`confirm-enable`, `replace`).

| Méthode et chemin public | Usage | Appels internes à Better Auth | Cookie transmis |
|---|---|---|---|
| `POST /two-factor/verify-totp` | UC-02 étape 3 : code de l'application | `/two-factor/verify-totp` | `two_factor` **seul** |
| `POST /two-factor/verify-backup-code` | UC-02 erreur 3b : code de secours | `/two-factor/verify-backup-code` | `two_factor` **seul** |
| `POST /two-factor/enable` | UC-04 étapes 1 et 2 | `/two-factor/enable` (`method: "totp"`) | session **seule** |
| `POST /two-factor/confirm-enable` | UC-04 étapes 3 et 4 ; fin d'un remplacement | `/two-factor/verify-totp` | session seule |
| `POST /two-factor/replace` | Nouveau téléphone (section 7) | vérification du code, puis `/two-factor/enable` | session seule |
| `POST /two-factor/generate-backup-codes` | Nouveaux codes de secours | vérification du code, puis `/two-factor/generate-backup-codes` | session seule |
| `POST /two-factor/disable` | Désactivation (UC-04, « Abus ») | vérification du code, puis `/two-factor/disable` | session seule |

**Séparation des cookies.** Better Auth choisit le sens de `verify-totp` selon la présence d'une session : un navigateur connecté au compte A qui envoie le code d'une connexion en attente du compte B ferait vérifier le code de A, sur la session de A. La passerelle ne transmet donc à chaque point que le cookie de son usage, extrait de l'en-tête reçu par son nom exact : `two_factor` pour la connexion, le cookie de session pour la gestion. Jamais `trust_device` ni `dont_remember`. La connexion (`/sign-in/email`) ne transmet toujours aucun cookie (1.2) : un cookie d'appareil de confiance n'est jamais lu.

**Schémas** (`src/schemas/double-authentification.ts`, stricts) :

| Point | Corps admis | Refusés notamment |
|---|---|---|
| `verify-totp`, `confirm-enable` | `{ code }`, exactement 6 chiffres | `trustDevice`, `disableSession`, espaces |
| `verify-backup-code` | `{ code }`, 10 caractères de l'alphabet des codes (section 3.2), tiret, espaces et majuscules admis à la saisie puis normalisés | `trustDevice`, `disableSession` |
| `enable` | `{ motDePasse }`, 1 à 128 caractères | `method`, `issuer`, `password` |
| `replace`, `generate-backup-codes`, `disable` | `{ motDePasse, code }`, code de l'application (6 chiffres) ou code de secours | champ inconnu |

**Ordre des contrôles de la gestion** (`enable`, `confirm-enable`, `replace`, `generate-backup-codes`, `disable`) :

1. origine, type, taille, schéma (comme tout point) ;
2. **session** relue par `lireSession` : absente, non vérifiée, cookie forgé : `connexion_requise`, Better Auth jamais appelé ;
3. **limite de gestion** par utilisateur (`auth.double_auth_gestion`, section 6) ;
4. `disable` seulement : **rôle exigeant** (section 7.3) : `double_authentification_obligatoire` ;
5. **mot de passe**, vérifié sans rien consommer (`motDePasseValide`, dépendance liée à `auth.api.verifyPassword`, appel serveur) : `mot_de_passe_incorrect`. Avant le code : un mauvais mot de passe ne brûle pas un code de secours ;
6. **code** (`replace`, `generate-backup-codes`, `disable`) : appel interne à `/two-factor/verify-totp` ou `/two-factor/verify-backup-code` avec le cookie de session ; un code de secours ainsi vérifié est consommé. Faux : `code_incorrect` ;
7. l'opération de Better Auth ;
8. après le succès : sessions (section 8), email planifié (section 10).

**Ordre des contrôles de la connexion** (`verify-totp`, `verify-backup-code`) :

1. origine, type, taille, schéma ;
2. **connexion en attente** : l'identifiant est lu dans le cookie `two_factor` (valeur avant la signature, comme `jetonDeSession`), puis la ligne `verification` correspondante (`utilisateurDuDefi`, dépendance liée à `internalAdapter.findVerificationValue`, qui applique l'empreinte de la section 3.3). Absente ou expirée : `connexion_expiree`, Better Auth jamais appelé. La signature reste vérifiée par Better Auth à l'étape 5 ; cette lecture ne sert qu'à connaître le compte visé ;
3. **limite par compte** (`auth.double_auth_compte`) pour cet utilisateur ;
4. code de l'application seulement : **anti-rejeu** (section 6.1) : la tranche du code est calculée et réservée pour ce compte, ou refusée ;
5. Better Auth : limite par adresse IP, signature, verrou, 5 essais, vérification, consommation, session ;
6. après le succès : session de l'ancien cookie révoquée (section 8.1), notification si c'est un code de secours.

#### 2.2 La connexion change de réponse

`POST /sign-in/email` : une réponse `200` qui porte `twoFactorRedirect` n'est plus `erreur`. Elle devient `200 { ok: true, etape: "code" }`, et **seul** le cookie `two_factor` est transmis (l'effacement du cookie de session posé par Better Auth est retiré : il déconnecterait le navigateur avant le code, et la révocation de l'ancienne session se fait après le code, section 8.1). Une réponse `200` qui ne pose ni cookie de session ni cookie `two_factor` reste `erreur`. La durée plancher de 800 ms s'applique toujours. La réponse dit à qui connaît le mot de passe si le compte a un second facteur : c'est inhérent au parcours, et ne dit rien à qui ne le connaît pas (T-07 inchangée : adresse inconnue, mauvais mot de passe et compte non vérifié répondent toujours pareil).

#### 2.3 Restent fermés

| Points d'entrée | Jusqu'à |
|---|---|
| `/two-factor/get-totp-uri` | **Toujours.** Le secret n'est montré qu'une fois, à l'activation ; un nouveau téléphone passe par le remplacement (section 7), qui crée un nouveau secret |
| `/two-factor/send-otp`, `/two-factor/verify-otp` | **Toujours, sauf fiche contraire.** Pas de code par email : la boîte mail deviendrait le second facteur, et le budget Gmail est compté (RR-10) |
| `/verify-password` | Appelé par le serveur seulement (`auth.api`), jamais exposé |
| Tous ceux de `connexion.md` 1.2 et `mot-de-passe.md` 2.2 | Inchangé |

Le test d'inventaire passe à **quatorze** points ouverts : chaque point déclaré par l'instance, hors de la liste, répond comme une adresse inexistante ; les deux chemins propres à l'application sont vérifiés à part.

#### 2.4 Réponses

| Situation | Réponse |
|---|---|
| Connexion, compte sans second facteur | `200 { ok: true }` et le cookie de session (1.2) |
| Connexion, compte à second facteur | `200 { ok: true, etape: "code" }` et le cookie `two_factor` seul |
| Code juste (connexion) | `200 { ok: true }` et le cookie de session ; `two_factor` effacé |
| Code faux, code de secours déjà utilisé, code rejoué, usage simultané perdu (`409`) | `400 { ok: false, raison: "code_incorrect" }` |
| Connexion en attente absente, expirée, ou détruite après 5 essais | `400 { ok: false, raison: "connexion_expiree" }` |
| Limite atteinte (adresse IP, compte, gestion) ou verrou de Better Auth | `429 { ok: false, raison: "trop_de_requetes" }` |
| `enable`, `replace` réussis | `200 { ok: true, qr, cle, codes }` (section 3.4) |
| `generate-backup-codes` réussi | `200 { ok: true, codes }` |
| `confirm-enable`, `disable` réussis | `200 { ok: true }` et le nouveau cookie de session si Better Auth en pose un |
| Gestion sans session valable | `401 { ok: false, raison: "connexion_requise" }` |
| Mauvais mot de passe (gestion) | `400 { ok: false, raison: "mot_de_passe_incorrect" }` |
| Désactivation par un Propriétaire ou un Comptable | `403 { ok: false, raison: "double_authentification_obligatoire" }` |
| Panne, réponse de Better Auth hors de la forme attendue | `500 { ok: false, raison: "erreur", incident }` |

Cinq raisons nouvelles dans la liste fermée de `/api/auth` : `code_incorrect`, `connexion_expiree`, `connexion_requise` (déjà connue de la chaîne de contrôles, même sens), `mot_de_passe_incorrect`, `double_authentification_obligatoire`. `appel-auth.ts` les reconnaît ; toute autre raison reste `erreur`.

### 3. Les secrets : jamais en clair en base, ni dans un journal (S-15, S-54, T-39)

#### 3.1 Le secret de l'application

- **En base** : chiffré par Better Auth (section 1). Une copie de la base seule ne donne aucun secret ; la base plus `BETTER_AUTH_SECRET` les donnent tous (« Limites connues »).
- **Vers le navigateur** : une seule fois, dans la réponse de `enable` ou de `replace`, sous deux formes : la matrice du code QR et la clé en base32 (saisie à la main). `cache-control: no-store` (comme toute réponse de la passerelle). Jamais dans une adresse, un cookie, un email, un journal. `/two-factor/get-totp-uri` reste fermé.
- **Abandon de l'activation** : la ligne non vérifiée garde le secret chiffré, jusqu'à la prochaine activation (qui la remplace) ou la suppression du compte (`ON DELETE CASCADE`). `two_factor` n'a pas de date de création : aucune purge par âge sans migration (« Limites connues »).

#### 3.2 Les codes de secours : sous empreinte

**Génération** (`genererCodesSecours`, `customBackupCodesGenerate`) : 10 codes de 10 caractères tirés par `randomInt` de `node:crypto` dans un alphabet de 31 caractères sans confusion à la lecture (`abcdefghjkmnpqrstuvwxyz23456789` : ni `i`, `l`, `o`, `0`, `1`), environ 49 bits par code, présentés `xxxxx-xxxxx`. Minuscules seulement : un code noté sur papier se ressaisit sans piège de casse.

**Saisie** (`normaliserCodeSecours`) : espaces et tirets retirés, minuscules ; puis exactement 10 caractères de l'alphabet, sinon `invalide`.

**Empreinte** (`empreinteCodeSecours`) : `cs1:` suivi de HMAC-SHA-256 en `base64url`, clé dérivée de `BETTER_AUTH_SECRET` par HKDF avec une étiquette propre (`facturation-pme/codes-secours/v1`, comme `deriverSecret` de la 0.5). Une copie de la base seule ne permet pas d'essayer les codes hors ligne.

**Branchement sur Better Auth**, sans toucher à son code :

- `storeBackupCodes: { encrypt, decrypt }` : `encrypt(json)` reçoit la liste à stocker et rend la liste des empreintes ; chaque élément est soit un code frais (forme `xxxxx-xxxxx`, à la génération), soit déjà une empreinte (forme `cs1:...`, quand Better Auth réécrit la liste après un usage) : le premier est haché, le second gardé ; toute autre forme lève. `decrypt` rend la liste stockée telle quelle ;
- la passerelle envoie à Better Auth **l'empreinte** du code saisi, jamais le code : `includes` compare des empreintes ;
- les codes en clair ne quittent Better Auth que dans le corps de `enable`, `replace` ou `generate-backup-codes`, que la passerelle relit, vérifie (10 codes de la bonne forme) et transmet une fois.

`THREATS.md` 7.2 : « secret chiffré ; codes de secours sous empreinte HMAC ».

#### 3.3 La connexion en attente : identifiant sous empreinte

`verification.storeIdentifier.overrides` gagne `"2fa-"` → `empreinteAttenteDoubleAuth`, qui rend `double-auth:<SHA-256 en base64url>`. Le préfixe couvre les deux lignes (`2fa-<id>` et `2fa-attempts-2fa-<id>`). Comme pour la 1.3 (section 3.2 de `mot-de-passe.md`), le préfixe stocké diffère du préfixe lu (Better Auth essaie aussi la forme en clair) ; la base ne contient jamais l'identifiant porté par le cookie. La purge quotidienne des lignes expirées de `verification` (1.3, étape `jetons_expires`) les couvre déjà (5 minutes, section 6).

C'est la réponse au report de la 1.3 (« la 1.4 choisira pour ses codes ») : les codes de secours ne vont pas dans `verification`, mais restent dans `two_factor`, sous empreinte (section 3.2).

#### 3.4 Ce que reçoit le navigateur

| Champ | Forme, vérifiée avant l'envoi | Origine |
|---|---|---|
| `qr` | Tableau de lignes de `0` et `1`, carré de 21 à 177 modules | Calculé sur le serveur depuis `totpURI` (`matriceQr`, section 11.3) |
| `cle` | Base32 sans remplissage, lu dans le paramètre `secret` de `totpURI`, groupé par 4 pour la lecture | `totpURI` |
| `codes` | Exactement 10 chaînes `xxxxx-xxxxx` de l'alphabet | `backupCodes` |

Jamais `totpURI` en entier, jamais `token`, jamais `user`. Une réponse de Better Auth hors de cette forme : `erreur` (S-87 appliqué à notre dépendance).

#### 3.5 Journaux

- Journal technique : lignes fixes `[auth]` (avec incident pour `erreur`) et `[email]` (modèle, raison, limite, incident). Jamais un code, un secret, une clé, une adresse `otpauth://`, une adresse email, un identifiant d'utilisateur ou de connexion en attente.
- Corps de Better Auth jamais transmis ni écrits.
- Test : un passage complet (activation, connexion par code, par code de secours, régénération, désactivation) avec une capture du journal du serveur ; aucune des valeurs ci-dessus n'y figure (Vitest et site construit).

### 4. La connexion en deux étapes (UC-02, étapes 3 et erreurs 3a, 3b)

1. `/connexion`, email et mot de passe (1.2, inchangé) ; réponse `etape: "code"`.
2. Le formulaire laisse place au champ « Code de vérification » (6 chiffres, `inputmode="numeric"`, `autocomplete="one-time-code"`), au bouton « Vérifier » et au lien « Utiliser un code de secours », qui remplace le champ par « Code de secours ».
3. `code_incorrect` : « Code incorrect. » ; nouvelle saisie (3a).
4. `connexion_expiree` : « Votre connexion a expiré. Reprenez depuis le début. » et retour à l'étape 1, champs vidés.
5. `trop_de_requetes` : message de la 1.1.
6. Succès : `/compte`, comme une connexion sans second facteur.

**Durée de la connexion en attente** : `twoFactorCookieMaxAge: 5 * 60` (défaut : 10 minutes). Le temps de sortir le téléphone, sans laisser traîner un cookie qui vaut « mot de passe déjà donné ».

**Appareil de confiance** : jamais. `trustDevice` refusé par les schémas, cookie `trust_device` jamais transmis ; chaque connexion demande le code (la session dure 7 jours, décision 3 de la 1.2).

**Réinitialisation du mot de passe** (T-04, report de la 1.3) : elle ne touche pas au second facteur ; la connexion suivante demande le code. Test d'intégration dédié.

### 5. Activation, codes et désactivation (UC-04)

#### 5.1 Activation

Page `/compte/double-authentification` (section 11) :

1. « Mot de passe » et « Continuer » : `POST /two-factor/enable` (UC-04, étape 1).
2. Le code QR, la clé à saisir à la main, et le champ « Code affiché par l'application » (étapes 2 et 3). Les codes de secours, déjà reçus, ne sont **pas encore affichés**.
3. `POST /two-factor/confirm-enable` : Better Auth vérifie le code (fenêtre ±1), marque la ligne vérifiée, passe `two_factor_enabled` à vrai et remplace la session ; nous fermons les autres sessions (section 8.2).
4. Succès : les dix codes de secours, affichés **une seule fois**, avec « Copier les codes » et « J'ai conservé mes codes » (étape 4). Quitter la page les perd : la régénération (section 5.2) en donne d'autres.

Code faux à l'étape 3 : `code_incorrect`, l'activation n'a pas lieu (3a). Abandon : la ligne reste non vérifiée, sans effet (`two_factor_enabled` faux, la connexion ne demande rien).

#### 5.2 Nouveaux codes de secours

« Créer de nouveaux codes », avec mot de passe et code de l'application (ou un code de secours) : `POST /two-factor/generate-backup-codes`. Les anciens ne servent plus. Notification `compte.codes_secours_regeneres`. Le code est exigé en plus du mot de passe : sinon une session volée et le mot de passe donneraient dix codes valables, donc l'accès sans téléphone.

`/compte/double-authentification` affiche le nombre de codes restants (`compterCodesSecours`, longueur de la liste d'empreintes, requête par `db` dans `src/server/db/`), sans les montrer.

#### 5.3 Désactivation

Mot de passe et code (de l'application ou de secours, UC-04 « Abus ») : `POST /two-factor/disable`. Refusée à un Propriétaire ou un Comptable (section 7.3). Better Auth supprime la ligne `two_factor` et remplace la session ; nous fermons les autres sessions. Notification `compte.double_auth_desactivee`.

### 6. Les limites (S-11, T-06, T-01, T-43)

Toutes les tentatives comptent (`DESIGN.md` 3.1). Valeurs dans `limites.ts` seulement (règle 15) ; aucune règle `(fenêtre, maximum)` partagée entre deux limites `auth.*` (invariant de la 1.1).

| Nom | Maximum | Fenêtre | Par | Où |
|---|---|---|---|---|
| `auth.double_auth_code` | 12 | 15 min | Adresse IP | Better Auth, chemin interne `/two-factor/verify-totp` (connexion, confirmation, vérifications de la gestion) |
| `auth.double_auth_secours` | 8 | 15 min | Adresse IP | Better Auth, chemin interne `/two-factor/verify-backup-code` |
| `auth.double_auth_activation` | 6 | 1 h | Adresse IP | Better Auth, `/two-factor/enable` |
| `auth.double_auth_codes` | 3 | 15 min | Adresse IP | Better Auth, `/two-factor/generate-backup-codes` |
| `auth.double_auth_desactivation` | 4 | 15 min | Adresse IP | Better Auth, `/two-factor/disable` |
| `auth.double_auth_compte` | 20 | 24 h | Utilisateur | Notre gestionnaire, à la connexion (code et code de secours confondus), avant Better Auth |
| `auth.double_auth_gestion` | 10 | 1 h | Utilisateur | Notre gestionnaire, les cinq points de la gestion, avant tout contrôle de mot de passe ou de code |

S'y ajoutent, inchangés et figés par `config.test.ts` : **5 essais par connexion en attente**, et le **verrou de Better Auth** (10 échecs consécutifs, 15 minutes).

- **Effet sur T-06** (le pire cas, un attaquant qui a le mot de passe) : 20 codes par jour sur un compte, quelle que soit la provenance, chacun avec 3 codes acceptés sur 1 000 000 (fenêtre ±1). Environ 6 chances sur 100 000 par jour, 2 % par an d'essais ininterrompus, et une alerte au titulaire chaque jour (section 10). Sans la limite par compte : 960 codes par jour (verrou seul), 23 % par an. Pour un code de secours : 10 codes de 49 bits, hors de portée.
- **Limite par compte atteinte** : `trop_de_requetes`, et l'email `compte.double_auth_tentatives` planifié, sous les limites par destinataire (au plus une poignée par jour). Le titulaire est bloqué jusqu'à la fin de la fenêtre, même avec le bon code : c'est le prix de la limite, payé seulement face à quelqu'un qui connaît déjà son mot de passe ; l'email l'invite à le changer (décision 3, RR-14).
- **Gestion** : Better Auth ne limite rien quand une session est présente (section 1). Sans `auth.double_auth_gestion`, une session volée essaierait sans fin des mots de passe ou des codes.
- **Valeur comptée** : l'identifiant de l'utilisateur, jamais l'entrée (règle 15) ; pour la connexion, celui de la connexion en attente (section 2.1, étape 2).

#### 6.1 Anti-rejeu : la dernière tranche acceptée (décision 4)

Un code de l'application déjà accepté pour un compte est refusé, même dans sa fenêtre de validité (RFC 6238, section 5.2). Better Auth ne dit pas quelle tranche de 30 secondes a correspondu (`verify` rend un booléen) ; notre passerelle la calcule donc elle-même, **avant** Better Auth, pour tout code de l'application (connexion, confirmation, vérifications de la gestion) :

1. secret du compte lu dans `two_factor` et déchiffré par `symmetricDecrypt` de `better-auth/crypto` avec le `secretConfig` de l'instance (`src/server/auth/tranche-totp.ts`) ; jamais écrit, jamais rendu ;
2. code calculé par HMAC-SHA-1 (`node:crypto`, RFC 4226) pour les tranches `t - 1`, `t`, `t + 1`, comparé en temps constant ; aucune ne correspond : rien n'est réservé, Better Auth reçoit le code et compte l'échec ;
3. une tranche `s` correspond : **réservation atomique** (`reserverTranche(utilisateurId, s)`, `src/server/db/double-authentification.ts`), dans une transaction par `db` : `SELECT ... FROM two_factor WHERE user_id = $1 FOR UPDATE` (deux requêtes simultanées d'un même compte passent l'une après l'autre), lecture de la ligne `verification` d'identifiant `double-auth-tranche:<utilisateur>`, refus si sa valeur est supérieure ou égale à `s`, sinon écriture de `s` (suppression de l'ancienne ligne, insertion), échéance à 3 minutes ;
4. réservation refusée : `code_incorrect`, Better Auth jamais appelé.

- **Aucune migration** : la ligne vit dans `verification` (texte et date d'échéance), sans secret (le numéro d'une tranche n'en dit rien). Son échéance de 3 minutes dépasse la fenêtre d'acceptation (±1 tranche) : quand elle a disparu, tout code encore valable est d'une tranche plus récente. La purge quotidienne `jetons_expires` (1.3) la supprime.
- **Réservée avant Better Auth** : un code juste refusé ensuite par Better Auth (verrou, 5 essais, bord de tranche entre nos deux calculs) est perdu ; l'utilisateur attend le suivant, 30 secondes au plus. En échange, deux usages simultanés d'un même code ne peuvent jamais réussir tous les deux.
- **Une tranche plus ancienne** qu'une tranche déjà acceptée est refusée aussi (valeur supérieure ou égale) : un code de la tranche précédente, encore dans la fenêtre, ne passe plus après un code plus récent.
- Codes de secours non concernés : usage unique par construction (section 1).

### 7. Récupération en cas de perte du téléphone

#### 7.1 Téléphone perdu, codes de secours en main

1. Connexion avec un code de secours (UC-02, 3b) ; notification `compte.code_secours_utilise`.
2. `/compte/double-authentification`, « Remplacer l'application » : mot de passe et un **autre** code de secours (ou le code de l'ancienne application, si elle est encore là) : `POST /two-factor/replace`.
3. La passerelle marque la ligne `two_factor` **non vérifiée** (`preparerRemplacement`, requête par `db` dans `src/server/db/`), puis appelle `/two-factor/enable` : Better Auth la remplace, nouveau secret et dix nouveaux codes ; les anciens codes et l'ancien secret ne servent plus. `two_factor_enabled` **reste vrai** tout du long.
4. Code QR, clé, puis `POST /two-factor/confirm-enable` avec le code de la nouvelle application ; les nouveaux codes de secours s'affichent ; autres sessions fermées ; notification `compte.double_auth_remplacee`.

**Pourquoi ne pas désactiver puis réactiver** : entre les deux, le compte n'aurait plus de second facteur, et un Propriétaire ne peut pas le désactiver (section 7.3). Entre les étapes 3 et 4, le compte garde un second facteur : la connexion en attente demande un code, l'application n'est pas encore confirmée (`verified` faux : Better Auth refuse le code TOTP, `TOTP_NOT_ENABLED`), et seuls les **nouveaux** codes de secours, affichés à cette seule session, permettent d'entrer. La passerelle traduit `TOTP_NOT_ENABLED` à la connexion en `code_incorrect`.

#### 7.2 Téléphone et codes perdus

Aucune voie automatique : une récupération par email ferait de la boîte mail le second facteur, et un attaquant qui la détient avec le mot de passe (RR-3) prendrait le compte. **Retenu (décision 2)** : une procédure manuelle du développeur, écrite pas à pas, requêtes SQL exactes comprises, dans `docs/exploitation/remise-a-zero-double-authentification.md` :

1. **demande** reçue depuis l'adresse du compte, à l'adresse de contact du projet (jamais le compte Gmail d'envoi, RR-9) ; toute autre adresse : refus ;
2. **email au titulaire à la demande**, à l'adresse du compte, texte fixe de la procédure : la demande est reçue, la remise à zéro aura lieu dans 72 heures sauf opposition ;
3. **délai de 72 heures** : un titulaire dont la boîte est compromise a le temps de voir l'échange et de s'y opposer ;
4. **remise à zéro**, sur Neon, branche `production`, par le développeur seulement (jamais l'assistant), dans une seule transaction : ligne `two_factor` supprimée, `two_factor_enabled` à faux, **toutes les sessions** du compte supprimées, ligne d'anti-rejeu supprimée, et une **trace au journal d'audit** de chaque organisation dont le titulaire est membre (action `membre.double_auth_remise_a_zero`, ressource : son adhésion), organisation active fixée par `set_config('app.organisation_id', ..., true)` dans la transaction, comme le fait `executerDansOrganisation` ;
5. **email au titulaire à la remise à zéro** : texte fixe ; s'il est Propriétaire ou Comptable, la chaîne lui refuse toute donnée jusqu'à la réactivation (PR 2).

**Écart assumé avec la règle 9** (« toute écriture au journal passe par `journaliser` ») : l'application n'offre aucun écran d'exploitation, et la remise à zéro est faite à la main ; la requête d'insertion est écrite une fois dans la procédure, avec la seule action de la liste fermée prévue pour elle et des détails vides, et la table reste en ajout seul. Un utilisateur sans organisation (avant la 2.1 : tous) ne reçoit aucune trace d'audit ; les deux emails restent la trace. Les emails sont envoyés par le développeur depuis l'adresse de contact, jamais par l'application : aucun modèle de la porte d'envoi n'y sert.

La procédure est écrite et relue avec la PR 1, et éprouvée sur `dev` par le développeur.

#### 7.3 Rôle exigeant : désactivation impossible

`aRoleExigeantDoubleAuth(utilisateurId)` (`src/server/db/`, requête par `db` sur `member`, filtrée sur l'utilisateur) : vrai si l'utilisateur est Propriétaire ou Comptable dans au moins une organisation. La liste des rôles exigeants, `ROLES_DOUBLE_AUTH = ["proprietaire", "comptable"]`, vit à côté de la matrice (`src/server/autorisation/matrice.ts`), seul endroit des règles de rôle. Lecture de `member` (RR-8) : sur les seules lignes de l'utilisateur de la session, aucune ligne d'un autre utilisateur n'est lue ni rendue ; test d'attaque avec deux organisations. Avant la 2.1, aucune adhésion n'existe : le refus se teste avec l'outillage d'organisations (`outils-test`, et `e2e/organisation-e2e.ts`).

### 8. Les sessions (S-17, T-03)

#### 8.1 Connexion

- Aucune session avant le code (Better Auth supprime celle de l'étape 1).
- La session créée au code dure **7 jours à partir du code**, sans prolongation (1.2).
- **Révocation de l'ancienne session du navigateur** (correctif de la 1.2) : déplacée. Si l'étape 1 répond `etape: "code"`, rien n'est révoqué ; elle l'est après un code juste, avec le cookie de session reçu par `verify-totp` ou `verify-backup-code` (lu par la passerelle, jamais transmis à Better Auth). Un code faux ne déconnecte pas.

#### 8.2 Changement du second facteur

| Évènement | Session courante | Autres sessions |
|---|---|---|
| Activation confirmée | Remplacée par Better Auth (nouveau jeton, 7 jours à partir de là) | **Fermées** |
| Remplacement confirmé | Gardée (Better Auth ne la remplace pas : `two_factor_enabled` était déjà vrai) | **Fermées** |
| Remplacement achevé par un autre chemin (section 8.3) | Gardée | **Fermées**, avant l'opération |
| Désactivation | Remplacée par Better Auth | **Fermées** |
| Nouveaux codes de secours | Gardée | Gardées |

- **Autres sessions fermées** (`revoquerAutresSessions(utilisateurId, jetonGarde)`, `src/server/db/sessions.ts`, `DELETE FROM session WHERE user_id = $1 AND token <> $2`) : une session ouverte avant l'activation, peut-être par quelqu'un qui avait le mot de passe, ne garde pas un accès que le second facteur lui refuserait aujourd'hui. Le jeton gardé est celui du cookie de session de la réponse quand Better Auth en pose un, sinon celui du cookie reçu. Échec : `erreur` avec incident, et aucun cookie transmis ; le changement est fait, les sessions vivent encore, une nouvelle tentative les ferme (« Limites connues »).
- **Échéance neuve de 7 jours** à l'activation et à la désactivation (section 1) : acceptée. La rotation exige le mot de passe, et le code pour la désactivation : elle vaut une nouvelle connexion, qui ouvrirait elle aussi 7 jours. Un vol de cookie seul ne permet aucune des deux.
- **Réinitialisation du mot de passe** : toutes les sessions fermées (1.3), second facteur gardé.

#### 8.3 Remplacement achevé hors de `confirm-enable` (correctif du 2026-10-22, `fix(1.4)`)

**Constat.** Entre les étapes 3 et 4 du remplacement (section 7.1), la ligne `two_factor` est non vérifiée et `two_factor_enabled` vrai. `replace`, `generate-backup-codes` et `disable` vérifient le code saisi par `/two-factor/verify-totp` avec le cookie de session. Or Better Auth (`plugins/two-factor/totp/index.mjs`, version 1.7.7), sur un code juste et une ligne non vérifiée, marque la ligne vérifiée : avec le code de la nouvelle application, ces trois chemins achevaient le remplacement **sans fermer les autres sessions** ni prévenir le titulaire. `disable` ne les fermait qu'après une désactivation réussie, et `replace` relançait un remplacement sur la ligne tout juste vérifiée.

**Chemins qui n'achèvent rien** : la connexion (Better Auth refuse une ligne non vérifiée, `TOTP_NOT_ENABLED`) ; un code de secours (`verify-backup-code` ne touche pas `verified`) ; la nouvelle authentification de la 1.6, qui refuse pendant un remplacement (`docs/features/nouvelle-authentification.md`).

**Correctif** (`verifierCodeGestion`, `src/server/auth/double-authentification.ts`) : pour ces trois chemins, si la ligne était à confirmer et que le code de l'application est juste, les autres sessions sont fermées (jeton du cookie reçu gardé) **avant l'opération**, et `compte.double_auth_remplacee` est envoyé, comme à la confirmation. Échec de la fermeture : `erreur` avec incident, l'opération n'est pas appelée, aucun email. Une désactivation réussie ferme ensuite à nouveau, avec la session neuve, et envoie aussi `compte.double_auth_desactivee`.

**Tests** (phase rouge : 5 tests unitaires et 2 d'intégration en échec avant le correctif ; dans ces derniers, l'autre session survivait) :

- `src/server/auth/double-authentification.test.ts`, « chemins qui achèvent un remplacement en cours » : un test par chemin (`generate-backup-codes`, `replace`, `disable` refusée par Better Auth après le code), ordre code, fermeture, opération ; désactivation réussie (deux fermetures, deux emails) ; code de secours (rien de fermé) ; fermeture en échec.
- `src/server/db/double-authentification.integration.test.ts`, vraie instance : remplacement achevé par nouveaux codes (ligne vérifiée, autre session supprimée, email) ; par un nouveau remplacement (autre session supprimée). Le chemin `disable` réussi fermait déjà les autres sessions : son défaut n'apparaît qu'en cas d'échec après le code, prouvé par le test unitaire.

### 9. PR 2 : la double authentification exigée par rôle (S-12, S-13, T-02)

- **`SessionLue`** gagne `doubleAuthentification: boolean` (`user.twoFactorEnabled === true`, lu avec la session à chaque requête, sans cache).
- **Étape 7 de la chaîne** (`executerChaine` et `etablirContexte`, `src/server/actions/action.ts`) : après l'adhésion et la matrice (étape 6), avant la nouvelle authentification (8) et la validation de l'entrée (9) : si `ROLES_DOUBLE_AUTH` contient le rôle relu et que `doubleAuthentification` est faux, `refuse`, pour toute action et toute lecture de page, transaction annulée. Rien de l'entrée n'est lu avant (un membre sans second facteur ne sonde pas le schéma).
- **S-13** : le rôle et l'état du second facteur sont relus à chaque requête ; un membre promu Comptable sans second facteur est refusé dès la requête suivante, et un Propriétaire dont le second facteur disparaît (procédure manuelle) aussi.
- **Pages** : le refus reste la page « introuvable » de `lirePourPage` (S-02 inchangé). **UC-02 4a** (« amène à UC-04 ») : aucun utilisateur n'a d'organisation avant la 2.1, et la connexion mène à `/compte` (1.2) ; le renvoi vers l'activation est reporté à la 2.1, qui choisit la page d'arrivée et lit les adhésions (« Reporté »). `/compte/double-authentification` dit dès la PR 1 : « Obligatoire pour les Propriétaires et les Comptables. »
- **S-12, seconde phrase** (« un Propriétaire peut l'imposer à toute son organisation ») : réglage de l'organisation, reporté à la 2.2.
- **Matrice** : aucune ligne nouvelle (`THREATS.md` section 6, « chaque utilisateur gère son propre compte »). Le test exhaustif de la matrice est inchangé ; un test propre à l'étape 7 la parcourt pour chaque rôle.
- **Ordre** : l'étape 7 suit l'étape 6. Un rôle refusé par la matrice reste refusé à l'étape 6 ; l'étape 7 ne concerne qu'un membre que la matrice laisse passer. Les deux refus sont la même réponse `refuse` (S-02).
- **Outillage des tests** : `creerMembre` (`src/server/db/outils-test/membres.ts`) gagne l'option `doubleAuthentification`, **vraie par défaut** : un Propriétaire ou un Comptable réel a son second facteur, et les tests des fiches précédentes gardent leur sens ; les tests de l'étape 7 passent `false`. De bout en bout, le gabarit connecté (`e2e/affichage-connecte.spec.ts`) active d'abord la double authentification par l'interface, puis rattache le compte comme Propriétaire ; les étapes du parcours d'activation passent dans `e2e/double-auth.ts`, partagé par les deux fichiers.

### 10. Les emails (règle 17, S-55, T-65)

Planifiés par `after()` depuis `src/server/auth/emails.ts`, comme les rappels de la 1.1 et de la 1.3 : la réponse n'attend pas l'envoi, rien ne part pendant une transaction, un échec ne lève pas. L'adresse est lue en base par l'identifiant de l'utilisateur (`adresseUtilisateur`, `src/server/db/`), jamais reçue de la requête. Texte brut, textes dans `src/textes/emails.ts`, phrase de fin « ne pas répondre », aucun paramètre (`z.strictObject({})`), ni date, ni adresse IP, ni appareil, ni code.

| Modèle | Quand | Contenu |
|---|---|---|
| `compte.double_auth_activee` | Activation confirmée | Sujet « Double authentification activée ». « La double authentification vient d'être activée sur votre compte Facturation PME, et vos autres sessions ont été fermées. Si vous n'êtes pas à l'origine de ce changement, choisissez sans attendre un nouveau mot de passe depuis cette page : » ; lien `mot-de-passe-oublie` |
| `compte.double_auth_desactivee` | Désactivation | Sujet « Double authentification désactivée ». « ... vient d'être désactivée ... Votre compte n'est plus protégé que par votre mot de passe. Si vous n'êtes pas à l'origine ... » ; même lien |
| `compte.double_auth_remplacee` | Remplacement confirmé | Sujet « Application d'authentification remplacée ». Anciens codes de secours et ancienne application sans effet, autres sessions fermées ; même lien |
| `compte.codes_secours_regeneres` | Nouveaux codes | Sujet « Nouveaux codes de secours ». Les anciens ne servent plus ; même lien |
| `compte.code_secours_utilise` | Connexion par code de secours | Sujet « Code de secours utilisé ». « Un code de secours vient de servir à vous connecter ; il ne servira plus. Si vous avez perdu votre téléphone, remplacez l'application d'authentification depuis votre compte. Si ce n'est pas vous, ... » ; lien `mot-de-passe-oublie` |
| `compte.double_auth_tentatives` | Limite `auth.double_auth_compte` atteinte | Sujet « Codes de vérification refusés ». « De nombreux codes incorrects ont été saisis après le mot de passe de votre compte. Si ce n'est pas vous, quelqu'un connaît votre mot de passe : changez-le sans attendre depuis cette page : » ; lien ; « La connexion à votre compte reste suspendue 24 heures au plus. » |

**Liens** : pages fixes de `PAGES_LIEN` seulement (`mot-de-passe-oublie`, `connexion`), décision A de la 1.3 ; aucune page ajoutée à la liste.

**Limites d'envoi** : nouveau budget `email.double_auth`, 40 par 24 h, pour les six modèles (somme `email.compte` 100 + `email.reinitialisation` 50 + `email.double_auth` 40 = 190, sous `email.application` 200).

| Modèle | Limites vérifiées, dans cet ordre |
|---|---|
| Les quatre notifications de changement, `compte.code_secours_utilise` | `email.double_auth`, `email.application` (pas de limite par destinataire : chacune suit une preuve de mot de passe et de second facteur, bornée par `auth.double_auth_gestion` ou par les 10 codes ; une limite par destinataire ferait taire l'alerte, comme la décision par défaut 8 de la 1.3) |
| `compte.double_auth_tentatives` | `email.destinataire`, `email.destinataire_jour`, `email.double_auth`, `email.application` (déclenchable par qui a le mot de passe : bornée par destinataire) |

### 11. Les pages

#### 11.1 Adresses

| Adresse | Zone | Contenu |
|---|---|---|
| `/connexion` | `(public)` | Étape du code (section 4) dans le même formulaire, après la réponse `etape: "code"` |
| `/compte` | `(compte)` | Bloc « Double authentification » : « Activée » ou « Non activée », lien « Activer » ou « Gérer » vers la page suivante |
| `/compte/double-authentification` | `(compte)` | Activation (section 5.1) ; si active : codes restants, « Créer de nouveaux codes », « Remplacer l'application », « Désactiver » (masqué, et refusé par le serveur, pour un rôle exigeant). Appelle `lireComptePourPage`, qui rend désormais aussi `doubleAuthentification` |

Formulaires affichés après hydratation, `<noscript>` sinon (comme la 1.1). Interface selon `docs/DESIGN-SYSTEM.md` (compétence `interface`), textes dans `src/textes/compte.ts`, vérifiée à 390 et 1280 px ; la page rejoint le projet `mobile-390` (avec un compte connecté, comme `affichage-connecte`). Aucune métadonnée propre dans `(compte)/` (règle de la 1.2).

#### 11.2 Codes de secours à l'écran

Liste en police à chasse fixe, « Copier les codes » (presse-papiers, aucune requête), case « J'ai conservé mes codes » avant « Terminer ». Ni fichier téléchargé, ni impression proposée : un fichier traîne dans « Téléchargements ».

#### 11.3 Code QR (décision 1)

- **Retenu** : la matrice est calculée **sur le serveur**, dans la passerelle, par une bibliothèque sans dépendance (`uqr` 0.1.3, décision 1), importée seulement par `src/server/auth/qr.ts` (règle ESLint, comme `nodemailer`). Le navigateur ne reçoit que la matrice (section 3.4).
- **Tracé** par `src/components/compte/code-qr.tsx` : un `<svg>` dont chaque module noir est un rectangle d'un chemin `<path d="...">` construit par React, `viewBox` et marge de 4 modules ; ni `dangerouslySetInnerHTML`, ni attribut `style` (règles O et P), ni image distante. Texte de remplacement : « Code QR à scanner avec votre application d'authentification ».
- La clé s'affiche à côté pour la saisie à la main (et pour l'accessibilité).

### 12. Journal et « connexions sensibles » (S-70)

**Définition retenue** (report de la 1.2) : sont des connexions sensibles l'activation, le remplacement et la désactivation du second facteur, la création de nouveaux codes de secours, la connexion par un code de secours et le blocage par la limite des codes.

**Lieu** : aucun journal d'audit (il exige une organisation ; décision 7 de la 1.2). La trace remise est l'**email** à l'utilisateur (section 10) ; l'état se lit en base (`two_factor`, `user.two_factor_enabled`, `updated_at`). Journal technique : lignes fixes seulement. La 2.1 dira si une organisation reçoit une trace quand un de ses Propriétaires ou Comptables change de second facteur (« Reporté »). `SPEC.md` section 8, point 5, et `journal-audit.md` décision 5 sont mis à jour par la PR 1.

### 13. Contrôle après déploiement

`scripts/controle-deploiement.mjs` (production seulement, lancé par le workflow, jamais par l'assistant) :

- `comptes:*` passe de sept à **quatorze** `POST` sans corps ni `Origin` (contraintes d'`optionsRequete`), identiques au `POST` d'un chemin inexistant tant que les comptes sont fermés ;
- `auth:identique` gagne `POST /api/auth/two-factor/get-totp-uri`, `/two-factor/send-otp`, `/two-factor/verify-otp` ;
- `/compte/double-authentification` contrôlée comme `/compte` (sans session et avec un cookie forgé, identiques, sans texte du gabarit).

**Interaction avec la PR 2 de la 1.3 (#52)** : si la 1.4 est fusionnée avant, #52 doit passer les quatorze `POST` à `403 refuse` (et non sept) ; à reprendre dans #52 avant sa fusion.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Ouvrir les points de Better Auth tels quels | Corps avec le jeton de session, le secret et les codes en clair ; désactivation sans code ; régénération sans code (section 1) |
| Codes de secours chiffrés (défaut de Better Auth) | Réversibles avec `BETTER_AUTH_SECRET` ; `THREATS.md` 7.2 les veut hachés |
| Empreinte SHA-256 sans clé des codes | 49 bits : une copie de la base permettrait de les retrouver hors ligne en quelques jours de calcul |
| Codes mixtes `[a-zA-Z0-9]` (défaut) | Confusions `l`, `1`, `I`, `O`, `0` et casse à la ressaisie d'un code noté sur papier |
| Appareil de confiance (`trustDevice`) | Une connexion sans code pendant 30 jours sur un poste volé ; contraire à T-02 |
| Code par email (`otp`) | La boîte mail devient le second facteur (RR-3) ; budget Gmail (RR-10) |
| Récupération automatique par email | Même raison ; décision 2 |
| Remplacement par désactivation puis activation | Un moment sans second facteur ; impossible pour un Propriétaire (section 7.1) |
| Afficher les codes de secours dès l'étape du code QR | UC-04 les remet après la vérification du code ; un abandon les aurait montrés pour rien |
| Rendre l'adresse `otpauth://` au navigateur et tracer le QR dans le navigateur | La bibliothèque partirait dans le paquet du navigateur ; l'adresse complète n'y sert à rien |
| Compteur « un code par 3 minutes » sur `compteur_debit` | Compte aussi les codes faux, et ignore l'ordre des tranches ; la décision 4 demande la dernière tranche acceptée |
| Verrou de Better Auth seul (10 échecs, 15 min) | 960 codes par jour pour qui a le mot de passe (section 6) ; décision 3 |
| Garder les autres sessions à l'activation | Une session ouverte par un voleur de mot de passe resterait sans second facteur |
| Révoquer l'ancienne session dès l'étape 1 de la connexion | Un code faux ou abandonné déconnecterait |
| Distinguer connexion et activation par la présence d'une session sur un seul chemin `verify-totp` | Confusion de comptes dans un navigateur connecté (section 2.1) ; deux chemins explicites, chacun son cookie |
| Renvoyer vers l'activation (UC-02 4a) dès la 1.4 | Aucune organisation n'existe avant la 2.1, qui choisit la page d'arrivée |

## Règles de sécurité et permissions

- **F-003, UC-04** : activation par code temporaire, dix codes de secours à usage unique remis une fois (section 5).
- **S-12, S-13, T-02** : PR 2, étape 7 de la chaîne ; désactivation impossible pour un rôle exigeant (sections 7.3, 9).
- **T-06** : 5 essais par connexion en attente, verrou, 20 codes par jour et par compte, code déjà accepté refusé (dernière tranche), code de secours consommé atomiquement (sections 1, 6).
- **T-04** : la réinitialisation ne touche pas au second facteur (section 4).
- **T-01, T-07** : connexion inchangée à l'étape 1 ; la réponse `etape: "code"` ne vient qu'après le bon mot de passe.
- **T-03, S-17** : aucune session avant le code ; autres sessions fermées après un changement du second facteur ; ancienne session du navigateur révoquée après le code (section 8).
- **S-15, S-54, T-39** : secret chiffré, codes et identifiant d'attente sous empreinte ; rien de secret au journal (section 3).
- **S-82** : jetons et secrets jamais dans un corps sauf la remise unique de la section 3.4 ; cookie `two_factor` `HttpOnly`, `SameSite=Lax`, `Secure` en `https`, 5 minutes.
- **S-81** : `verifierOrigine` sur les sept nouveaux `POST`.
- **S-85** : identifiant d'incident sur toute réponse `erreur`.
- **S-87** : réponse de Better Auth vérifiée avant transmission (section 3.4).
- **T-55** : quatorze points ouverts, `get-totp-uri`, `send-otp`, `verify-otp` fermés ; test d'inventaire ; contrôle après déploiement.
- **T-65** : liens d'email vers les pages fixes existantes seulement.
- **Matrice des droits** : aucune ligne. Aucune action `declarerAction` (portée compte, sans organisation).
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3) : « sans session » : la gestion sans session ou avec un cookie forgé reçoit `connexion_requise`, Better Auth jamais appelé ; la page « introuvable ». « Autre organisation » devient « autre compte » : une session de A ne vérifie jamais un code de B (séparation des cookies), et `aRoleExigeantDoubleAuth` ne lit que les adhésions de l'utilisateur de la session. « Rôle insuffisant » : désactivation refusée au Propriétaire et au Comptable ; PR 2, chaque rôle sur l'étape 7. « Entrée falsifiée » : `trustDevice`, `disableSession`, `method`, `issuer`, champ inconnu, code hors forme.
- **Tables** : aucune créée ni modifiée. `two_factor`, `user`, `session`, `verification`, `member` sont des tables de Better Auth (RR-8) ; les écritures nouvelles (`preparerRemplacement`, `revoquerAutresSessions`) et lectures (`compterCodesSecours`, `aRoleExigeantDoubleAuth`, `adresseUtilisateur`) filtrent sur l'utilisateur de la session.

## Dépendances nouvelles

**`uqr` 0.1.3**, acceptée sous conditions par le développeur (décision 1), vérifiées le 2026-10-18 par `npm view uqr` (lecture seule) : licence MIT ; aucune dépendance ; aucun script `preinstall`, `install` ni `postinstall` (seuls `build`, `dev`, `lint`, `release`, `play`, `test`, `typecheck`) ; dépôt `github.com/unjs/uqr` (organisation unjs) ; mainteneurs `pi0` et `antfu` ; 0.1.3 publiée le 2026-04-03, plus de 14 jours avant. Installée à la version exacte (`"uqr": "0.1.3"`, sans `^`) ; `package-lock.json` ne gagne que ses deux entrées (le npm 11.8 du poste retirait au passage des champs `libc` de quatre paquets natifs : rétablis). Inscrite dans `docs/STACK.md`.

- **Une seule importation**, `src/server/auth/qr.ts` (`import { encode } from "uqr"`), côté serveur ; règle ESLint `V` (`no-restricted-imports` partout ailleurs, `src/components/` et `src/app/` compris), avec son test dans `regles-import.test.ts`.
- Jamais `npm audit fix`. Aucune bibliothèque TOTP : le calcul des codes dans les tests passe par `node:crypto` (HMAC-SHA-1, RFC 6238) ou par `generateTOTP` de Better Auth (appel serveur).

## Migration

Aucune. `two_factor` porte déjà `secret`, `backup_codes`, `user_id`, `verified`, `failed_verification_count`, `locked_until`, et `user` porte `two_factor_enabled` (migrations appliquées, `src/server/db/schema/auth.ts`). Les empreintes changent des valeurs de texte, pas des formes. Le dossier `drizzle/` n'est pas touché. Si l'implémentation révèle un besoin de colonne (par exemple une date de création de `two_factor` pour purger les activations abandonnées), le travail s'arrête et le développeur décide.

## Découpage en PR

1. **PR 1, double authentification du compte** (branche `feat/1.4-double-authentification`) : sections 1 à 8 et 10 à 13. Fermée en production comme le reste des comptes (`COMPTES_OUVERTS_EN_PRODUCTION`) ; aucune variable de Vercel. Essai recommandé sur la prévisualisation avec une vraie application d'authentification (section « Vérifications manuelles »).
2. **PR 2, exigence par rôle** (branche `feat/1.4-exigence-par-role`) : section 9. Petite : `SessionLue`, étape 7, `ROLES_DOUBLE_AUTH`, test de T-02, documents de la chaîne. Elle reprend aussi le report de la PR 1 : le journal du site construit (tests 32 et 33).

## Critères d'acceptation

### PR 1

- [ ] Les seuls points d'entrée ouverts de `/api/auth` sont les quatorze de la section 2 ; `get-totp-uri`, `send-otp`, `verify-otp` et tout autre `/two-factor/*` répondent comme une adresse inexistante, Better Auth jamais appelé.
- [ ] En production, les quatorze `POST` répondent comme un chemin inexistant, octet pour octet.
- [ ] Activation complète : code QR et clé affichés, code juste accepté, `two_factor_enabled` vrai, dix codes affichés une fois après le code ; code faux : rien d'activé.
- [ ] En base : ni le secret en clair, ni sa forme base32, ni un code de secours, ni l'identifiant du cookie `two_factor` ; les codes sont des empreintes `cs1:`, l'attente des lignes `double-auth:`.
- [ ] Connexion d'un compte à second facteur : aucune session avant le code ; réponse `etape: "code"` avec le seul cookie `two_factor` (`HttpOnly`, `SameSite=Lax`, `Max-Age` 300) ; code juste : session et `/compte` ; aucun corps ne contient de jeton.
- [ ] Code faux : `code_incorrect` ; au sixième essai d'une même attente, `connexion_expiree` ; un code juste déjà utilisé dans les 3 minutes : `code_incorrect` ; le 21e code en 24 h sur un compte, depuis des adresses IP différentes : `trop_de_requetes` et l'email `compte.double_auth_tentatives`.
- [ ] Code de secours : accepté une fois, refusé ensuite ; deux usages simultanés du même code : un seul réussit ; notification envoyée.
- [ ] Un navigateur connecté au compte A ne fait jamais vérifier le code d'une connexion en attente du compte B sur la session de A, et inversement.
- [ ] `trustDevice`, `disableSession`, `method`, `issuer`, un champ inconnu, un code hors forme, sans `Origin` ou d'une autre origine : refusés, Better Auth et les limites jamais appelés.
- [ ] Gestion sans session ou avec un cookie forgé : `connexion_requise` ; mauvais mot de passe : `mot_de_passe_incorrect`, aucun code de secours consommé ; code faux : `code_incorrect`, aucune opération faite.
- [ ] Nouveaux codes : exigent mot de passe et code ; les anciens refusés ensuite.
- [ ] Remplacement : `two_factor_enabled` reste vrai du début à la fin ; anciens codes et ancienne application refusés dès l'étape 3 ; nouvelle application acceptée après confirmation.
- [ ] Désactivation : exige mot de passe et code ; refusée à un Propriétaire et à un Comptable (`double_authentification_obligatoire`), acceptée à un Commercial, un Lecteur et un utilisateur sans organisation.
- [ ] Activation, remplacement, désactivation : toutes les autres sessions du compte supprimées, la courante valable ; nouveaux codes : aucune session touchée.
- [ ] Après une réinitialisation du mot de passe, la connexion demande toujours le code (T-04).
- [ ] Les six emails partent avec leurs textes et limites (section 10) ; aucun ne contient de code, de clé ni de jeton.
- [ ] Journal du serveur, Vitest et site construit : aucune valeur de la section 3.5.
- [ ] Contrôle après déploiement : quatorze `POST`, chemins fermés, nouvelle page ; en local, seuls les `comptes:*` échouent.
- [ ] `/compte/double-authentification` vérifiée à 390 et 1280 px ; captures jointes.
- [ ] Procédure de remise à zéro écrite dans `docs/exploitation/remise-a-zero-double-authentification.md` (requêtes exactes, emails, trace d'audit) ; éprouvée sur `dev` par le développeur.
- [ ] Un code de l'application accepté une fois est refusé ensuite pour ce compte, de même qu'un code d'une tranche plus ancienne ; deux usages simultanés du même code : un seul réussit.
- [ ] `uqr` n'est importée que par `src/server/auth/qr.ts` (règle ESLint et son test).
- [ ] `npm run verifier` et `npm run test:integration` verts, sorties montrées.

### PR 2

- [ ] Propriétaire et Comptable sans second facteur : `refuse` sur toute action et page « introuvable » sur toute page de `(app)/`, quelle que soit l'entrée ; acceptés après activation ; Commercial et Lecteur non concernés.
- [ ] Promotion en Comptable d'un membre sans second facteur, ou second facteur retiré en base : refus dès la requête suivante.
- [ ] Le refus de l'étape 7 précède la validation de l'entrée (une entrée invalide reçoit `refuse`, pas `invalide`).
- [ ] Report de la PR 1 : passage complet sur le site construit (activation, connexion par code et par code de secours, nouveaux codes, désactivation) sans aucune valeur de la section 3.5 dans la sortie du serveur ; serveur en panne à l'étape du code : texte fixe et incident affichés, ligne `[auth]` fixe portant cet incident, sans le code.
- [ ] `npm run verifier` et `npm run test:integration` verts, sorties montrées.

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code. Les numéros 1 à 27 relèvent de la PR 1, 28 à 33 de la PR 2 (32 et 33 : report de la PR 1).

### Tests d'attaque, puis unitaires (PR 1)

1. [ ] **T-55, liste fermée** — `src/server/auth/points-entree.attaque.test.ts` : inventaire à quatorze points ; `POST /two-factor/get-totp-uri`, `/two-factor/send-otp`, `/two-factor/verify-otp`, `GET` de chaque point ouvert, tout autre `/two-factor/*` déclaré par l'instance : `reponseInexistante()` octet pour octet, Better Auth jamais appelé.
2. [ ] **Comptes fermés en production** — même fichier : avec `estProduction` vrai, les quatorze `POST` reçoivent `reponseInexistante()` ; témoin hors production.
3. [ ] **S-81 et entrée falsifiée** — même fichier, sept nouveaux `POST` : `Origin` absente, étrangère, `null`, `Sec-Fetch-Site: cross-site` ; `trustDevice`, `disableSession`, `method: "otp"`, `issuer`, `password`, champ inconnu, code de 5 ou 7 chiffres, lettres dans un code TOTP, code de secours de 9 ou 11 caractères ou hors alphabet, données dans l'adresse, corps de 4 Kio + 1, autre type que JSON. Refus ; Better Auth, limites, `utilisateurDuDefi`, `motDePasseValide` jamais appelés.
4. [ ] **Séparation des cookies** — même fichier, Better Auth simulé qui capture la requête : connexion par code ou code de secours : seul `two_factor` transmis (ni `session_token`, ni `trust_device`, ni `dont_remember`, ni autre cookie) ; gestion : seul le cookie de session ; `/sign-in/email` : aucun cookie, même avec `trust_device` reçu.
5. [ ] **S-82, corps jamais transmis** — même fichier : `200 { token, user }` → `{ ok: true }` et les seuls cookies attendus ; `twoFactorRedirect` → `{ ok: true, etape: "code" }`, seul `two_factor` transmis (effacement du cookie de session retiré) ; `enable` → exactement `{ ok, qr, cle, codes }`, sans `totpURI` ; réponse hors forme (9 codes, code mal formé, `totpURI` absent ou d'un autre schéma) → `erreur` avec incident.
6. [ ] **Traductions** — `points-entree.test.ts` : `INVALID_CODE`, `INVALID_BACKUP_CODE`, `409`, `TOTP_NOT_ENABLED` à la connexion → `code_incorrect` ; `INVALID_TWO_FACTOR_COOKIE`, `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` → `connexion_expiree` ; `ACCOUNT_TEMPORARILY_LOCKED`, `429` → `trop_de_requetes` ; `INVALID_PASSWORD` → `mot_de_passe_incorrect` ; `5xx`, `TOTP_ALREADY_ENABLED`, code inconnu → `erreur`.
7. [ ] **Ordre de la connexion** — même fichier : attente inconnue → `connexion_expiree`, rien d'autre appelé ; limite par compte avant l'anti-rejeu, l'anti-rejeu avant Better Auth ; limite refusée → `trop_de_requetes` et alerte planifiée, Better Auth jamais appelé ; tranche refusée → `code_incorrect`, Better Auth jamais appelé ; code faux (aucune tranche) → Better Auth appelé, rien réservé ; code de secours : aucune tranche calculée, l'empreinte (jamais le code) envoyée à Better Auth.
8. [ ] **Ordre de la gestion** — même fichier : sans session → `connexion_requise` ; limite de gestion avant tout ; désactivation par un rôle exigeant → `double_authentification_obligatoire`, mot de passe jamais vérifié ; mauvais mot de passe → code jamais vérifié ; code faux → opération jamais appelée ; remplacement : `preparerRemplacement` appelé seulement après mot de passe et code justes, puis `enable`.
9. [ ] **Après le succès** — même fichier : connexion à second facteur : `revoquerSession` jamais appelé à l'étape 1, appelé après un code juste, jamais après un code faux ; activation, remplacement, désactivation : `revoquerAutresSessions` avec le jeton de la nouvelle session (ou du cookie reçu) ; nouveaux codes : jamais ; échec de la révocation : `erreur`, aucun cookie ; emails planifiés selon la section 10.
10. [ ] **Limites** — `limites.test.ts` : sept limites `auth.double_auth*` et `email.double_auth` présentes, sous 24 h ; aucune règle partagée entre deux limites `auth.*` ; `reglesBetterAuth()` couvre exactement les chemins internes appelés ; somme des budgets d'emails de compte sous `email.application` .
11. [ ] **Codes de secours** — `src/server/auth/codes-secours.test.ts` : 10 codes, 10 caractères de l'alphabet, forme `xxxxx-xxxxx`, tous différents, tirés par `randomInt` (simulé : répartition sur tout l'alphabet) ; normalisation (espaces, tirets, majuscules) ; refus hors alphabet ; empreinte `cs1:`, stable, sans le code, différente pour deux codes et pour deux secrets ; `encrypt` idempotent sur une liste d'empreintes, hache une liste de codes, lève sur une liste mêlée d'autre chose ; `decrypt` identité.
12. [ ] **Empreinte de l'attente** — `src/server/auth/double-authentification.test.ts` : `2fa-<id>` et `2fa-attempts-2fa-<id>` donnent `double-auth:<...>`, sans l'identifiant, stables, différents ; lecture de l'identifiant dans le cookie `two_factor` (signé, encodé, avec `__Secure-`) ; cookie absent ou mal formé : `null`.
13. [ ] **Code QR et clé** — `src/server/auth/qr.test.ts` : matrice carrée de 0 et 1 pour une adresse `otpauth://` type, déterministe ; clé lue dans `secret`, groupée par 4 ; adresse d'un autre schéma ou sans `secret` : lève. `src/components/compte/code-qr.test.tsx` : un `<svg>` avec `viewBox`, un `<path>`, texte de remplacement, aucun attribut `style`.
14. [ ] **Configuration** — `config.test.ts`, ajouts : `twoFactor` avec `issuer` « Facturation PME », `twoFactorCookieMaxAge` 300, `backupCodeOptions` (`customBackupCodesGenerate`, `storeBackupCodes` à nos deux fonctions, 10 codes), ni `otpOptions`, ni `skipVerificationOnEnable`, ni `allowPasswordless`, `accountLockout` absent (défauts : actif, 10, 900 s) ; `verification.storeIdentifier` : deux surcharges exactement, `reset-password:` et `2fa-`.
15. [ ] **Comportement de la version installée** — `src/server/auth/double-authentification-better-auth.test.ts`, vraie version sur l'adaptateur en mémoire (comme le test 13 de la 1.3) : connexion d'un compte à second facteur : aucune session gardée, lignes d'attente sous empreinte ; `enable` : secret chiffré (ni la chaîne, ni sa forme base32 dans la ligne), codes stockés sous empreinte seulement ; 5 essais par attente puis `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` ; verrou après 10 échecs ; fenêtre de ±1 pas ; code de secours retiré de la liste après usage ; `TOTP_ALREADY_ENABLED` sur une ligne vérifiée, remplacement accepté sur une ligne marquée non vérifiée ; `createSession` d'une rotation donne une échéance neuve. Une mise à jour qui change l'un de ces points fait échouer la suite.
16. [ ] **Emails** — `emails.test.ts` et `modeles.test.ts` : six modèles, textes, aucun paramètre, liens `mot-de-passe-oublie` (et `connexion`) seulement, sur l'origine de la configuration ; ordre des limites de la section 10, limites par destinataire pour `compte.double_auth_tentatives` seulement ; une limite atteinte écrit une ligne `[email]` qui la nomme ; aucun code, aucune clé.
17. [ ] **Journal** — `journal.attaque.test.ts`, ajout : passage complet simulé avec capture de la console : aucune des valeurs de la section 3.5.
18. [ ] **Pages et client** — `inventaire.test.ts` : `(compte)/compte/double-authentification/page.tsx` appelle `lireComptePourPage`, sans métadonnée ; `exposer.test.ts` : `lireComptePourPage` rend `doubleAuthentification` ; `appel-auth.test.ts` : les cinq raisons reconnues, `etape: "code"` lue, `qr`, `cle`, `codes` lus seulement à la bonne forme.

### Tests d'intégration, avec base (PR 1)

19. [ ] `src/server/db/double-authentification.integration.test.ts` (par `traiterRequeteAuth`, vraie instance, transport `memoire`, planificateur synchrone, codes calculés par le test depuis la clé reçue) : activation complète ; ligne vérifiée ; ni secret ni code en clair dans `two_factor`, `verification` ou `compteur_debit` (recherche des chaînes) ; deux autres sessions ouvertes avant l'activation supprimées, la courante valable ; email.
20. [ ] Même fichier, **connexion** : étape 1 sans session en base ; code juste : session ; code faux cinq fois puis juste : `connexion_expiree` ; même code juste deux fois en deux connexions : la seconde refusée (anti-rejeu), et un code de la tranche précédente après un code accepté aussi ; deux connexions simultanées avec le même code juste : une seule session ; code de secours une fois puis refusé ; **concurrence** : deux `verify-backup-code` simultanés avec le même code, sur deux attentes du même compte : une seule session créée.
21. [ ] Même fichier, **limite par compte** : 20 essais sur un compte depuis 20 adresses IP, le 21e refusé avec le bon code ; email d'alerte ; `compteur_debit` sans valeur en clair. Nettoyage des clés et des comptes.
22. [ ] Même fichier, **gestion** : nouveaux codes (anciens refusés) ; remplacement (`two_factor_enabled` vrai à chaque étape, ancien secret refusé dès l'étape 3, nouvelle application acceptée) ; désactivation (ligne supprimée, autres sessions supprimées) ; mauvais mot de passe : code de secours toujours valable ensuite.
23. [ ] Même fichier, **rôle exigeant** (deux organisations, `creerDeuxOrganisations` et `creerMembre`) : Propriétaire de A, Comptable de B : désactivation refusée ; Commercial : acceptée ; `aRoleExigeantDoubleAuth` ne lit que les lignes de l'utilisateur (un autre membre Propriétaire de A ne change rien pour un Lecteur de A).
24. [ ] `src/server/db/reinitialisation.integration.test.ts`, ajout (report de la 1.3, **T-04**) : compte à second facteur, réinitialisation réussie, puis connexion : `etape: "code"`, aucune session sans code.
25. [ ] `src/server/db/sessions.integration.test.ts` et `comptes.integration.test.ts` : `revoquerAutresSessions` ne supprime que les autres sessions de l'utilisateur visé ; `compterCodesSecours`, `preparerRemplacement`, `adresseUtilisateur` sur l'utilisateur visé seulement ; la purge `jetons_expires` supprime les lignes d'attente expirées.

### Tests de bout en bout (PR 1)

26. [ ] **Parcours du jalon 1** (`PLAN.md` 4.6) — `e2e/double-authentification.spec.ts` (ordinateur-1280 et mobile-390) : inscription et vérification (outils de la 1.1) ; `/compte`, « Activer » ; mot de passe ; code QR et clé visibles ; code calculé par le test depuis la clé lue à l'écran ; codes de secours affichés après le code seulement ; déconnexion ; connexion : étape du code, aucun cookie de session avant le code, cookie `two_factor` `HttpOnly`, `SameSite=Lax`, `Max-Age` 300 ; code juste : `/compte` ; nouvelle connexion avec un code de secours ; ce code refusé à la connexion suivante ; aucune requête du navigateur ne porte un code ou une clé dans son adresse ; aucun corps de réponse ne contient `token` ni `otpauth`. Emails lus dans le dossier du transport `fichier`.
27. [ ] **T-06 et T-55 sur le site construit** — `e2e/auth.attaque.spec.ts` : cinq codes faux puis le bon sur une même attente : `connexion_expiree` ; code rejoué : refusé ; `POST /api/auth/two-factor/get-totp-uri` avec une session valide : identique à `/api/auth/n-existe-pas`. `e2e/controle-deploiement.spec.ts` : quatorze `POST`, chemins fermés, nouvelle page. `e2e/erreurs.attaque.spec.ts` : serveur en panne, l'étape du code affiche l'incident ; journal sans code ni clé. `e2e/affichage-connecte.spec.ts` : `/compte/double-authentification` à 1280, 390 et 360 px, cibles de 44 px, focus, captures.

### Tests de la PR 2

28. [ ] **T-02, étape 7** — `src/server/actions/action.test.ts` : pour chaque rôle et une session sans second facteur : Propriétaire et Comptable reçoivent `refuse` sur une action et sur `etablirContexte`, avant la validation (entrée invalide : `refuse`) et sans appel au service ; Commercial et Lecteur passent ; avec second facteur, les quatre passent.
29. [ ] `src/server/db/chaine.attaque.integration.test.ts`, ajout : Propriétaire réel sans second facteur : refusé, transaction annulée, rien écrit ; `two_factor_enabled` passé à vrai en base : accepté à la requête suivante ; repassé à faux : refusé ; Commercial promu Comptable en base : refusé à la requête suivante (S-13).
30. [ ] `src/server/auth/session.test.ts` : `doubleAuthentification` vrai seulement si `twoFactorEnabled === true`.
31. [ ] `e2e/zones.attaque.spec.ts` (outil `e2e/organisation-e2e.ts`) : Propriétaire sans second facteur, `/tableau-de-bord` : même document que sans session ; après activation : le gabarit s'affiche.
32. [ ] **Report de la PR 1, test 17 sur le site construit** — `e2e/double-authentification.spec.ts` : passage complet (activation, connexion par code, par code de secours, nouveaux codes, désactivation), puis lecture de la sortie du serveur (`JOURNAL_SITE_E2E`) : ni la clé (groupée ou non), ni un code envoyé, ni un code de secours (anciens et nouveaux), ni l'adresse, ni `otpauth`, ni la valeur d'un cookie de session ou d'attente ; chaque ligne `[auth]` a la forme fixe.
33. [ ] **Report de la PR 1, serveur en panne à l'étape du code** — `e2e/erreurs.attaque.spec.ts` : sur le second serveur, l'étape du code atteinte (réponse de `/sign-in/email` simulée dans le navigateur, cookie d'attente au format signé), code envoyé : `500`, texte fixe et incident affichés, ligne `[auth]` fixe portant cet incident dans `JOURNAL_PANNE_E2E`, sans le code ni l'identifiant d'attente.

### Vérifications manuelles (développeur)

- [ ] **Preuve regroupée des PR 1 et 2**, sur la prévisualisation de la PR 2, adresse propre du déploiement (section 2.4 de la 1.1), avec une vraie application d'authentification : plan pas à pas dans la description de la PR 2 (activation en scannant le code QR ; connexion par code ; par code de secours ; nouveaux codes ; remplacement sur une seconde application ; désactivation ; refus de la désactivation et de `/tableau-de-bord` pour un Propriétaire). Emails reçus, au plus 3 par heure et par boîte (`email.destinataire`), sur deux boîtes. Journaux du déploiement sans code, clé ni adresse.

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `src/server/auth/points-entree.ts` | Sept points, `etape: "code"`, cookies par usage, réponses de la section 3.4, cinq raisons, révocation déplacée |
| `src/server/auth/double-authentification.ts` | Nouveau : empreinte de l'attente, lecture du cookie `two_factor`, lecture et vérification des réponses, opérations composées |
| `src/server/auth/codes-secours.ts`, `src/server/auth/qr.ts` | Nouveaux |
| `src/server/auth/gestionnaire.ts` | Liaisons : `utilisateurDuDefi`, `motDePasseValide`, limites, `revoquerAutresSessions`, `preparerRemplacement`, `aRoleExigeantDoubleAuth`, notifications |
| `src/server/auth/config.ts` | Options de `twoFactor`, surcharge `2fa-` |
| `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | Six modèles, budget |
| `src/server/auth/session.ts`, `src/server/actions/action.ts`, `src/server/actions/exposer.ts` | `doubleAuthentification` (PR 1 pour `lireComptePourPage`, PR 2 pour l'étape 7) |
| `src/server/autorisation/matrice.ts` | `ROLES_DOUBLE_AUTH` |
| `src/server/db/sessions.ts`, `src/server/db/double-authentification.ts` | Nouveaux : `revoquerAutresSessions`, `compterCodesSecours`, `preparerRemplacement`, `aRoleExigeantDoubleAuth`, `adresseUtilisateur` |
| `src/server/debit/limites.ts`, `src/server/debit/better-auth.ts` | Sept limites `auth.double_auth*` et `email.double_auth`, règles des chemins internes |
| `src/schemas/double-authentification.ts` | Nouveau |
| `src/app/(public)/connexion/`, `src/app/(compte)/compte/page.tsx`, `src/app/(compte)/compte/double-authentification/page.tsx`, `src/components/compte/*`, `src/textes/compte.ts` | Étape du code, bloc d'état, page d'activation et de gestion, `code-qr.tsx` |
| `eslint.config.mjs` | Bibliothèque de QR importable seulement par `src/server/auth/qr.ts` (écrite par script, piège des barres inverses de `CLAUDE.md`) |
| `package.json`, `package-lock.json`, `docs/STACK.md` | `uqr` 0.1.3 (décision 1) |
| `src/server/auth/tranche-totp.ts` | Nouveau : calcul de la tranche d'un code (décision 4) |
| `src/server/journal/actions.ts` | Action `membre.double_auth_remise_a_zero` (décision 2) |
| `docs/exploitation/remise-a-zero-double-authentification.md` | Nouveau : procédure (décision 2) |
| `src/server/actions/inventaire.test.ts`, tests listés ci-dessus | |
| `e2e/*.spec.ts`, `e2e/outils.ts` (calcul TOTP par `node:crypto`), `playwright.config.ts` | |
| `scripts/controle-deploiement.mjs` | Quatorze `POST`, chemins fermés, nouvelle page |
| `CLAUDE.md` (ligne du contrôle, règle d'import de la bibliothèque), `docs/THREATS.md` (T-02, T-06, 7.2, RR-14, 10), `docs/SPEC.md` (section 8, point 5), `docs/DESIGN.md` (3.1, 3.2 étape 7), `docs/STRUCTURE.md`, `docs/PLAN.md`, `docs/CONFIGURATION.md` (procédure de récupération, rotation de `BETTER_AUTH_SECRET`), `docs/features/chaine-controles.md` (étape 7), `docs/features/connexion.md` et `mot-de-passe.md` (reports clos), `docs/features/journal-audit.md` (décision 5), `docs/features/controle-deploiement.md` | Documents |

## Reporté

- **2.1** : UC-02 4a, renvoi vers l'activation d'un Propriétaire ou d'un Comptable sans second facteur, à l'arrivée sur une organisation ; trace éventuelle, au journal d'audit d'une organisation, du changement de second facteur de l'un de ses Propriétaires ou Comptables.
- **2.2** : S-12, seconde phrase : un Propriétaire impose la double authentification à toute son organisation (réglage de l'organisation, lu par l'étape 7).
- **2.4** : S-13 côté interface : à la promotion d'un membre, l'avertir que ses nouveaux droits attendent l'activation (UC-10 4a). Le refus, lui, est livré par la PR 2.
- **1.5** : affichage des sessions ; les fermetures de la section 8.2 y deviennent visibles. **Traité** par `docs/features/profil-sessions.md`, section 3.5.
- **1.6** : nouvelle authentification avant une action sensible ; le code du second facteur pourra en faire partie.
- **8.1** : signalement au service de suivi des lignes `[email] ... "limite"` de `email.double_auth` et des blocages `auth.double_auth_compte`.

## Limites connues

- **Base et `BETTER_AUTH_SECRET` ensemble** donnent tous les secrets TOTP (chiffrement réversible, nécessaire au calcul des codes) et permettent d'essayer les codes de secours hors ligne. Chacun seul ne donne rien.
- **Changer `BETTER_AUTH_SECRET`** rend illisibles tous les secrets et toutes les empreintes de codes : chaque utilisateur devrait réactiver son second facteur. Better Auth accepte des secrets versionnés pour le chiffrement (enveloppe `$ba$<version>$`), pas nos empreintes HMAC ; à traiter par une fiche si une rotation devient nécessaire (noté dans `CONFIGURATION.md`).
- **Blocage par qui a le mot de passe** (RR-14, décision 3) : 20 codes faux bloquent la connexion du compte 24 heures au plus, même avec le bon code ; le titulaire reçoit l'alerte et change son mot de passe, ce qui arrête l'attaquant à l'étape 1.
- **Phishing en temps réel** : un site qui relaie mot de passe et code dans les 90 secondes ouvre une session ; l'anti-rejeu ne l'empêche pas (seul un facteur lié à l'origine, clé de sécurité, le ferait). Hors du périmètre de F-003.
- **Activation abandonnée** : la ligne non vérifiée garde un secret chiffré jusqu'à la prochaine activation ou la suppression du compte ; aucune purge par âge sans colonne de date.
- **Révocation en échec après un changement** : le changement est fait, les autres sessions vivent ; la réponse est `erreur` ; une nouvelle opération ou la 1.5 les ferme.
- **Rotation de session** : l'activation et la désactivation ouvrent une session de 7 jours à partir de là (section 8.2).
- **Tranche réservée avant Better Auth** : un code juste refusé par Better Auth (verrou, bord de tranche, panne) est perdu ; le suivant arrive dans 30 secondes au plus (section 6.1).
- **Remise à zéro manuelle** : elle écrit au journal d'audit hors de `journaliser` (section 7.2) ; un utilisateur sans organisation n'y laisse aucune trace d'audit.
- **Lecture de l'attente hors de la limite par adresse IP** : un cookie `two_factor` forgé fait lire une ligne de `verification` avant toute limite (comme le jeton de la 1.3) ; la ligne n'existe pas, la réponse est `connexion_expiree`.
- **Téléphone et codes perdus** : récupération manuelle seulement, avec délai de 72 heures (décision 2).

## Décisions

Prises par le développeur le 2026-10-18.

1. **`uqr` acceptée sous conditions**, toutes vérifiées par `npm view uqr` (« Dépendances nouvelles ») : version exacte 0.1.3, une seule importation côté serveur, verrouillée par une règle ESLint et son test, inscrite dans `docs/STACK.md`.
2. **Récupération manuelle** (section 7.2) : demande venant de l'adresse du compte, délai de 72 heures, email au titulaire à la demande et à la remise à zéro, toutes les sessions fermées, trace dans `journal_audit` ; procédure pas à pas, requêtes SQL exactes, dans `docs/exploitation/`.
3. **Plafond de 20 codes par 24 heures**, alerte au titulaire, et **RR-14** acceptés (section 6).
4. **Anti-rejeu** : un code déjà accepté pour un compte est refusé, par la dernière tranche de temps acceptée (section 6.1). Sans migration : la ligne vit dans `verification`.
5. **Décision D de la 1.3** ajoutée à `docs/features/mot-de-passe.md`.

## Décisions par défaut

Appliquées par l'assistant le 2026-10-18, selon sa recommandation, sauf avis contraire du relecteur.

1. **Sept points publics**, dont deux composés par la passerelle (`confirm-enable`, `replace`) ; `get-totp-uri`, `send-otp`, `verify-otp` toujours fermés (section 2).
2. **Un cookie par usage** : `two_factor` seul pour la connexion, session seule pour la gestion ; jamais `trust_device` (section 2.1).
3. **Réponse `etape: "code"`** à la connexion d'un compte à second facteur, seul `two_factor` transmis (section 2.2).
4. **Codes de secours** : 10 codes de 10 caractères minuscules sans confusion, sous empreinte HMAC à clé dérivée, branchés par `storeBackupCodes` (section 3.2).
5. **Identifiant d'attente sous empreinte**, préfixe `double-auth:` (section 3.3).
6. **Matrice QR calculée sur le serveur**, tracée en SVG par React ; clé affichée à côté (sections 3.4, 11.3).
7. **Codes de secours affichés après le code**, une seule fois ; ni fichier ni impression (sections 5.1, 11.2).
8. **Mot de passe et code** exigés pour les nouveaux codes, le remplacement et la désactivation ; mot de passe vérifié avant le code (sections 2.1, 5).
9. **Remplacement sans désactivation**, `two_factor_enabled` toujours vrai (section 7.1).
10. **Désactivation refusée** à quiconque est Propriétaire ou Comptable dans une organisation, dès la PR 1 (section 7.3).
11. **Attente de 5 minutes**, aucun appareil de confiance (section 4).
12. **Limites** de la section 6 : par adresse IP sur chaque chemin interne, 20 codes par jour et par compte (décision 3), dernière tranche acceptée (décision 4), 10 opérations de gestion par heure ; verrou et 5 essais de Better Auth gardés.
13. **Autres sessions fermées** à l'activation, au remplacement et à la désactivation ; révocation de l'ancienne session du navigateur déplacée après le code ; échéance neuve de la rotation acceptée (section 8).
14. **Six emails**, budget `email.double_auth` de 40 par 24 h ; limites par destinataire pour l'alerte seulement (section 10).
15. **« Connexions sensibles »** définies (section 12), tracées par email, sans journal d'audit.
16. **UC-02 4a et S-12 seconde phrase** reportés à la 2.1 et à la 2.2 (section 9).
17. **Deux PR** : le compte, puis l'exigence par rôle (« Découpage en PR »).
18. **Aucune migration** ; arrêt si un besoin apparaît (« Migration »).

## Notes de l'implémentation

### PR 1, les 2026-10-18 et 2026-10-19

Branche `feat/1.4-double-authentification` : commits `docs(1.4): fiche`, `docs(1.4): décisions`, `test(1.4)` (phase rouge), `feat(1.4)`.

**Dépendance** : `uqr` 0.1.3, vérifiée par `npm view uqr` avant l'installation (décision 1, « Dépendances nouvelles »). Le npm 11.8 du poste retirait au passage les champs `libc` de quatre paquets natifs de `package-lock.json` : rétablis, le fichier ne gagne que les deux entrées de `uqr`.

**Phase rouge** (commit `test(1.4)`). Unitaires : 192 tests en échec dans 18 fichiers, dont 7 non chargés (modules `tranche-totp`, `codes-secours`, `qr`, `double-authentification`, `code-qr` absents ; `config.test.ts`, `better-auth.test.ts` et le test de la version installée les importent). Chaque échec tient à l'absence du code : points `/two-factor/*` inconnus (404 au lieu des réponses attendues), modèles, limites, action d'audit, règle ESLint V, page absente. Intégration (sur `dev`) : 1 fichier non chargé (`tranche-totp` absent). Bout en bout (site construit avant le code, tests remisés le temps de la construction, base jetable) : 16 échecs, 444 réussis (parcours de la double authentification et affichage de sa page, contrôle après déploiement sans les nouveaux contrôles).

**Passaient avant le code, et pourquoi** : les sept points fermés en production et en `GET` (inconnus, donc déjà la réponse inexistante : garde de non-régression, avec un témoin hors production qui échouait) ; `/sign-in/email` ne transmet aucun cookie (comportement de la 1.2) ; `twoFactorRedirect` sans cookie d'attente reste une erreur ; `qr.ts` autorisé à importer `uqr` (aucune règle encore) ; aucune limite de rejeu (absence voulue, décision 4) ; `GET` des quatorze points et `get-totp-uri` fermés de bout en bout (inconnus avant le code).

**Tests modifiés, sans changer ce qu'ils prouvent** :

- Listes des fiches précédentes : sept points ouverts deviennent quatorze (`points-entree.attaque.test.ts`, `auth.attaque.spec.ts`), douze règles de débit au lieu de sept (`better-auth.test.ts`, la couverture compare aux points simples plus les chemins internes), onze modèles d'email au lieu de cinq (`modeles.test.ts`), deux surcharges de `storeIdentifier` au lieu d'une (`config.test.ts`), 30 rangs d'adresses de bout en bout au lieu de 24, 80 requêtes du contrôle au lieu de 56 et quinze `POST` au lieu de huit (`controle-deploiement.spec.ts`), une action d'audit de plus (`actions.test.ts`, `audit.test.ts`).
- `points-entree.attaque.test.ts` : « `200` avec `twoFactorRedirect` : erreur » devient « sans cookie d'attente : erreur » ; avec le cookie, c'est l'étape du code (section 2.2), testée dans `double-authentification.attaque.test.ts`. Les deux points composés sont vérifiés absents de l'instance de Better Auth.
- Appels de `creerTraitementAuth` des tests de la 1.1 à la 1.3 : nouvelle dépendance `doubleAuth` exigée par le type, inerte (`outils-test/double-auth.ts`, qui lève si une dépendance est atteinte).
- `gestionnaire.test.ts` : délai de 30 s au lieu de 10 s. Chaque test recharge le gestionnaire et tous ses modules ; le premier dépassait 10 s sous la charge de la suite complète (déjà 10,1 s seul sur `main`). Rien de ce qui est vérifié ne change.
- Erreurs de mise en place de mes propres tests de la phase rouge, corrigées sans changer ce qu'ils vérifient : adresse du compteur attendue sous sa forme normalisée (`emails.test.ts`, comme les tests de la 1.1) ; `confirm-enable` testé pendant une activation en cours, seul état où il existe (`double-authentification.attaque.test.ts`) ; une surcharge qui gardait son entrée du journal des appels (`double-authentification.test.ts`) ; l'instance du test de la version installée ouvre deux sessions (inscription puis connexion), la rotation se vérifie sur la session du cookie (`double-authentification-better-auth.test.ts`). Typage du résultat de `enableTwoFactor` (union de Better Auth) : `as Activation`, sans changer les assertions.
- `e2e/double-authentification.spec.ts` : la recherche d'un code dans les adresses du navigateur se fait sur les valeurs mêmes (clé, code envoyé, codes de secours) ; le motif général de la phase rouge prenait aussi le nom des fichiers statiques de Next.js, son paramètre `_rsc` aléatoire et « ouble-authe » du chemin `/compte/double-authentification`.
- `e2e/controle-deploiement.spec.ts` : la nouvelle page est servie par le serveur factice comme `/compte` ; elle rejoint donc la liste des pages des défauts communs (en-têtes, politique, nonce, anglais, gabarit), et `--detail` affiche 14 lignes et quatre comparaisons de documents au lieu de 11 et trois.
- `double-authentification.integration.test.ts` : délai de 180 s pour le test des 21 essais (5 connexions et 21 vérifications, chacune avec plusieurs allers-retours vers Neon).

**Écarts avec la fiche** :

- `lireComptePourPage` est inchangée (elle ne rend que l'identifiant) : les pages `/compte` et `/compte/double-authentification` lisent l'état du second facteur par `lireEtatDoubleAuth` (`exposer.ts`, puis `src/server/auth/etat-double-auth.ts`), pour l'utilisateur de la session seulement. `SessionLue` ne change qu'en PR 2.
- Le test T-04 (report de la 1.3) est dans `double-authentification.integration.test.ts`, qui a le banc et les aides de la double authentification, et non dans `reinitialisation.integration.test.ts`.
- La fabrique `creerDependancesDoubleAuth` (`src/server/auth/dependances-double-auth.ts`) lie les dépendances pour `gestionnaire.ts` et pour le banc d'intégration : une seule liaison, testée par le banc sur la vraie base. Lectures par l'adaptateur interne de Better Auth (jamais `auth.api`, constat de la 1.2) ; le mot de passe est vérifié par `password.verify` du contexte, sur le compte `credential`.
- L'anti-rejeu s'applique à tout code de l'application : connexion, confirmation et vérifications de la gestion (section 6.1).
- Le code QR porte un fond `#ffffff` et des modules `#000000` écrits dans le composant, et non des variables du thème (règle 1 de la compétence `interface`) : un code inversé en thème sombre se lit mal par l'appareil photo.
- Non faits en PR 1, repris en PR 2 (tests 32 et 33) : le passage complet avec capture du journal du serveur sur le site construit (test 17 et `erreurs.attaque.spec.ts`, serveur en panne à l'étape du code). Sous Vitest, une exception d'une dépendance donne une seule ligne `[auth]` sans code ni identifiant (`double-authentification.test.ts`).

**Vérifications** : voir la description de la PR (sorties de `npm run verifier` et de `npm run test:integration` sur `dev`).

**À faire par le développeur avant la fusion** : l'essai sur la prévisualisation (« Vérifications manuelles ») ; l'essai de la procédure de remise à zéro sur `dev` (`docs/exploitation/remise-a-zero-double-authentification.md`, section 4).

### PR 2, le 2026-10-19

Branche `feat/1.4-exigence-par-role` : commits `docs(1.4): PR 2`, `test(1.4)` (phase rouge), `feat(1.4)`.

**Phase rouge** (commit `test(1.4)`). Unitaires : 16 échecs (étape 7 de `action.test.ts` pour le Propriétaire et le Comptable, et la valeur mal formée ; `session.test.ts`, champ absent), plus les erreurs de type du champ absent. Intégration (sur `dev`) : 5 échecs dans `chaine.attaque.integration.test.ts`. Bout en bout (site construit avant le code, tests unitaires remisés le temps de la construction, base jetable) : 1 échec (test 31).

**Passaient avant le code, et pourquoi** : Commercial et Lecteur sans second facteur acceptés (non concernés, garde de non-régression) ; tests 32 et 33, qui vérifient le code de la PR 1 (report) ; `affichage-connecte.spec.ts`, dont seule la mise en place change.

**Tests modifiés, sans changer ce qu'ils prouvent** :

- Sessions factices des tests de la chaîne (`action.test.ts`, `action-debit.test.ts`, `action-email.test.ts`, `exposer.test.ts`) : champ `doubleAuthentification` ajouté (vrai pour les membres, faux pour la zone compte, qui reste ouverte sans second facteur).
- `creerMembre` : option `doubleAuthentification`, vraie par défaut (section 9).
- `affichage-connecte.spec.ts` : le compte active la double authentification avant d'être rattaché comme Propriétaire ; les étapes du parcours passent de `double-authentification.spec.ts` à `e2e/double-auth.ts`, inchangées (le titre « Codes de secours » est cherché exactement : « Créer de nouveaux codes de secours » y répondait aussi, erreur de mise en place du test 32, vue en phase rouge).
- Rangs d'adresses de bout en bout : le rang 25 (`secours`, jamais utilisé) devient `journal` (test 32) ; rang 30 ajouté (`proprietaire`, test 31) ; 31 rangs au lieu de 30 (`nettoyer-comptes.spec.ts`).

**Écarts avec la fiche** : aucun sur le fond. Le test 33 atteint l'étape du code en simulant la seule réponse de `/sign-in/email` dans le navigateur (`page.route`) : la base injoignable empêche de l'atteindre autrement ; le code part vers le vrai serveur.

**Correctif CodeQL** (`js/biased-cryptographic-random`, test 33) : le code de 6 chiffres était tiré par un modulo sur `randomBytes` ; il l'est par `randomInt(100_000, 1_000_000)`. Seule occurrence du motif dans le dépôt. Règle ESLint **W** (`eslint.config.mjs`) : aucun `%` ni `%=` dont un opérande appelle `randomBytes`, `getRandomValues` ou `Math.random`, sur tout le dépôt (`e2e/`, `scripts/`, tests et configurations compris). `restreindreSyntaxe` ajoute W à chaque liste, un bloc couvre les fichiers hors de `src/`, et `regles-import.test.ts` vérifie les cas refusés et autorisés, puis la configuration finale de chaque fichier du dépôt.
