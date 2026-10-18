# Fonctionnalité : mot de passe oublié, puis ouverture des comptes en production

Statut : validée le 2026-10-16 ; PR 1 implémentée le 2026-10-16 (« Notes de l'implémentation »), preuve sur la prévisualisation à faire par le développeur (section 13) ; PR 2 à venir. Fiche rédigée le 2026-10-16 ; les trois vrais choix tranchés par le développeur le même jour (section « Décisions »), les autres points selon la recommandation de l'assistant (section « Décisions par défaut »).

Jalon 1, fonctionnalité 1.3 de `docs/PLAN.md`. Taille M. Cas d'utilisation : UC-03. Exigences : F-002 (réinitialisation), S-10, S-11, S-15, S-17, S-54, S-55, S-63, S-81, S-85. Menaces : T-04, T-07, T-39, T-41, T-43, T-55, T-65.

## Contexte

Un utilisateur qui a oublié son mot de passe ne peut plus entrer dans son compte (UC-03, F-002). Tant que cette voie n'existe pas, les comptes restent fermés en production (décision 1 de la 1.1, étendue par la 1.2) : aucun visiteur réel ne peut s'inscrire.

Aujourd'hui :

- `src/server/auth/points-entree.ts` ouvre cinq points d'entrée de `/api/auth` (inscription, renvoi, vérification, connexion, déconnexion), tous fermés en production par `COMPTES_OUVERTS_EN_PRODUCTION = false`. `/request-password-reset` et `/reset-password/*` répondent comme une adresse inexistante.
- Better Auth 1.7.7 est configuré sans `sendResetPassword` : la réinitialisation y est désactivée.
- Le modèle `compte.existant` n'a aucun lien (règle 17 : seuls les liens `/lien/` construits depuis un jeton).
- `/connexion` n'a pas de lien « Mot de passe oublié ? ».

Points reportés à la 1.3 par les fiches précédentes :

| Point | Origine | Section |
|---|---|---|
| Réinitialisation ; `haveIBeenPwned` sur `/reset-password` | `inscription.md`, « Reporté » | 1 à 5 |
| Réinitialisation d'un compte non vérifié : il devient vérifié et ses sessions sont fermées (pré-appropriation d'adresse) | `inscription.md`, « Reporté » et « Limites connues » | 4.3 |
| Liens de `compte.existant` vers la connexion et la réinitialisation | `inscription.md`, `connexion.md`, « Reporté » | 6.3 (décision A) |
| Lien « Mot de passe oublié » sur `/connexion` | `connexion.md`, « Reporté » | 7 |
| Vérification d'adresse depuis un navigateur connecté : l'ancienne session n'est pas révoquée | `connexion.md`, « Limites connues » | 8 |
| Ouverture des comptes en production (retrait de `COMPTES_OUVERTS_EN_PRODUCTION`) | Décision 1 de la 1.1 ; `connexion.md` 1.3 | PR 2, sections 10 à 12 |

## Problème

- Un utilisateur qui a oublié son mot de passe n'a aucun recours.
- Le pré-propriétaire d'une adresse (compte non vérifié créé par un tiers) bloque le vrai titulaire jusqu'à la purge à 7 jours.
- Tel que Better Auth 1.7.7 le fournit (lu dans `node_modules/better-auth/dist/api/routes/password.mjs`, section 1), la réinitialisation :
  - stocke le jeton **en clair** en base (`verification.identifier = "reset-password:<jeton>"`), contraire à S-15 ;
  - met le jeton dans le **chemin** du lien (`/reset-password/<jeton>?callbackURL=...`), donc dans les journaux de requêtes (S-54) ;
  - vérifie le mot de passe compromis **après** avoir consommé le jeton : un mot de passe refusé brûle le lien ;
  - ne ferme **aucune** session par défaut (`revokeSessionsOnPasswordReset: false`), contraire à S-17 ;
  - laisse valides les autres jetons de réinitialisation du même compte après un succès ;
  - ne marque pas vérifiée l'adresse d'un compte non vérifié.

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Deux points d'entrée de plus | `src/server/auth/points-entree.ts` | `POST /request-password-reset`, `POST /reset-password` ; `GET /reset-password/:token` reste fermé |
| Réglages de Better Auth | `src/server/auth/config.ts` | `sendResetPassword`, durée de 30 min, sessions révoquées, jeton haché (S-15) |
| Après réinitialisation | `src/server/auth/reinitialisation.ts`, `src/server/db/comptes.ts` | Autres jetons supprimés, adresse marquée vérifiée, notification planifiée |
| Emails | `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | `compte.reinitialisation`, `compte.mot_de_passe_modifie`, liens de `compte.existant` |
| Limites | `src/server/debit/limites.ts`, `src/server/auth/gestionnaire.ts` | Par adresse IP (Better Auth), par adresse email (notre gestionnaire), budget d'emails propre |
| Pages | `src/app/(public)/mot-de-passe-oublie/`, `src/app/lien/reinitialisation/` | Demande, choix du nouveau mot de passe |
| Purge | `src/server/db/comptes.ts`, `src/server/taches/etapes.ts` | Jetons expirés, par la tâche quotidienne |

### 1. Ce que fait Better Auth 1.7.7

Lu dans `node_modules/better-auth/dist/api/routes/password.mjs`, `db/internal-adapter.mjs`, `db/verification-token-storage.mjs`, `plugins/haveibeenpwned/index.mjs`, `api/rate-limiter/index.mjs`, et `@better-auth/drizzle-adapter/dist/index.mjs`.

**Points d'entrée** (trois, plus `/verify-password`, réservé aux appels serveur) :

| Point | Ce qu'il fait |
|---|---|
| `POST /request-password-reset` | Corps `{ email, redirectTo? }` (`z.email()`). Refuse si `sendResetPassword` est absent (`RESET_PASSWORD_DISABLED`, `logger.error`). Cherche l'utilisateur **sans regarder `emailVerified`**. Inconnu : `generateId(24)`, une lecture factice (`findVerificationValue("dummy-verification-token")`, qui supprime au passage les jetons expirés), `logger.warn("Reset Password: User not found")`. Connu : crée une ligne `verification` (`identifier: "reset-password:<jeton>"`, `value: <id utilisateur>`, `expiresAt`), puis appelle `sendResetPassword({ user, url, token })` par `runInBackgroundOrAwait` (sans gestionnaire de tâches de fond configuré : attendu ; une exception est attrapée et passée à `logger.error`). Corps identique dans les deux cas : `{ status: true, message: "If this email exists..." }` |
| `GET /reset-password/:token` | Jeton dans le chemin, `callbackURL` obligatoire ; redirige vers `callbackURL?token=<jeton>` ou `?error=INVALID_TOKEN`. Ne consomme rien |
| `POST /reset-password` | Corps `{ newPassword, token? }`, jeton accepté aussi dans la requête (`?token=`). Dans l'ordre : longueur min et max (`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, jeton intact) ; **consommation** du jeton (`consumeVerificationValue`) ; absent ou expiré : `400 INVALID_TOKEN` ; utilisateur introuvable : `400 USER_NOT_FOUND` ; hachage du mot de passe (**c'est là que `haveIBeenPwned` vérifie**, jeton déjà consommé) ; mise à jour du mot de passe ; `onPasswordReset({ user })` attendu ; si `revokeSessionsOnPasswordReset` : `deleteUserSessions(userId)`, toutes les sessions. Réponse `{ status: true }`, aucun cookie, aucune session créée |

**Jeton.** `generateId(24)` : 24 caractères `[A-Za-z0-9]` tirés par `createRandomStringGenerator`, soit environ 143 bits. Durée : `resetPasswordTokenExpiresIn`, 3 600 s par défaut.

**Usage unique.** `consumeVerificationValue` supprime la ligne par `DELETE ... WHERE id IN (SELECT id ... LIMIT 1) RETURNING` (adaptateur Drizzle, PostgreSQL) : de deux requêtes simultanées, une seule reçoit la ligne. Une ligne expirée est supprimée et refusée. Les **autres** jetons du même utilisateur restent valables.

**Stockage haché.** Option `verification.storeIdentifier` (défaut `"plain"`) : `"hashed"` (SHA-256 en `base64url`), ou `{ hash }`, réglable par préfixe d'identifiant (`overrides`). Une recherche essaie d'abord la forme hachée, **puis la forme en clair** (`identifiersToTry`), pour les lignes antérieures au réglage.

**Mots de passe compromis.** `haveIBeenPwned()` enveloppe `password.hash` ; ses chemins par défaut comprennent `/reset-password`. Service injoignable : `500` (`APIError INTERNAL_SERVER_ERROR`). La fonction `isPasswordCompromised` est exportée par `better-auth/plugins` (aucune dépendance nouvelle).

**Débit.** Règles spéciales par défaut : `/request-password-reset`, 3 par 60 s ; `/reset-password` n'en a pas (règle générale). Les nôtres les remplacent (`customRules`, 1.1).

**Journal.** `logger.warn` pour une adresse inconnue ; `logger.error` si la réinitialisation est désactivée ou si le rappel lève. Avec notre `consignerAuth` (1.1), chacun devient une ligne fixe `[auth] warn` ou `[auth] error`, sans message ni argument.

**Double authentification.** Rien n'y touche : `twoFactorEnabled` et le secret restent tels quels (UC-03, « Abus » ; test en 1.4).

### 2. Les points d'entrée (T-55, S-81)

#### 2.1 Ouverts par la PR 1

| Méthode et chemin | Pourquoi | Protections propres |
|---|---|---|
| `POST /request-password-reset` | UC-03, étapes 1 et 2 | Origine, schéma strict, limite par adresse IP et par adresse email, durée plancher, réponse unique |
| `POST /reset-password` | UC-03, étapes 3 et 4 | Origine, schéma strict, jeton dans le corps seulement, contrôles avant consommation (section 3.3), limite par adresse IP |

Ils suivent les étapes de la section 2.2 de `inscription.md` (origine, taille et type, schéma, requête interne en mémoire, réponse normalisée, jamais le corps de Better Auth) :

- **`/request-password-reset`.** Schéma `{ email }` strict (`src/schemas/compte.ts`) : `redirectTo` refusé (aucune redirection choisie par la requête). Adresse : `schemaAdresse` de la porte. Limite par adresse email avant Better Auth (section 5). Requête interne : `{ email }`, en-têtes `x-forwarded-for` et `user-agent` seulement.
- **`/reset-password`.** Schéma `{ jeton, motDePasse }` strict ; `jeton` : exactement 24 caractères `[A-Za-z0-9]` (forme de `generateId(24)`, figée par un test sur la version installée) ; `motDePasse` : 128 caractères au plus, longueur minimale vérifiée à part (`mot_de_passe_trop_court`, UC-03 4a). Requête interne : `POST /reset-password`, corps `{ newPassword, token }`. Comme pour tout `POST`, une adresse reçue avec une requête (`?token=`) est refusée (`invalide`).

#### 2.2 Restent fermés

| Points d'entrée | Jusqu'à |
|---|---|
| `GET /reset-password/:token` | **Toujours.** Jeton dans le chemin, `callbackURL` choisie par la requête. Test : un jeton valide dans ce chemin reçoit `reponseInexistante()`, Better Auth jamais appelé |
| `/verify-password`, `/change-password` | Une fiche qui en a besoin (1.6 ou paramètres du compte) |
| Tous ceux de la liste de `connexion.md`, section 1.2 | Inchangé |

Le test d'inventaire passe à **sept** points ouverts. Le contrôle après déploiement passe à sept `POST` fermés en production (PR 1), puis ouverts et protégés par l'origine (PR 2, section 11).

#### 2.3 Réponses

| Situation | Réponse |
|---|---|
| Demande, toute adresse valide (compte vérifié, non vérifié, ou aucun compte) | `200 { ok: true }`, après 800 ms au moins |
| Demande, limite atteinte (adresse IP ou adresse email) | `429 { ok: false, raison: "trop_de_requetes" }`, pour toute adresse |
| Réinitialisation réussie | `200 { ok: true }`, aucun cookie |
| Jeton absent de la base, expiré, déjà utilisé ; utilisateur supprimé | `400 { ok: false, raison: "lien_invalide" }` |
| Mot de passe de moins de 12 caractères | `400 { ok: false, raison: "mot_de_passe_trop_court" }`, jeton intact |
| Mot de passe compromis | `400 { ok: false, raison: "mot_de_passe_compromis" }`, jeton intact (section 3.3) |
| Panne de la base, de Have I Been Pwned, du compteur | `500 { ok: false, raison: "erreur", incident }` |

Aucune nouvelle raison : la liste fermée de la 1.1 et de la 1.2 suffit.

### 3. Le jeton (S-15, T-04)

#### 3.1 Aléatoire, court, à usage unique

- **Aléatoire** : `generateId(24)`, environ 143 bits (section 1). Deviner un jeton est hors de portée, limite ou non.
- **Durée** : `resetPasswordTokenExpiresIn: 30 * 60` (décision par défaut 3). Un lien qui traîne (boîte partagée, copie dans « Messages envoyés » du compte d'envoi, RR-9) cesse vite de servir.
- **Usage unique** : consommation atomique par Better Auth (section 1). **De plus**, après un succès, tous les autres jetons de réinitialisation du compte sont supprimés (section 4.2) : une demande antérieure ne sert plus.

#### 3.2 Stocké haché

```ts
verification: {
  storeIdentifier: {
    default: "plain",
    overrides: { "reset-password:": { hash: empreinteJetonReinitialisation } },
  },
},
```

`empreinteJetonReinitialisation(identifiant)` (`src/server/auth/reinitialisation.ts`) rend `reinitialisation:<SHA-256 en base64url>`. La base ne contient jamais le jeton ; une copie de la base ne permet pas de réinitialiser un mot de passe.

- **Préfixe distinct de `reset-password:`** : Better Auth essaie aussi la forme en clair de l'identifiant (section 1). Si la ligne stockée commençait par `reset-password:`, l'empreinte lue dans une copie de la base, présentée comme jeton, désignerait la ligne. Avec `reinitialisation:`, la forme en clair `reset-password:<x>` ne désigne jamais une ligne stockée. En plus, le schéma n'admet que 24 caractères alphanumériques, alors qu'une empreinte en a 43 (test d'attaque dédié).
- **Préfixe connu** : il permet de supprimer les autres jetons d'un compte (section 4.2), par `identifier LIKE 'reinitialisation:%' AND value = <id>`, motif constant.
- **Limité à la réinitialisation** : la vérification de l'adresse n'écrit aucune ligne (JWT, 1.1) ; la 1.4 choisira pour ses codes.
- **Pas de sel** : le jeton a 143 bits d'entropie ; une empreinte rapide suffit (aucune attaque par dictionnaire possible).

#### 3.3 Contrôles avant la consommation

Better Auth vérifie le mot de passe compromis après avoir consommé le jeton (section 1) : un mot de passe refusé, ou Have I Been Pwned en panne, brûlerait le lien, et l'utilisateur devrait en redemander un (2 par heure, section 5). Notre gestionnaire vérifie donc, **avant** d'appeler Better Auth, dans cet ordre :

1. longueur minimale : `mot_de_passe_trop_court` ;
2. **jeton connu et non expiré**, sans le consommer (`jetonReinitialisationValide`, dépendance liée à `internalAdapter.findVerificationValue`, qui applique l'empreinte) : sinon `lien_invalide`. Ainsi Have I Been Pwned n'est interrogé que pour le titulaire d'un lien valable, et notre serveur ne sert pas de relais gratuit vers ce service ;
3. **mot de passe compromis** (`motDePasseCompromis`, dépendance liée à `isPasswordCompromised` de `better-auth/plugins`) : `mot_de_passe_compromis` ; service en échec : `erreur` ;
4. Better Auth : limite par adresse IP, consommation, hachage (l'extension vérifie une seconde fois : garde-fou si l'ordre changeait), mise à jour, rappel, révocation.

Un jeton qui expire entre l'étape 2 et l'étape 4 donne `lien_invalide` à l'étape 4 : même réponse. Coût : deux appels à Have I Been Pwned par réinitialisation réussie, et une lecture en base hors de la limite par adresse IP (comme la limite par compte de la connexion, 1.2), bornée par la limite de Better Auth dès que la requête l'atteint.

#### 3.4 Jamais dans une adresse reçue par le serveur

Comme pour la vérification (décision 3 de la 1.1) :

- **Lien de l'email** : `<origine de BETTER_AUTH_URL>/lien/reinitialisation#<jeton>`, construit par la porte (`lienFragment`, type `reinitialisation`). `lienFragment` gagne une table fermée type → brique : `verification` → `jetonVerification()`, `reinitialisation` → nouvelle brique `jetonReinitialisation()` (24 caractères `[A-Za-z0-9]`). L'`url` fournie par Better Auth (jeton dans le chemin, `callbackURL`) est ignorée.
- **Page `/lien/reinitialisation`** (zone par lien : ne lit jamais la session). Composant client : lit `location.hash`, l'efface aussitôt (`history.replaceState`), vérifie sa forme, puis affiche le formulaire « Nouveau mot de passe » et le bouton « Enregistrer le mot de passe ». Rien n'est envoyé avant le clic : un robot de messagerie qui ouvre le lien ne consomme rien. Le bouton envoie `POST /api/auth/reset-password` avec `{ jeton, motDePasse }` dans le corps.
- Fragment absent ou hors forme : « Ce lien n'est plus valable » et le lien « Demander un nouveau lien » (UC-03, 3a), sans envoi.

### 4. Après la réinitialisation (S-17, UC-03 étape 4)

#### 4.1 Toutes les sessions fermées

`revokeSessionsOnPasswordReset: true` : Better Auth supprime **toutes** les sessions du compte (`deleteUserSessions`), après la mise à jour du mot de passe. Aucune session n'est ouverte par la réinitialisation : l'utilisateur se connecte ensuite (la double authentification restera exigée, 1.4). Une panne pendant la suppression lève : `erreur` avec incident. Le mot de passe est alors déjà changé ; refaire une demande puis une réinitialisation ferme les sessions (« Limites connues »).

Le navigateur qui réinitialise garde éventuellement un cookie de session : il ne désigne plus rien (`lireSession` le lit comme absent).

#### 4.2 Le rappel `onPasswordReset`

`apresReinitialisation({ user })` (`src/server/auth/reinitialisation.ts`), appelé par Better Auth avant la révocation. Il **ne lève jamais** : une exception empêcherait Better Auth de révoquer les sessions. Chaque étape est attrapée et consignée par une ligne fixe `[auth]` avec incident, sans identifiant ni adresse :

1. **Notification planifiée** par `after()` (section 6.2), envoyée après la réponse.
2. **Autres jetons supprimés** : `supprimerJetonsReinitialisation(utilisateurId)` (`src/server/db/comptes.ts`). En échec : ils expirent au plus tard 30 minutes après leur demande.
3. **Adresse marquée vérifiée** si elle ne l'était pas (section 4.3) : `marquerAdresseVerifiee(utilisateurId)`. En échec : l'utilisateur confirme son adresse par le renvoi du lien de la 1.1.

Les deux fonctions de base sont des requêtes paramétrées par `db`, dans `src/server/db/`, sur des tables de Better Auth sans `organisation_id` (comme les purges). Elles sont injectées dans `apresReinitialisation` par `config.ts`.

#### 4.3 Compte non vérifié (pré-appropriation d'adresse, décision B)

Better Auth envoie le lien même pour un compte non vérifié (section 1) ; c'est voulu : la réponse et l'email ne disent rien de l'état du compte (T-07). Recevoir le lien et l'utiliser prouve la possession de la boîte, comme la vérification. Après une réinitialisation réussie, le compte devient vérifié, le mot de passe connu du tiers ne sert plus, et le vrai titulaire se connecte directement. Un compte non vérifié n'a jamais de session (1.1, 1.2) : rien d'autre à fermer.

Ce que garde le compte : le nom saisi par le tiers à l'inscription (affiché sur `/compte`). Noté dans « Limites connues ».

### 5. Limites (S-11, T-41, T-43)

Toutes les tentatives comptent. Valeurs dans `limites.ts` seulement (règle 15) ; aucune règle `(fenêtre, maximum)` partagée entre deux limites `auth.*` (invariant de la 1.1) :

| Nom | Maximum | Fenêtre | Par | Où |
|---|---|---|---|---|
| `auth.reinitialisation_demande` | 4 | 1 h | Adresse IP | Better Auth, chemin `/request-password-reset` |
| `auth.reinitialisation_compte` | 2 | 1 h | Adresse email saisie | Notre gestionnaire, par `verifierDebit`, après le schéma, avant Better Auth, pour **toute** adresse valide |
| `auth.reinitialisation` | 6 | 15 min | Adresse IP | Better Auth, chemin `/reset-password` |

- **Par adresse email, pour toute adresse** : comme `auth.connexion_compte` (1.2), sinon la troisième demande dirait si l'adresse a un compte. La dépendance `limiterCompte` reçoit le nom de la limite (`limiterCompte(nom, adresse)`), liée à `verifierDebit` dans `gestionnaire.ts`.
- **Effet sur T-43** : un tiers qui connaît une adresse peut en bloquer la réinitialisation une heure, par 2 demandes, renouvelables ; il fait partir au plus 2 emails par heure vers la victime (10 par jour, `email.destinataire_jour`). Même nature que RR-12, sans rien apprendre. Ajouté à RR-12 dans `THREATS.md`.
- **Emails** (section 6.4) : les limites par destinataire de la 0.7 s'appliquent en plus, en silence.

### 6. Les emails (règle 17, S-55, T-65)

#### 6.1 Rappel `sendResetPassword`

`planifierEmailReinitialisation` (`src/server/auth/emails.ts`), sur le modèle des rappels de la 1.1 : planifie l'envoi par `after()`, rend la main aussitôt, ne lève jamais (la durée et le résultat ne disent rien), ignore `url`, ne transmet que `token`. Dans la tâche : limites, puis `envoyerEmail`. Aucun envoi pendant une transaction (adaptateur sans transaction, 1.1).

#### 6.2 Les modèles

Textes dans `src/textes/emails.ts`, texte brut, phrase de fin « ne pas répondre » :

| Modèle | Paramètres | Contenu |
|---|---|---|
| `compte.reinitialisation` | `jeton: jetonReinitialisation()` | Sujet « Réinitialisation de votre mot de passe ». « Une demande de réinitialisation du mot de passe a été faite pour votre compte Facturation PME. Pour choisir un nouveau mot de passe, ouvrez ce lien, puis enregistrez votre nouveau mot de passe : » ; le lien ; « Ce lien est valable 30 minutes et ne sert qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé. » |
| `compte.mot_de_passe_modifie` | aucun | Sujet « Votre mot de passe a été modifié ». « Le mot de passe de votre compte Facturation PME vient d'être modifié, et toutes vos sessions ont été fermées. Si vous êtes à l'origine de ce changement, aucune action n'est attendue. Sinon, choisissez sans attendre un nouveau mot de passe depuis cette page : » ; lien vers `/mot-de-passe-oublie` (décision A). Ni date, ni adresse IP, ni appareil |
| `compte.existant` (texte revu) | aucun | Texte de la 1.2, avec les liens vers `/connexion` et `/mot-de-passe-oublie` (décision A) : « ... Si c'est vous, connectez-vous : <lien>. Mot de passe oublié : <lien>. Si vous n'avez pas encore confirmé votre adresse, demandez un nouveau lien de confirmation depuis la page de connexion. Sinon, ignorez cet email : votre compte n'a pas été modifié. » |

#### 6.3 Liens vers une page fixe (décision A)

La règle 17 et la parade de T-65 n'admettent que des liens `/lien/` construits depuis un jeton. Les liens « Se connecter » et « Mot de passe oublié » n'ont pas de jeton. **Recommandé** : une troisième forme, `lienPage(origine, page)`, à côté de `lienPublic` et `lienFragment` :

- `page` dans une **liste fermée** (`PAGES_LIEN`, `src/server/email/modeles.ts`) : `connexion` → `/connexion`, `mot-de-passe-oublie` → `/mot-de-passe-oublie`. Ni paramètre, ni requête, ni fragment ;
- le lien est écrit **dans la construction du modèle**, jamais reçu de l'appelant : `compte.existant` et `compte.mot_de_passe_modifie` gardent `parametres: z.strictObject({})` ;
- origine de la configuration, comme les deux autres formes.

Un appelant ne peut donc toujours produire aucun lien vers un autre site ni vers une page choisie (T-65). Un test prouve qu'une page hors de la liste est refusée (`lienPage` lève), y compris une page proche (`connexion/`, `Connexion`, `../connexion`, `mot-de-passe-oublie?x=1`), et que l'adresse produite commence toujours par l'origine de la configuration. La règle 17 de `CLAUDE.md` et la parade de T-65 dans `THREATS.md` sont réécrites avec les décisions (commit `docs(1.3): décisions`) : « origine de l'application ; chemin `/lien/` construit depuis un jeton, ou page fixe d'une liste fermée écrite dans le modèle ».

#### 6.4 Limites d'envoi : un budget propre à la réinitialisation

Aujourd'hui, `email.compte` (100 par 24 h, 1.1) est partagée par la vérification et `compte.existant`. Une vague d'inscriptions depuis quelques adresses IP l'épuise (5 inscriptions par heure et par adresse IP suffisent en un jour, « Limites connues » de la 1.1) ; avec la réinitialisation dans le même budget, elle bloquerait aussi « mot de passe oublié » pour tous.

**Retenu** (décision par défaut 7) : une nouvelle limite `email.reinitialisation`, 50 par 24 h, valeur fixe, pour `compte.reinitialisation` et `compte.mot_de_passe_modifie`, à la place d'`email.compte`. Somme 150, sous `email.application` (200), elle-même sous les 500 par jour de Gmail.

| Modèle | Limites vérifiées, dans cet ordre |
|---|---|
| `compte.verification`, `compte.existant` | Inchangé : `email.destinataire`, `email.destinataire_jour`, `email.compte`, `email.application` |
| `compte.reinitialisation` | `email.destinataire`, `email.destinataire_jour`, `email.reinitialisation`, `email.application` |
| `compte.mot_de_passe_modifie` | `email.reinitialisation`, `email.application` |

**Ligne de journal d'une limite atteinte** (pour la surveillance de la décision C) : la ligne `[email]` des rappels de compte gagne le nom de la limite, valeur d'une liste fermée qui ne désigne personne : `[email] {"modele":"compte.reinitialisation","raison":"limite","limite":"email.reinitialisation","incident":"<uuid>"}`. Toujours ni adresse, ni jeton.

**Notification sans limite par destinataire** (décision par défaut 8) : elle ne part qu'après la consommation d'un jeton, lui-même envoyé sous les limites par destinataire ; elle est donc bornée par elles. Sans cette exception, trois emails dans l'heure vers une adresse (demandes, vérification) feraient taire l'alerte, que quiconque provoque par deux demandes avant d'utiliser un lien dérobé.

### 7. Les pages

| Adresse | Zone | Contenu |
|---|---|---|
| `/mot-de-passe-oublie` | `(public)` | Champ email, bouton « Recevoir un lien ». Envoi par `fetch` en JSON. Réponse `{ ok: true }` : le formulaire laisse place à « Si un compte existe pour cette adresse, un email vient de partir. Le lien est valable 30 minutes. », identique pour toute adresse (UC-03, étape 2). `trop_de_requetes` : message de la 1.1. Appelle `redirigerSiConnecte` (1.2) : un utilisateur connecté va sur `/compte` |
| `/lien/reinitialisation` | `lien` | Section 3.4. Succès : « Votre mot de passe a été modifié. Toutes vos sessions ont été fermées. » et le lien « Se connecter ». `lien_invalide` : « Ce lien n'est plus valable » et « Demander un nouveau lien ». `mot_de_passe_trop_court`, `mot_de_passe_compromis` : messages de l'inscription, le formulaire reste. `erreur` : message et identifiant d'incident |
| `/connexion` | `(public)` | Lien « Mot de passe oublié ? » sous le champ du mot de passe (`DESIGN-SYSTEM.md`) |

Formulaires affichés après hydratation, `<noscript>` sinon (décision par défaut 4 de la PR 2 de la 1.1). Un seul champ de mot de passe, comme l'inscription. Interface selon `docs/DESIGN-SYSTEM.md` (compétence `interface`), textes dans `src/textes/compte.ts`, vérifiée à 390 et 1280 px. `/mot-de-passe-oublie` rejoint le projet `mobile-390` de Playwright ; le test d'inventaire vérifie l'appel à `redirigerSiConnecte`.

### 8. Report de la 1.2 : vérification depuis un navigateur connecté

`connexion.md` (« Limites connues ») : la vérification d'une adresse ouvre une nouvelle session sans révoquer celle du cookie reçu. **Traité ici** : c'est le mécanisme du correctif de la connexion (`revoquerSession`), déjà écrit et testé.

- `/verify-email` reçoit une étape `verifier` : quand la réponse de Better Auth **pose un cookie de session**, la session du cookie reçu est révoquée en base avant que le nouveau cookie parte. La signature de `verifier` reçoit les cookies traduits.
- Lien déjà utilisé (aucun nouveau cookie) ou refusé : rien n'est révoqué ; ouvrir un vieux lien ne déconnecte pas.
- Révocation en échec : `erreur` avec incident, aucun cookie (comme la connexion).

### 9. Purge des jetons expirés (S-63)

Better Auth ne supprime les lignes expirées de `verification` qu'à l'occasion d'une recherche (`findVerificationValue`). Nouvelle étape `jetons_expires` de la tâche quotidienne : `purgerJetonsExpires()` (`src/server/db/comptes.ts`) supprime les lignes dont `expires_at` est passé. `THREATS.md` 7.2 gagne la ligne « Jeton de réinitialisation (empreinte), 30 minutes, purge quotidienne ».

### 10. Journal

- **Journal technique** : les lignes fixes de la 1.1 (`[auth] warn` pour une adresse inconnue, comme une connexion échouée) et de la 0.7 (`[email]`). Aucune adresse, aucun jeton, aucun identifiant d'utilisateur. Le rappel d'après réinitialisation consigne ses échecs par une ligne `[auth]` avec incident.
- **Journal d'audit** : rien (aucune organisation, décision 7 de la 1.2). La notification par email est la trace donnée à l'utilisateur ; la date de mise à jour du compte reste en base (`account.updated_at`).

### PR 2. Ouverture des comptes en production

#### 11. Ce qui change

1. **Code.** `COMPTES_OUVERTS_EN_PRODUCTION` et sa branche dans `traiterRequeteAuth` sont retirés (décision 1 de la 1.1 : jamais une variable d'environnement). Les sept points d'entrée répondent en production comme en prévisualisation.
2. **Effets en production.** Inscription, vérification, connexion, déconnexion, réinitialisation ouvertes à tous. Emails réels vers toute adresse (la liste `EMAIL_DESTINATAIRES_AUTORISES` est ignorée en production, `env-schema.ts`). Appels réels à Have I Been Pwned. Lignes nouvelles dans `user`, `account`, `session`, `verification`, `compteur_debit`, purgées par la tâche quotidienne. Les pages `/inscription`, `/connexion`, `/mot-de-passe-oublie`, `/compte` deviennent utiles. Aucune organisation ne peut être créée avant la 2.1 : un compte ne donne accès à aucune donnée (`PLAN.md` section 7, « Visibilité des Commerciaux », reste valable : pas d'organisation, donc pas de vrais utilisateurs d'une organisation).
3. **Contrôle après déploiement** (`scripts/controle-deploiement.mjs`), dans la même PR, sinon le premier passage après la fusion échoue :
   - `comptes:*` change de sens : les sept `POST`, **sans corps, sans `Origin`, sans cookie, sans `Authorization`** (contraintes d'`optionsRequete`, 1.1), doivent répondre exactement `403 { ok: false, raison: "refuse" }` : ouverts, et protégés par l'origine. Notre gestionnaire refuse l'origine **avant** de lire le corps et avant Better Auth : aucun compte créé, aucun email, aucun compteur consommé, par construction. Un test du serveur factice le vérifie, et un test unitaire vérifie que `traiterRequeteAuth` n'appelle ni Better Auth ni `limiterCompte` sans `Origin` ;
   - `auth:identique` garde les chemins fermés et gagne `GET /api/auth/reset-password/<jeton forgé>` ;
   - `/mot-de-passe-oublie` contrôlée comme `/inscription`, `/lien/reinitialisation` comme `/lien/verification`.
4. **Documents** : `CLAUDE.md` (comptes ouverts, ligne du contrôle), `THREATS.md` section 10, `PLAN.md`, `controle-deploiement.md`, `CONFIGURATION.md`.

#### 12. Liste de contrôle avant ouverture (développeur)

Avant de fusionner la PR 2, dans cet ordre. Une case non cochée : on ne fusionne pas.

**Variables de Vercel, environnement Production** (tableau de bord, jamais par l'assistant) :

- [ ] `BETTER_AUTH_URL` : l'origine exacte de production, en `https`. Les liens des emails en sont tirés : une faute envoie des liens morts.
- [ ] `BETTER_AUTH_SECRET` : propre à la production, différente de celle de Preview.
- [ ] `DATABASE_URL` : rôle `app_facturation` de la branche `production` de Neon.
- [ ] `GMAIL_UTILISATEUR`, `GMAIL_MOT_DE_PASSE_APPLICATION` : présentes (posées le 2026-10-13), type Sensitive.
- [ ] `CRON_SECRET` : présente, type Secret.
- [ ] `EMAIL_TRANSPORT` : **absente** (`smtp` par défaut en production).
- [ ] `EMAIL_DESTINATAIRES_AUTORISES` : **absente**. Ignorée en production, elle donnerait une fausse impression de protection ; sa présence signale une copie des réglages de prévisualisation.
- [ ] Aucune variable `E2E_*`, `EMAIL_DOSSIER` ni `VERCEL_ENV` posée à la main.

**Gmail** :

- [ ] Compte d'envoi sans alerte de Google, double authentification active, « Messages envoyés » purgé (RR-9).
- [ ] Capacité : Gmail bloque au-delà de 500 envois par jour. Nos plafonds : `email.application` 200 par 24 h, dont `email.compte` 100 et `email.reinitialisation` 50 ; par destinataire 3 par heure et 10 par jour ; aucune organisation n'envoie avant le jalon 4. Fenêtre fixe : au bord, deux fenêtres donnent 400 en 24 h glissantes, toujours sous 500.
- [ ] Preuve de la PR 1 faite sur la prévisualisation (section 13) : email de réinitialisation reçu, `SPF`, `DKIM`, `DMARC` en `pass`.

**Exploitation** :

- [ ] Dernier passage du workflow de contrôle après déploiement vert sur `main`.
- [ ] Tâche quotidienne passée dans les dernières 24 h (journaux de Vercel, lignes de la tâche, sans erreur) : les purges tiendront.
- [ ] Journaux de production récents sans adresse, sans jeton, sans ligne `[Better Auth]`.
- [ ] Identifiant du déploiement de production en cours noté : c'est la cible du retour arrière (section 12.2).

#### 12.1 Juste après la fusion

1. Le workflow de contrôle après déploiement passe (`comptes:*` à 403).
2. Essai réel par le développeur, sur le domaine de production, avec sa propre adresse : inscription, email, confirmation, `/compte`, déconnexion, connexion, « Mot de passe oublié », email, nouveau mot de passe, notification reçue, ancienne session fermée.
3. Journaux du déploiement : lignes `[auth]` et `[email]` fixes seulement ; aucune adresse, aucun jeton.
4. Compte d'envoi Gmail : aucune alerte ; puis surveillance des journaux `[email] ... "limite"` les jours suivants (section 12.3).

#### 12.3 Surveiller les budgets d'emails (RR-13, décision C)

**Où lire.** Tableau de bord de Vercel, projet, onglet « Logs » (journaux d'exécution) ; filtre d'environnement « Production » ; recherche `"raison":"limite"`. Chaque ligne a la forme `[email] {"modele":...,"raison":"limite","limite":...,"incident":...}` (section 6.4). La durée de conservation des journaux de l'offre Hobby est courte (de l'ordre d'une heure, à vérifier dans les réglages du projet) : la lecture se fait le jour même, et une vague se voit tant qu'elle dure. Le compte exact d'une fenêtre se lit sur Neon, branche `production`, table `compteur_debit` : la clé commence par le nom de la limite en clair (`email.compte:`, `email.reinitialisation:`, `email.application:`), suivi d'une empreinte ; la colonne `compte` donne le nombre, `fenetre_debut` le début de la fenêtre.

**Conduite à tenir**, selon la limite nommée :

| Lignes vues | Lecture | Conduite |
|---|---|---|
| `email.destinataire` ou `email.destinataire_jour`, quelques-unes | Un utilisateur qui redemande, ou un tiers qui vise une adresse (RR-12) | Rien : bloqué par conception, la fenêtre se vide seule |
| `email.compte`, en série | Vague d'inscriptions : vérifications bloquées pour tous jusqu'à la fin de la fenêtre (24 h au plus) ; la réinitialisation n'est pas touchée | Noter l'heure et le nombre. Si la vague continue et gêne de vrais utilisateurs : retour arrière (section 12.2), puis fiche de protection |
| `email.reinitialisation`, en série | Vague de demandes de réinitialisation ou de réinitialisations : plus aucun lien ne part | Même conduite ; vérifier aussi qu'aucune alerte de Google n'est arrivée sur le compte d'envoi |
| `email.application` | Budget global atteint : plus aucun email de l'application | Retour arrière si la cause n'est pas comprise ; vérifier le compte Gmail (RR-10) |

Aucune intervention ne remet un compteur à zéro à la main : la limite est une protection, et la vider rouvrirait la voie à l'abus.

#### 12.2 Retour arrière

- **Immédiat** : « Instant Rollback » de Vercel vers le déploiement noté (comptes fermés). Quelques secondes, sans construction. Aucune migration dans cette fonctionnalité : l'ancien code lit la même base.
- **Puis** : PR de retour (`git revert` de la PR 2) pour que `main` corresponde à la production ; tant qu'elle n'est pas fusionnée, ne fusionner rien d'autre (une fusion redéploierait les comptes ouverts).
- **Ce qui reste après le retour** : les comptes créés (inoffensifs ; non vérifiés purgés à 7 jours), leurs sessions (lisibles sur `/compte`, sans aucune donnée d'organisation ; expirées à 7 jours), les jetons (30 minutes). Si une session doit tomber tout de suite, le développeur supprime les lignes de `session` sur Neon.
- **Gmail bloqué** (RR-10) : les emails ne partent plus pendant 1 à 24 h ; inscriptions et réinitialisations attendent. Retour arrière seulement si le blocage dure.

### 13. Preuve sur la prévisualisation (PR 1, développeur)

Comme la section 7 de la 1.1 : variables de prévisualisation limitées à une branche (`GMAIL_*`, `EMAIL_TRANSPORT=smtp`, `EMAIL_DESTINATAIRES_AUTORISES`), adresse propre du déploiement. Demande de réinitialisation pour un compte vérifié ; email reçu, lien en fragment ; nouveau mot de passe compromis refusé, puis lien encore valable ; nouveau mot de passe accepté ; notification reçue ; session de l'autre navigateur fermée ; second usage du lien : « Ce lien n'est plus valable » ; demande pour une adresse inconnue : même écran, aucun email. Journaux sans adresse ni jeton. Variables retirées après la preuve.

#### 13.1 Fusion avant la preuve

La PR 1 (#50) a été fusionnée dans `main` avant cette preuve. Sans exposition : les comptes restent fermés en production (`COMPTES_OUVERTS_EN_PRODUCTION` à `false`), les sept `POST` y répondent comme un chemin inexistant, et le contrôle après déploiement le vérifie (`comptes:*`). Le correctif CodeQL (jetons forgés tirés par `randomInt` de `node:crypto`, au lieu d'un octet modulo 62, dans `scripts/controle-deploiement.mjs` et `e2e/auth.attaque.spec.ts`) est inclus dans cette fusion.

La preuve se fait donc sur la prévisualisation de la branche `fix/1.3-preuve`, créée depuis `main` après la fusion :

- variables de prévisualisation limitées à la branche `fix/1.3-preuve` (champ « Preview Branch » de Vercel) : `GMAIL_UTILISATEUR` et `GMAIL_MOT_DE_PASSE_APPLICATION` (second compte, Sensitive), `EMAIL_TRANSPORT=smtp`, et `EMAIL_DESTINATAIRES_AUTORISES` exactement `ngolognonhoua@gmail.com,mataderleii@gmail.com` (virgule, sans espace ni virgule finale) ;
- inscription et demandes avec ces adresses exactes : la liste autorisée compare la partie locale telle quelle (points et `+` compris), seul le domaine passe en minuscules ;
- la limite `email.destinataire` compte en revanche les variantes Gmail comme une seule boîte (minuscules, partie après `+` et points retirés) : 3 emails par heure et 10 par jour pour chacune des deux adresses, vérification, réinitialisation et « Tentative d'inscription » confondues ; la notification n'entre pas dans la limite par destinataire (section 6.4) ;
- après la preuve : variables retirées de la branche, branche fusionnée avec ses résultats.

#### 13.2 Résultats

Par le développeur, les 2026-10-16 et 2026-10-17, sur la prévisualisation `facturation-nigjmrhuy` de la branche `fix/1.3-preuve`, ouverte par l'adresse propre du déploiement. Conforme.

- **Gmail réel**, envoi depuis `mataderleii@gmail.com` : `ngolognonhoua@gmail.com` reçoit « Tentative d'inscription avec votre adresse », avec les deux liens `/connexion` et `/mot-de-passe-oublie` sur l'origine du déploiement (décision A). Email de réinitialisation : `SPF`, `DKIM` et `DMARC` en `PASS`.
- **Parcours UC-03** : lien `/lien/reinitialisation#…`, validité de 30 minutes annoncée, fragment effacé à l'ouverture ; mot de passe compromis refusé sans brûler le lien (section 3.3) ; nouveau mot de passe accepté ; email « Votre mot de passe a été modifié » reçu ; lien réutilisé : « Ce lien n'est plus valable » ; connexion avec le nouveau mot de passe.
- **Utilisateur connecté** : `/mot-de-passe-oublie` redirige vers `/compte` (attendu, section 7).
- **Limites constatées en réel** : `email.destinataire` (3 par heure et par boîte), avec une ligne `[email]` qui nomme la limite (section 6.4) ; demandes de lien par adresse IP (`auth.reinitialisation_demande`), avec le message « Trop de tentatives ».
- **Non refaits à la main**, la limite par adresse IP étant atteinte ; couverts par les tests automatiques :
  - fermeture de toutes les sessions après la réinitialisation : `src/server/db/reinitialisation.integration.test.ts`, « mot de passe changé, toutes les sessions supprimées, notification, autres jetons supprimés » (deux sessions ouvertes avant, aucune après) ; `e2e/mot-de-passe.spec.ts`, parcours UC-03 (session ouverte dans un autre navigateur, `/compte` « introuvable » après) ;
  - même écran pour une adresse inconnue : `src/server/db/reinitialisation.integration.test.ts`, « compte vérifié, compte non vérifié, adresse inconnue : même réponse, 800 ms au moins ; email pour les deux comptes seulement » ; `e2e/mot-de-passe.spec.ts`, « T-07 : … même écran, même corps de réponse » ; `src/server/auth/points-entree.attaque.test.ts`, « T-07 (1.3) : une seule réponse pour toute demande ».
- **Journaux du déploiement** : aucune adresse email, aucun jeton, aucune ligne `[Better Auth]` ; seulement des lignes `[email]` au contenu fixe (modèle, raison, limite, identifiant d'incident) et des requêtes en 200, 307 (utilisateur connecté redirigé vers `/compte`) et 429 (limite par adresse IP).

Leçons :

- Une variable de Vercel ajoutée ne s'applique qu'au déploiement suivant : redéployer après tout ajout.
- Un envoi par le transport `memoire` (prévisualisation avant les variables `smtp`) compte quand même dans les limites `email.*` : il entame les 3 emails par heure de la boîte.
- Préparer la preuve pour tenir dans 3 emails par heure et par boîte (vérification, demandes, « Tentative d'inscription » confondues ; la notification n'y entre pas), et dans 4 demandes de lien par heure et par adresse IP.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Lien de Better Auth (`/api/auth/reset-password/<jeton>?callbackURL=...`) | Jeton dans le chemin, donc dans les journaux ; `callbackURL` venue de la requête |
| Jeton en clair (défaut de Better Auth) | Contraire à S-15 : une copie de la base donnerait des liens utilisables |
| `storeIdentifier: "hashed"` pour toutes les lignes | Touche aussi les futures lignes de la 1.4 sans fiche ; pas de préfixe pour supprimer les jetons d'un compte |
| Laisser Better Auth vérifier seul le mot de passe compromis | Un mot de passe refusé, ou une panne du service, brûle le lien (section 3.3) |
| Vérifier le mot de passe compromis avant de connaître le jeton | Notre serveur relaierait sans limite des requêtes vers Have I Been Pwned (section 3.3) |
| Garder les autres jetons du compte valables | Une demande antérieure, copiée dans « Messages envoyés », servirait encore après le changement |
| Ne pas réinitialiser un compte non vérifié (aucun email) | Le pré-propriétaire bloque le titulaire ; ou une réponse qui dépend de l'état du compte (T-07) |
| Connexion automatique après réinitialisation | Contournerait la double authentification de la 1.4 (UC-03, « Abus ») ; une session neuve juste après la fermeture de toutes les autres |
| Limite par adresse email silencieuse (seules les limites d'email) | Le titulaire attend un email qui ne vient pas ; la réponse visible est la même pour toute adresse |
| Liens de `compte.existant` sans `lienPage` (texte « depuis la page de connexion ») | Possible, si la décision A est refusée ; moins utile au titulaire |
| Interrupteur de production par variable d'environnement | Décision 1 de la 1.1 ; le retour arrière passe par Vercel (section 12.2) |
| Ouvrir la production dans la PR 1 | Une preuve sur la prévisualisation d'abord, et une liste de contrôle propre à l'ouverture |
| Champ de confirmation du mot de passe | L'inscription n'en a pas ; un oubli se répare par une nouvelle demande |

## Règles de sécurité et permissions

- **S-10** : 12 à 128 caractères, mots de passe compromis refusés, avant la consommation du jeton (section 3.3).
- **S-11, T-07** : même réponse et même durée (800 ms au moins) pour une adresse avec compte vérifié, non vérifié ou sans compte ; limites par adresse IP et par adresse email (section 5).
- **S-15, T-04** : jeton aléatoire de 143 bits, 30 minutes, usage unique, autres jetons supprimés au succès, stocké haché, jamais dans une adresse reçue (section 3) ; jeton expiré, utilisé, modifié ou empreinte présentée comme jeton : `lien_invalide`.
- **S-17** : toutes les sessions fermées après une réinitialisation (section 4.1).
- **S-54, T-39** : aucune adresse ni aucun jeton au journal ; corps de Better Auth jamais transmis.
- **S-55, T-41** : `email.reinitialisation`, limites par destinataire (section 6.4).
- **S-63** : jetons expirés purgés chaque jour (section 9).
- **S-81** : `verifierOrigine` sur les deux nouveaux `POST`.
- **S-85** : identifiant d'incident sur toute réponse `erreur`.
- **T-43** : blocage d'une heure par 2 demandes, sans rien apprendre ; ajouté à RR-12.
- **T-55** : sept points ouverts, `GET /reset-password/:token` fermé, test d'inventaire, contrôle après déploiement.
- **T-65** : liens par la porte seulement ; pages fixes d'une liste fermée (décision A).
- **Matrice des droits** : aucune ligne (« chaque utilisateur gère son propre compte », `THREATS.md` section 6). Aucune action `declarerAction`.
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3), comme en 1.1 et 1.2 : « sans session » devient « origine absente ou étrangère » ; « autre organisation » et « rôle insuffisant » sont remplacés par « point d'entrée fermé » (`GET /reset-password/:token`) et « jeton d'un autre compte ou empreinte » ; « entrée falsifiée » s'applique tel quel (`redirectTo`, jeton dans la requête, champ inconnu).
- **Tables** : aucune créée ni modifiée. `user`, `account`, `session`, `verification` sont des tables de Better Auth (RR-8).

## Dépendances nouvelles

Aucune. `isPasswordCompromised` est exporté par `better-auth/plugins` 1.7.7, déjà installé.

## Migration

Aucune. `verification.identifier` est déjà du texte ; l'empreinte change sa valeur, pas sa forme. Le dossier `drizzle/` n'est pas touché.

## Découpage en PR

1. **PR 1, réinitialisation, fermée en production** (branche `feat/1.3-mot-de-passe`) : sections 1 à 10 et 13. Après la fusion, rien de nouveau n'est joignable en production hors des pages, inertes comme `/connexion` aujourd'hui. Fusion après la preuve de la section 13.
2. **PR 2, ouverture** (branche `feat/1.3-ouverture`) : sections 11 et 12. Petite PR : la constante, ses tests, le contrôle après déploiement, les documents. Fusion après la liste de contrôle de la section 12.

## Critères d'acceptation

### PR 1

- [x] Les seuls points d'entrée ouverts de `/api/auth` sont les sept de la section 2, vérifié pour chaque point déclaré par l'instance ; `GET /reset-password/<jeton valide>` répond comme une adresse inexistante.
- [x] Demande pour un compte vérifié, un compte non vérifié et une adresse inconnue : même statut, mêmes en-têtes, même corps, 800 ms au moins ; un email `compte.reinitialisation` pour les deux comptes, aucun pour l'adresse inconnue.
- [x] La troisième demande en une heure pour une même adresse, connue ou non, depuis des adresses IP différentes : `trop_de_requetes` ; la cinquième depuis une même adresse IP, pour des adresses email différentes, aussi ; aucune adresse en clair dans `compteur_debit`.
- [x] Le lien a la forme `<origine>/lien/reinitialisation#<jeton>` ; la table `verification` ne contient ni le jeton ni `reset-password:<jeton>`, mais `reinitialisation:<empreinte>`.
- [x] Réinitialisation réussie : ancien mot de passe refusé, nouveau accepté ; toutes les sessions du compte supprimées ; notification `compte.mot_de_passe_modifie` envoyée ; autres jetons du compte supprimés ; aucun cookie posé.
- [x] Le même jeton une seconde fois, un jeton expiré (horloge ou date reculée en base), un jeton modifié, l'empreinte stockée présentée comme jeton : `lien_invalide`.
- [x] Deux réinitialisations simultanées avec le même jeton : une seule réussit.
- [x] Mot de passe de 11 caractères, compromis, ou Have I Been Pwned en panne : refusé, et le jeton sert encore ensuite.
- [x] Compte non vérifié réinitialisé : `emailVerified` vrai, connexion possible avec le nouveau mot de passe.
- [x] `redirectTo`, un champ inconnu, un jeton dans la requête, un jeton hors forme, sans `Origin` ou d'une autre origine : refusés, Better Auth jamais appelé, limite par compte jamais comptée.
- [x] En production, les sept `POST` répondent comme un chemin inexistant, octet pour octet.
- [x] Vérification d'adresse depuis un navigateur connecté : l'ancienne session est révoquée ; un vieux lien sans nouveau cookie ne déconnecte pas (section 8).
- [x] `compte.existant` et `compte.mot_de_passe_modifie` portent les liens de pages fixes ; aucun modèle n'accepte de lien de l'appelant (décision A).
- [x] La tâche quotidienne supprime les jetons expirés et garde les autres.
- [x] `npm run verifier` et `npm run test:integration` verts, sorties montrées.
- [x] Preuve de la section 13 faite et notée (développeur, 2026-10-16 et 2026-10-17, section 13.2).

### PR 2

- [ ] Hors de toute configuration, les sept `POST` se comportent en production comme en prévisualisation (test avec `estProduction` vrai).
- [ ] Contrôle après déploiement : `comptes:*` exige `403 refuse` pour les sept `POST` sans corps ni `Origin` ; un serveur factice qui crée un compte, ou qui répond autrement, le fait échouer ; en local, plus aucun contrôle n'échoue.
- [ ] Liste de contrôle de la section 12 cochée ; essai réel de la section 12.1 noté.

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code. Les numéros 1 à 22 relèvent de la PR 1, 23 à 25 de la PR 2.

### Tests d'attaque, puis unitaires (PR 1)

1. [x] **T-55, liste fermée** — `src/server/auth/points-entree.attaque.test.ts` : inventaire à sept points ouverts ; `GET /reset-password/<jeton valide>`, `GET /reset-password`, `POST /verify-password`, `POST /change-password` : `reponseInexistante()` octet pour octet, Better Auth jamais appelé.
2. [x] **S-81 et entrée falsifiée** — même fichier, deux nouveaux `POST` : `Origin` absente, étrangère, `null`, `Sec-Fetch-Site: cross-site` ; `redirectTo`, `callbackURL`, champ inconnu, jeton dans la requête (`?token=`), jeton de 23 ou 25 caractères, jeton avec `-` ou `_`, empreinte de 43 caractères, mot de passe de 129 caractères, corps de 4 Kio + 1, autre type que JSON. Refus ; Better Auth, `limiterCompte`, `jetonReinitialisationValide` et `motDePasseCompromis` jamais appelés.
3. [x] **T-07, demande** — même fichier, Better Auth simulé : réponse « compte trouvé » et « compte inconnu » donnent le même statut, les mêmes en-têtes et le même corps `{ ok: true }` ; un `Set-Cookie` de Better Auth n'est pas transmis.
4. [x] **Comptes fermés en production** — même fichier : avec `estProduction` vrai, les sept `POST` reçoivent `reponseInexistante()` ; témoin hors production.
5. [x] **Limite par adresse email** — même fichier : `limiterCompte("auth.reinitialisation_compte", <adresse normalisée>)` appelé avant Better Auth, pour toute adresse valide ; refus : `trop_de_requetes`, Better Auth jamais appelé ; en échec : `erreur` avec incident ; la connexion appelle toujours `auth.connexion_compte`.
6. [x] **Contrôles avant consommation** — `points-entree.test.ts` : ordre longueur, jeton connu, mot de passe compromis, Better Auth ; jeton inconnu : `lien_invalide` sans appel à `motDePasseCompromis` ; compromis : `mot_de_passe_compromis`, Better Auth jamais appelé ; `motDePasseCompromis` qui lève : `erreur` avec incident ; trop court : rien d'autre appelé.
7. [x] **Traduction de `/reset-password`** — même fichier : `200` → `{ ok: true }` sans cookie ; `400 INVALID_TOKEN` et `USER_NOT_FOUND` → `lien_invalide` ; `PASSWORD_TOO_SHORT`, `PASSWORD_COMPROMISED` → leurs raisons ; `429`, `5xx`.
8. [x] **Durée plancher** — même fichier, horloge simulée : la demande retenue jusqu'à 800 ms pour un succès, une limite atteinte et une entrée invalide ; `/reset-password` sans plancher.
9. [x] **Report de la 1.2, vérification** — `points-entree.test.ts` : réponse de `/verify-email` avec cookie de session : `revoquerSession` appelé avant l'envoi du nouveau cookie ; sans nouveau cookie ou refus : jamais appelé ; révocation en échec : `erreur`, aucun cookie.
10. [x] **Empreinte du jeton** — `src/server/auth/reinitialisation.test.ts` : `empreinteJetonReinitialisation("reset-password:<jeton>")` commence par `reinitialisation:`, ne contient pas le jeton, est stable, et diffère pour deux jetons.
11. [x] **Rappel d'après réinitialisation** — même fichier, dépendances simulées : notification planifiée, jetons supprimés, adresse marquée vérifiée seulement si `emailVerified` est faux ; chaque dépendance qui lève : aucune exception, une ligne `[auth]` sans identifiant ni adresse, les autres étapes faites.
12. [x] **Configuration** — `config.test.ts`, ajouts : `sendResetPassword` est `planifierEmailReinitialisation` ; `resetPasswordTokenExpiresIn` 1 800 ; `revokeSessionsOnPasswordReset` vrai ; `onPasswordReset` est `apresReinitialisation` ; `verification.storeIdentifier` : `default` `"plain"`, une seule surcharge, `reset-password:` ; `haveIBeenPwned` couvre `/reset-password`.
13. [x] **Forme du jeton de Better Auth** — `src/server/auth/jeton-reinitialisation-better-auth.test.ts` : `generateId(24)` de la version installée rend 24 caractères `[A-Za-z0-9]` (comme le test de l'adresse IP de la 1.1 : une mise à jour qui le change fait échouer la suite).
14. [x] **Emails** — `emails.test.ts` : `planifierEmailReinitialisation` rend la main sans envoyer, ignore `url` même vers un autre site, ne lève jamais ; ordre des limites de la section 6.4 pour les deux nouveaux modèles ; la notification ne vérifie pas les limites par destinataire ; une limite atteinte écrit une ligne `[email]` qui nomme la limite, sans adresse ni jeton.
15. [x] **Modèles et liens** — `modeles.test.ts` : brique `jetonReinitialisation` ; `lienFragment` par table type → brique (un jeton de vérification refusé pour `reinitialisation`, et l'inverse) ; `lienPage` : liste fermée, toute page hors liste refusée (dont `connexion/`, `Connexion`, `../connexion`, `mot-de-passe-oublie?x=1`, une adresse complète), adresse toujours sur l'origine de la configuration, aucune requête ni fragment ; textes des trois modèles ; aucun modèle n'a de paramètre de lien.
16. [x] **Limites** — `limites.test.ts` : trois limites `auth.reinitialisation*` et `email.reinitialisation`, sous 24 h ; aucune règle partagée entre deux limites `auth.*` ; `reglesBetterAuth()` couvre exactement les chemins ouverts qui passent par Better Auth ; somme `email.compte` + `email.reinitialisation` sous `email.application`.
17. [x] **Pages** — `inventaire.test.ts` : `/mot-de-passe-oublie` appelle `redirigerSiConnecte` ; `/lien/reinitialisation` ne lit pas la session. `appel-auth.test.ts` : raisons de la réinitialisation reconnues.

### Tests d'intégration, avec base (PR 1)

18. [x] `src/server/db/reinitialisation.integration.test.ts` (par `traiterRequeteAuth`, vraie instance, transport `memoire`, planificateur synchrone, Have I Been Pwned simulé) : compte vérifié, compte non vérifié, adresse inconnue : réponses identiques, 800 ms au moins, emails attendus ; ligne `verification` à l'empreinte, sans le jeton ; réinitialisation : mot de passe changé, **toutes** les sessions supprimées (deux sessions ouvertes avant), notification, autres jetons supprimés, compte non vérifié devenu vérifié ; second usage : `lien_invalide` ; jeton expiré (`expires_at` reculé) : `lien_invalide` ; empreinte présentée comme jeton : refusée ; mot de passe compromis puis valable avec le même jeton : succès.
19. [x] Même fichier, **concurrence** : deux `POST /reset-password` simultanés avec le même jeton et deux mots de passe : une seule réussite, le mot de passe en base est celui de la réussite.
20. [x] Même fichier, **limites** : trois demandes pour une même adresse depuis trois adresses IP, la troisième refusée, pour une adresse connue et une inconnue ; `compteur_debit` sans valeur en clair.
21. [x] `src/server/db/connexion.integration.test.ts`, ajout : vérification d'une seconde adresse depuis un navigateur connecté : ancienne session supprimée, nouvelle lisible.
22. [x] `src/server/db/comptes.integration.test.ts` : `purgerJetonsExpires` supprime une ligne expirée, garde une ligne valable ; `supprimerJetonsReinitialisation` ne supprime que les lignes `reinitialisation:` du compte visé ; `marquerAdresseVerifiee` ; nouvelle étape dans `etapes.test.ts`.

### Tests de bout en bout (PR 1)

- [x] **Parcours UC-03** — `e2e/mot-de-passe.spec.ts` (ordinateur-1280 et mobile-390) : depuis `/connexion`, « Mot de passe oublié ? » ; demande ; email lu dans le dossier du transport `fichier` ; lien ouvert, fragment effacé ; aucune requête du navigateur ne porte le jeton dans son adresse ; mot de passe compromis refusé, puis nouveau mot de passe accepté ; connexion avec le nouveau ; un second contexte connecté avant la réinitialisation voit `/compte` « introuvable » ; email de notification présent.
- [x] **T-07** — même fichier : adresse inconnue, compte non vérifié et compte vérifié : même écran, même corps de réponse.
- [x] **Lien réutilisé ou modifié** — même fichier : « Ce lien n'est plus valable » et le lien vers une nouvelle demande.
- [x] **T-55 et T-04 sur le site construit** — `e2e/auth.attaque.spec.ts` : `GET /api/auth/reset-password/<jeton>` identique à `/api/auth/n-existe-pas` ; trois demandes pour une même adresse avec des `X-Forwarded-For` différents : la troisième reçoit `trop_de_requetes`.
- [x] **Contrôle après déploiement** — `e2e/controle-deploiement.spec.ts` : `comptes:*` à sept `POST` ; `auth:identique` avec `/reset-password/<jeton>` ; nouvelles pages contrôlées.

### Tests de la PR 2

23. [ ] `points-entree.attaque.test.ts` : avec `estProduction` vrai, les sept `POST` se comportent comme hors production (le test « fermés en production » est remplacé) ; sans `Origin` : `403 refuse`, ni Better Auth, ni `limiterCompte`, ni lecture du corps.
24. [ ] `e2e/controle-deploiement.spec.ts` : `comptes:*` passe sur un serveur qui répond `403 refuse` aux sept `POST` ; échoue s'il répond `404`, `200`, un autre corps, ou s'il reçoit un corps, une `Origin`, un cookie ou `Authorization` (serveur factice qui vérifie ce qu'il reçoit) ; en local, aucun contrôle n'échoue.
25. [ ] Inventaire : le mot `COMPTES_OUVERTS_EN_PRODUCTION` n'apparaît plus dans `src/`.

### Vérifications manuelles (développeur)

- [x] PR 1 : preuve sur la prévisualisation (section 13.2).
- [ ] PR 2 : liste de contrôle (section 12), essai réel et journaux (section 12.1).

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `src/server/auth/points-entree.ts` | Deux points ouverts, contrôles avant consommation, `limiterCompte(nom, adresse)`, `verifier` de `/verify-email` ; PR 2 : constante retirée |
| `src/server/auth/gestionnaire.ts` | Liaisons de `jetonReinitialisationValide`, `motDePasseCompromis`, `limiterCompte` |
| `src/server/auth/config.ts` | `sendResetPassword`, durée, révocation, `onPasswordReset`, `verification.storeIdentifier` |
| `src/server/auth/reinitialisation.ts` | Nouveau : empreinte du jeton, `apresReinitialisation` |
| `src/server/auth/emails.ts` | `planifierEmailReinitialisation`, notification, limites par modèle |
| `src/server/email/modeles.ts`, `src/textes/emails.ts` | Deux modèles, `compte.existant` revu, brique `jetonReinitialisation`, `lienFragment` par type, `lienPage` |
| `src/server/debit/limites.ts`, `src/server/debit/better-auth.ts` | Quatre limites, règles des deux chemins |
| `src/server/db/comptes.ts`, `src/server/taches/etapes.ts` | `supprimerJetonsReinitialisation`, `marquerAdresseVerifiee`, `purgerJetonsExpires`, étape `jetons_expires` |
| `src/schemas/compte.ts` | Schémas de la demande et de la réinitialisation |
| `src/app/(public)/mot-de-passe-oublie/page.tsx`, `src/app/lien/reinitialisation/page.tsx`, `src/components/compte/*`, `src/textes/compte.ts` | Pages, formulaires, textes ; lien sur `/connexion` |
| `src/server/actions/inventaire.test.ts` | Pages de la 1.3 |
| `e2e/*.spec.ts`, `playwright.config.ts` | Nouveaux tests ; `mot-de-passe-oublie` dans `mobile-390` |
| `scripts/controle-deploiement.mjs` | Sept `POST` (PR 1), `403 refuse` (PR 2), nouvelles pages |
| `CLAUDE.md` (règle 17, contrôle, comptes), `docs/THREATS.md` (T-65, RR-12, RR-13, 7.2, 10), `docs/STRUCTURE.md` 7 (`auth/config.ts` importe `db/comptes.ts`), `docs/PLAN.md`, `docs/features/controle-deploiement.md`, `docs/features/connexion.md` (limite close), `docs/CONFIGURATION.md` | Documents |

## Reporté

- **1.4** : test « la double authentification reste exigée après une réinitialisation » (T-04, UC-03 « Abus ») ; stockage des codes dans `verification`.
- **1.5** : affichage des sessions ; la réinitialisation les ferme toutes dès la 1.3. **Correction du nom saisi par un tiers** : le compte récupéré par une réinitialisation garde le nom choisi par le pré-propriétaire (section 4.3, décision B) ; la 1.5 donne à l'utilisateur le moyen de le corriger.
- **1.6 ou paramètres du compte** : changement du mot de passe depuis une session (`/change-password`), avec `haveIBeenPwned` et la même révocation.
- **8.1** : signalement des lignes `[email] ... "limite"` et `[auth] error` au service de suivi.

## Limites connues

- **Blocage de la réinitialisation par un tiers** : 2 demandes bloquent une adresse une heure, renouvelables (section 5), sans rien apprendre ; ajouté à RR-12.
- **Budgets d'emails épuisables** (RR-13, décision C) : depuis quelques adresses IP, un attaquant épuise `email.compte` (vérifications) en un jour ; `email.reinitialisation` en est séparé, et inversement. Avec beaucoup d'adresses IP, il épuise aussi `email.reinitialisation` (50) : plus aucun lien ne part jusqu'à la fin de la fenêtre. Surveillance et conduite : section 12.3.
- **Révocation en échec après le changement** : le mot de passe est changé, les sessions peuvent vivre ; la réponse est `erreur` ; une nouvelle réinitialisation les ferme (section 4.1).
- **Nom choisi par le pré-propriétaire** : gardé par le compte que le titulaire récupère (section 4.3), jusqu'à sa correction en 1.5 (« Reporté »).
- **Lien dans « Messages envoyés »** (RR-9) : 30 minutes, usage unique, supprimé au premier succès.
- **Durée au-delà du plancher** : une base lente rend l'écart mesurable, comme en 1.1 et 1.2.
- **Deux appels à Have I Been Pwned** par réinitialisation réussie (section 3.3).

## Décisions

Prises par le développeur le 2026-10-16.

- **A. Liens vers des pages fixes dans les emails** (section 6.3) : `lienPage` accepté. Liste fermée de deux pages (`/connexion`, `/mot-de-passe-oublie`), écrite dans le modèle ; adresse toujours construite sur l'origine de l'application ; jamais de page ni de paramètre fournis par l'appelant ; un test prouve qu'une page hors de la liste est refusée. Règle 17 de `CLAUDE.md` et parade de T-65 réécrites.
- **B. Réinitialisation d'un compte non vérifié** (section 4.3) : le succès marque l'adresse vérifiée. La correction du nom saisi par un tiers est reportée à la 1.5 (« Reporté »).
- **C. Budget `email.reinitialisation`** (50 par 24 h) et **RR-13** acceptés (section 6.4). Surveillance des lignes `[email] ... "limite"` et conduite à tenir : section 12.3.
- **D. Ouverture en production différée.** La PR 2 (#52, sections 11 et 12) reste en brouillon et n'est fusionnée qu'après la page `/donnees-personnelles`, publiée en production, et la formalité auprès de l'ARTCI (loi n° 2013-450 relative à la protection des données à caractère personnel) vérifiée ; ces deux conditions s'ajoutent à la liste de contrôle de la section 12. Jusque-là, les comptes restent fermés en production. Base de production vérifiée le 2026-10-18 : 9 migrations, 11 tables, droits conformes, aucun compte (`docs/PLAN.md`, jalon 1).

## Décisions par défaut

Appliquées par l'assistant le 2026-10-16, selon sa recommandation, sauf avis contraire du relecteur.

1. **Deux points ouverts**, `GET /reset-password/:token` toujours fermé (section 2).
2. **Réponse unique** `{ ok: true }` en 800 ms au moins pour toute demande (section 2.3).
3. **Jeton de 30 minutes** au lieu d'une heure (section 3.1).
4. **Empreinte au préfixe `reinitialisation:`**, limitée à la réinitialisation (section 3.2).
5. **Contrôles avant consommation** : longueur, jeton connu, mot de passe compromis ; Better Auth vérifie une seconde fois (section 3.3).
6. **Toutes les sessions fermées**, autres jetons supprimés, rappel qui ne lève jamais (section 4).
7. **Budget `email.reinitialisation`** de 50 par 24 h, séparé d'`email.compte` (section 6.4).
8. **Notification sans limite par destinataire** (section 6.4).
9. **Limites** : 4 demandes par heure par adresse IP, 2 par heure par adresse email, 6 réinitialisations par 15 minutes par adresse IP (section 5).
10. **Aucune connexion automatique** après la réinitialisation (« Alternatives écartées »).
11. **Report de la 1.2 traité ici** (section 8).
12. **Purge quotidienne des jetons expirés** (section 9).
13. **Deux PR**, la seconde après une liste de contrôle (« Découpage en PR »).
14. **`EMAIL_DESTINATAIRES_AUTORISES` vérifiée absente à la main**, sans changer la validation : la refuser en production ferait échouer la construction pour une variable sans effet.
15. **Retour arrière par « Instant Rollback »**, puis PR de retour ; aucune variable d'interruption (section 12.2).

## Notes de l'implémentation

### PR 1, le 2026-10-16

Branche `feat/1.3-mot-de-passe` : commits `docs(1.3): fiche`, `docs(1.3): décisions`, `test(1.3)` (phase rouge), `feat(1.3)`.

**Phase rouge** (commit `test(1.3)`). Unitaires : 131 tests en échec dans 9 fichiers, et 3 fichiers non chargés (`config.test.ts`, `reinitialisation.test.ts`, `jeton-reinitialisation-better-auth.test.ts` : module `src/server/auth/reinitialisation.ts` absent). Chaque échec tient à l'absence du code : points d'entrée fermés (réponse inexistante au lieu de 200, 400, 403 ou 429), modèles, briques, `lienPage`, limites, étape de la tâche et rappels absents. Intégration (sur `dev`) : 2 fichiers non chargés (le banc importe le module absent) et 1 échec (`purgerJetonsExpires` absente). Bout en bout (site construit avant le code, tests de `src/` remisés le temps de la construction, base jetable) : 65 échecs, 378 réussis (pages `/mot-de-passe-oublie` et `/lien/reinitialisation` absentes, points d'entrée fermés, contrôle après déploiement sans les nouveaux cas).

**Passaient avant le code, et pourquoi** : les chemins qui restent fermés (`GET /reset-password/<jeton>`, `/verify-password`, `/change-password`, `/forget-password`, GET des points ouverts) et les deux `POST` fermés en production : garde-fous de non-régression ; « la limite de la demande n'est jamais comptée » ailleurs, et « rien n'est révoqué » quand une vérification ne pose pas de cookie (la dépendance ou la révocation n'existait pas) ; « une erreur ne nomme aucune limite » (comportement existant, figé) ; « aucun paramètre de lien » des trois modèles existants ; les raisons de la réinitialisation dans `appelerAuth` (déjà dans la liste fermée ; le type `PointAuth`, lui, refusait les chemins : `npm run typecheck` échouait) ; `RANGS` à 24 (outillage). Des tests passaient à vide avant le code (fonction `lienPage` absente qui lève, point d'entrée fermé qui répond vite et ne révoque rien) : un témoin leur a été ajouté avant le commit de la phase rouge (une page de la liste acceptée, un statut 200 attendu), et ils échouaient ensuite.

**Tests modifiés, sans changer ce qu'ils prouvent** :

- Listes des fiches précédentes : cinq points ouverts deviennent sept (`points-entree.attaque.test.ts`, `better-auth.test.ts`, `auth.attaque.spec.ts`), quatre étapes de la tâche au lieu de trois (`quotidienne.test.ts`), cinq modèles au lieu de trois (`modeles.test.ts`), 24 rangs d'adresses de bout en bout au lieu de 18 (`nettoyer-comptes.spec.ts`), 28 requêtes par passage du contrôle au lieu de 23 (`controle-deploiement.spec.ts`).
- `auth.attaque.spec.ts` : `/request-password-reset` et `/reset-password` sortent de la liste des chemins fermés en `GET` et `POST` (ouverts en `POST` par cette fiche) ; leur `GET` reste vérifié fermé avec les autres points ouverts.
- `points-entree.test.ts` : `/verify-email` sort de « la révocation de la connexion n'est jamais appelée » ; c'est le report de la 1.2 traité ici (section 8), couvert par ses propres tests.
- `modeles.test.ts` : `compte.existant` porte désormais deux liens de pages fixes (décision A) ; son test « aucun lien » devient « seuls liens, les deux pages fixes sur l'origine », et le texte attendu est celui de la section 6.2. La reconnaissance des briques admises gagne `jetonReinitialisation`.
- `inventaire.test.ts` : la règle `redirigerSiConnecte` couvre aussi `(public)/mot-de-passe-oublie`.
- Appels de `creerTraitementAuth` des tests de la 1.1 et de la 1.2 (`journal.attaque.test.ts`, `mots-de-passe.attaque.test.ts`, bancs) et `LIMITES_TEST` (`outils-test/email.ts`) : nouvelles dépendances et limites exigées par le type, sans effet.
- `connexion.integration.test.ts` : banc de 12 adresses au lieu de 10 (deux comptes du nouveau test).
- `comptes.integration.test.ts`, purge des jetons expirés (après l'implémentation) : le test passait seul et échouait une fois sur deux dans `npm run test:integration`. Better Auth supprime lui-même toute ligne expirée de `verification` à chaque recherche de jeton (`findVerificationValue`) ; lancé en parallèle, `reinitialisation.integration.test.ts` effaçait la ligne expirée avant la purge, qui comptait alors 0. Les lignes sont désormais créées et purgées dans une transaction annulée ensuite, invisible des autres connexions ; `creerPurgeJetons` accepte une transaction. Mêmes assertions (au moins une ligne supprimée, l'expirée absente, la valable présente), plus « rien n'est laissé sur `dev` ».

**Écarts avec la fiche** :

- La limite de la demande passe par une dépendance propre, `limiterReinitialisation(adresse)`, et non par `limiterCompte(nom, adresse)` : la signature de la 1.2 et ses tests restent intacts.
- `supprimerJetonsReinitialisation` et `marquerAdresseVerifiee` vivent dans `src/server/db/reinitialisation.ts`, et non dans `db/comptes.ts` : la règle ESLint U réserve `db/comptes.ts` à la tâche quotidienne. `purgerJetonsExpires`, appelée par la tâche, est bien dans `db/comptes.ts`. Leurs tests sont dans `reinitialisation.integration.test.ts`.
- Le test 13 (forme du jeton) lance la vraie version de Better Auth sur son adaptateur en mémoire (`better-auth/adapters/memory`, déjà installé) : il fige la forme du jeton et vérifie que notre réglage `storeIdentifier` ne stocke que l'empreinte, sans base.
- Le lien « Mot de passe oublié ? » est placé juste sous le cadre du formulaire de connexion, et non dans le formulaire : il ne s'intercale pas entre le mot de passe et le bouton dans l'ordre des tabulations.
- La ligne `[email]` d'une limite atteinte nomme la limite (section 6.4), pour la surveillance de la décision C.

**Vérifications** : `npm run verifier` vert (format, lint, typecheck, 61 fichiers et 2 196 tests unitaires, construction, 443 tests de bout en bout sur la base jetable, aucun sauté, ports 3000 et 3101 libres) ; `npm run test:integration` sur `dev` : 23 fichiers, 210 réussis et 1 échec attendu (déjà présent), deux passages de suite.

**À faire par le développeur avant la fusion** : la preuve de la section 13 sur la prévisualisation de la branche.
