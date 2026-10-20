# Fonctionnalité : connexion et déconnexion

Statut : validée le 2026-10-14 ; implémentée le 2026-10-14 (« Notes de l'implémentation ») ; essai sur la prévisualisation à faire par le développeur.

Jalon 1, fonctionnalité 1.2 de `docs/PLAN.md`. Taille M. Cas d'utilisation : UC-02 (sans l'étape 3, double authentification, qui vient en 1.4). Exigences : F-002 (connexion, déconnexion), S-11, S-17 (partie session), S-54, S-63, S-81, S-82, S-85. Menaces : T-01, T-03, T-07, T-17, T-39, T-43, T-55.

## Contexte

Depuis la 1.1, un visiteur crée un compte et le vérifie ; la vérification ouvre une session (UC-01, étape 5). Mais un utilisateur qui ferme son navigateur ou dont la session expire ne peut plus revenir, et personne ne peut fermer sa session (UC-02, F-002).

Aujourd'hui :

- `src/server/auth/points-entree.ts` (1.1) n'ouvre que trois points d'entrée de `/api/auth` : `POST /sign-up/email`, `POST /verify-email`, `POST /send-verification-email`. Tout le reste, dont `/sign-in/*`, `/sign-out` et `/get-session`, répond comme une adresse inexistante (T-55). En production, les trois sont fermés jusqu'à la 1.3 (`INSCRIPTION_OUVERTE_EN_PRODUCTION`, décision 1 de la 1.1).
- `lireSession` (`src/server/auth/session.ts`) relit la session en base à chaque appel, sans cache dans un cookie, et refuse un utilisateur non vérifié.
- Les sessions suivent les réglages par défaut de Better Auth 1.7.7 : 7 jours, prolongées d'autant à chaque lecture survenant plus d'un jour après la précédente prolongation (`updateAge`), lu dans `node_modules/better-auth/dist/context/create-context.mjs`, lignes 147 à 149.
- Toute page de `(app)/` exige une organisation active et une adhésion (`lirePourPage`). Aucun utilisateur n'a d'organisation avant la 2.1 : un utilisateur connecté n'a aucune page où arriver.

Points reportés à la 1.2 par les fiches précédentes, tous traités ici :

| Point | Origine | Section |
|---|---|---|
| Dette : identifiant d'incident absent de la réponse d'erreur de `/api/auth` | `PLAN.md` section 7 ; `inscription.md`, notes de la PR 2, décision 8 | 6 |
| Dette : le modèle `compte.existant` invite à se connecter alors qu'aucune page de connexion n'existe | `inscription.md` section 7, notes | 7 |
| Limite de connexion par adresse IP et par compte, sur la base « toutes les tentatives comptent » | `inscription.md` section 3.5 ; `DESIGN.md` 3.1 | 3 |
| Renvoi automatique de la vérification à la connexion d'un compte non vérifié (`sendOnSignIn`) | `inscription.md` « Reporté » | 2.3 |
| Lieu des évènements de compte (création, vérification, connexion) ; « connexions sensibles » de S-70 | `inscription.md` « Reporté » ; `SPEC.md` section 8, point 5 ; `journal-audit.md` décision 5 | 9 |
| `/get-session` « si le navigateur en a besoin » | `inscription.md` section 2.3 | 1.2 |
| Gabarit de l'application vérifié dans un navigateur connecté, à 390 et 1280 px | `socle-interface.md` décision 27 ; `PLAN.md` 1.2 | 8.3 |

## Problème

- Un utilisateur vérifié ne peut pas se reconnecter, ni se déconnecter.
- Better Auth dit si une adresse a un compte : `401 INVALID_EMAIL_OR_PASSWORD` pour une adresse inconnue ou un mauvais mot de passe, mais `403 EMAIL_NOT_VERIFIED` pour un compte non vérifié dont le mot de passe est juste (`node_modules/better-auth/dist/api/routes/sign-in.mjs`, `signInEmail`). Le corps de la connexion réussie contient aussi le jeton de session en clair (`token`), lisible par un script de la page (S-82).
- Sa limitation ne compte que par adresse IP : un attaquant qui dispose de nombreuses adresses essaie sans fin les mots de passe d'un même compte (T-01).
- `POST /sign-out` attrape lui-même une panne de la base pendant la suppression de la session, efface le cookie et répond succès (`sign-out.mjs`) : l'utilisateur se croit déconnecté alors que sa session vit encore en base, et un cookie volé reste utilisable (T-03).
- Une session prolongée à chaque lecture n'a pas de fin si l'utilisateur reste actif. De plus, une page (composant serveur) ne peut pas réécrire un cookie : la base prolonge la session, mais pas le cookie du navigateur, qui expire à sa date d'origine.

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Deux points d'entrée de plus | `src/server/auth/points-entree.ts` | `POST /sign-in/email`, `POST /sign-out` dans la liste fermée ; `/get-session` reste fermé |
| Limite par compte | `src/server/debit/limites.ts`, `src/server/auth/gestionnaire.ts` | `auth.connexion_compte`, comptée par notre gestionnaire avant Better Auth |
| Session | `src/server/auth/config.ts` | 7 jours, sans prolongation, cookie aligné (décision 3) |
| Identifiant d'incident | `points-entree.ts`, `journal.ts`, `src/components/compte/` | Toute réponse `erreur` porte l'incident écrit au journal technique |
| Zone « compte » | `src/app/(compte)/`, `src/server/actions/exposer.ts` | Pages d'un utilisateur connecté, sans organisation (décision 2) |
| Pages | `src/app/(public)/connexion/`, `src/app/(compte)/compte/` | Formulaire, page d'arrivée, bouton « Se déconnecter » |
| Purge | `src/server/db/comptes.ts`, `src/server/taches/etapes.ts` | Sessions expirées, par la tâche quotidienne (S-63) |

### 1. Les points d'entrée (T-55, S-81, S-82)

#### 1.1 Ouverts en 1.2

| Méthode et chemin | Pourquoi | Protections propres |
|---|---|---|
| `POST /sign-in/email` | UC-02, étapes 1, 2 et 4 | Origine, schéma strict, limite par adresse IP et par compte, durée plancher, réponse uniforme, corps de Better Auth jamais renvoyé |
| `POST /sign-out` | F-002, déconnexion | Origine, corps `{}` strict, suppression vérifiée en base |

Ils suivent les étapes de la section 2.2 de `inscription.md` (origine, taille et type, schéma, requête interne, réponse normalisée), avec ces particularités :

- **`/sign-in/email`.** Schéma `{ email, motDePasse }` strict (`src/schemas/compte.ts`) : `rememberMe` et `callbackURL` sont refusés (aucune session courte, aucune redirection choisie par la requête, donc aucune redirection ouverte). `email` : la règle d'adresse de la porte (`schemaAdresse`) ; `motDePasse` : 1 à 128 caractères, sans contrôle de longueur minimale (un mot de passe trop court reçoit la même réponse qu'un mauvais, section 2). La requête interne ne reprend que `x-forwarded-for` et `user-agent`, comme en 1.1.
- **Réponse de la connexion.** `{ ok: true }` et les seuls en-têtes `Set-Cookie` de Better Auth. Le corps de Better Auth, qui contient `token` (le jeton de session) et l'utilisateur, n'est jamais transmis : le jeton ne vit que dans le cookie `HttpOnly` (S-82). Une réponse `200` qui ne pose pas le cookie de session, ou qui porte `twoFactorRedirect` (extension `twoFactor`, inatteignable avant la 1.4, aucun utilisateur ne pouvant l'activer), devient `erreur` : fermé par défaut, la 1.4 ajoute cette branche.
- **`/sign-out`.** Corps `{}` exigé en JSON (le contrôle de type et la taille restent ceux de la 1.1). La requête interne reprend en plus l'en-tête `cookie` de la requête reçue, seul point d'entrée à le faire. Suppression vérifiée, section 4.2.

#### 1.2 Restent fermés

| Points d'entrée | Jusqu'à |
|---|---|
| `/get-session` | **Toujours, sauf fiche contraire** (décision 1). Son corps contient `session.token`, le jeton en clair (`parseSessionOutput` ne le retire pas) : l'ouvrir rendrait le jeton lisible par tout script de la page, ce que `HttpOnly` interdit (S-82). Les pages lisent la session côté serveur (`lireSession`) ; le navigateur n'en a pas besoin |
| `/sign-in/social`, `/sign-in/*` autres | Une fiche qui en a besoin |
| `/request-password-reset`, `/reset-password/*` | 1.3 |
| `/two-factor/*` | 1.4 |
| `/list-sessions`, `/revoke-session*`, `/revoke-other-sessions` | 1.5 |
| `/organization/*` | Toujours (T-55) |

Le test d'inventaire de la 1.1 (`points-entree.attaque.test.ts`) passe à cinq points ouverts ; il échoue si un autre répond autrement qu'une adresse inexistante.

#### 1.3 En production : fermés jusqu'à la 1.3

**Retenu** (décision par défaut 1) : la connexion et la déconnexion restent fermées en production, comme l'inscription. La constante `INSCRIPTION_OUVERTE_EN_PRODUCTION` devient `COMPTES_OUVERTS_EN_PRODUCTION` : elle porte déjà sur tous les points ouverts (le gestionnaire teste la production avant de chercher le point), son nom le dit. La PR de la 1.3 la retire.

Pourquoi : l'inscription étant fermée en production, aucun compte n'y existe ; ouvrir la connexion n'y servirait à personne et exposerait une surface de plus (essais de mots de passe, mesure des durées). Les pages `/connexion` et `/compte` existent en production comme `/inscription` aujourd'hui : un envoi y reçoit la réponse inexistante, et le formulaire affiche « Une erreur est survenue. » ; sans incident, puisqu'aucun n'est écrit.

### 2. Indiscernabilité (T-07, S-11)

#### 2.1 Trois cas, une réponse

| Situation | Better Auth répond | Notre réponse |
|---|---|---|
| Adresse inconnue | `401 INVALID_EMAIL_OR_PASSWORD`, après un hachage du mot de passe saisi | `401 { ok: false, raison: "identifiants_incorrects" }` |
| Mauvais mot de passe | `401 INVALID_EMAIL_OR_PASSWORD`, après la vérification du hachage | Identique |
| Compte non vérifié, bon mot de passe | `403 EMAIL_NOT_VERIFIED` | Identique |
| Compte sans mot de passe (aucun aujourd'hui) | `401`, après un hachage | Identique |
| Limite atteinte (par adresse IP ou par compte) | `429`, ou refus de notre compteur | `429 { ok: false, raison: "trop_de_requetes" }`, pour toute adresse, connue ou non |

**Même réponse** : même statut, mêmes en-têtes, même corps, octet pour octet, aucun `Set-Cookie`. La traduction ne regarde que le statut et le code de Better Auth, et les trois codes mènent à la même fonction de réponse.

**Message affiché** (`src/textes/compte.ts`) : « Email ou mot de passe incorrect », mot pour mot `DESIGN-SYSTEM.md` (« Connexion échouée »). Sous le formulaire, une aide fixe, affichée quel que soit le résultat : « Si vous venez de créer votre compte, confirmez d'abord votre adresse. », suivie du lien « Recevoir un nouveau lien de confirmation » (`/connexion/nouveau-lien`, formulaire de renvoi de la 1.1). Rien ne distingue les trois cas. Corrigé à l'implémentation : la première version de la fiche plaçait l'aide dans le message d'échec, ce qui s'écartait du texte imposé.

#### 2.2 Même durée

- **Better Auth égalise déjà le travail coûteux** : une adresse inconnue fait hacher le mot de passe saisi (`await ctx.context.password.hash(password)`), un compte connu le fait vérifier ; même algorithme, même coût. Le compte non vérifié s'arrête après la vérification, comme un mauvais mot de passe.
- **Durée plancher de 800 ms** (`DUREE_PLANCHER_MS`, 1.1) sur `POST /sign-in/email`, pour toute réponse : identifiants incorrects, limite atteinte, entrée invalide et succès. Elle couvre l'écart restant (une lecture de comptes en plus pour une adresse connue) et notre propre comptage par compte (section 3).
- **Limite connue** : au-delà du plancher (base lente), l'écart redevient mesurable ; borné par les limites de la section 3 (comme en 1.1).

#### 2.3 Aucun email à la connexion d'un compte non vérifié

`sendOnSignIn` reste à `false` (défaut, figé par `config.test.ts`). L'envoyer créerait un effet de bord propre au compte non vérifié : un email part seulement si l'adresse a un compte et que le mot de passe est juste, ce qu'observe quiconque contrôle la boîte, et cela ouvre une voie d'envoi de plus vers la victime d'une pré-appropriation d'adresse (`inscription.md`, « Limites connues »). Le vrai titulaire passe par le lien « Recevoir un nouveau lien de confirmation », qui répond pareil pour toute adresse (1.1).

### 3. La limite des tentatives (S-11, T-01, T-43)

Toutes les tentatives comptent, réussies ou non (`DESIGN.md` 3.1, corrigée en 1.1). Deux compteurs, sur `compteur_debit`, valeurs dans `limites.ts` seulement (règle 15) :

| Nom | Maximum | Fenêtre | Par | Où |
|---|---|---|---|---|
| `auth.connexion` | 10 | 15 min | Adresse IP | Better Auth (`customRules` construites par `reglesBetterAuth()`, chemin `/sign-in/email`), comme les limites de la 1.1 |
| `auth.connexion_compte` | 5 | 15 min | Adresse email saisie | Notre gestionnaire, par `verifierDebit`, après le schéma et avant l'appel à Better Auth |
| `auth.deconnexion` | 20 | 1 min | Adresse IP | Better Auth, chemin `/sign-out` (une règle par chemin ouvert, et deux limites `auth.*` n'ont jamais la même règle, invariants de la 1.1) |

- **Par compte, toute adresse valide compte**, qu'elle ait un compte ou non : sinon la sixième tentative dirait si l'adresse existe (T-07). Clé : l'adresse normalisée comme pour `email.destinataire` (0.7), passée par `cleCompteur` ; seule l'empreinte HMAC est stockée (règle 15). Nouvelle valeur de `Limite.par` : `"adresse_email"`.
- **Ordre.** Notre compteur par compte, puis celui de Better Auth par adresse IP (au début de `auth.handler`). Les deux sont hors de toute transaction (règle 15). Base en panne pendant le comptage : `erreur`, fermé par défaut.
- **Injection de la dépendance.** `points-entree.ts` reste sans import de `server/debit/` : la fabrique reçoit `limiterCompte(adresse): Promise<boolean>` (dépendance de `creerTraitementAuth`), que `gestionnaire.ts` lie à `verifierDebit`. Les tests unitaires la remplacent par une fausse.
- **Effet sur T-01.** Au plus 5 essais par quart d'heure sur un compte, quelle que soit la provenance (480 par jour), et 10 par quart d'heure par adresse IP. Avec 12 caractères au moins et les mots de passe compromis refusés (S-10), une recherche exhaustive est hors de portée.
- **Effet sur T-43, accepté (priorité faible).** Quiconque connaît une adresse peut en bloquer la connexion 15 minutes, et renouveler ce blocage toutes les 15 minutes, au prix de 5 requêtes. Le blocage est temporaire et limité, comme le demande T-43 ; le bon mot de passe est refusé pendant ce temps (critère de T-01). Une limite sur les seuls échecs l'atténuerait, mais demanderait de lire le compteur avant et de l'incrémenter après Better Auth : écartée (« Alternatives écartées »).

### 4. La session (S-17, S-82, T-03)

#### 4.1 Durée et renouvellement

```ts
session: {
  expiresIn: 7 * 24 * 60 * 60,  // 7 jours
  disableSessionRefresh: true,  // jamais prolongée
},
```

**Retenu (décision 3)** : une session dure 7 jours à partir de la connexion, **sans prolongation**. Au bout de 7 jours, l'utilisateur se reconnecte, même s'il est actif.

- **Durée absolue.** Une session volée cesse au plus tard 7 jours après la connexion (T-03). Avec la prolongation par défaut, un usage régulier, légitime ou non, la ferait vivre sans fin.
- **Cookie aligné sur la base.** Le cookie reçoit `Max-Age` égal à `expiresIn` à la connexion ; la base, `expiresAt` à la même échéance. Sans prolongation, rien ne les fait diverger. Avec elle, une page (composant serveur) prolongerait la base sans pouvoir réécrire le cookie (`nextCookies` ne pose un cookie que dans une action serveur ou une route).
- **Aucune écriture pendant une lecture de page.** `lireSession` ne modifie plus jamais la ligne de session.
- **Cache de session dans un cookie** : désactivé (défaut, `cookieCache` absent), figé par `config.test.ts`. La session est relue en base à chaque requête : une session supprimée est refusée dès la requête suivante.
- **`freshAge`** (âge d'une session « récente », 1 jour par défaut) : laissé à la 1.6.

#### 4.2 Déconnexion vérifiée côté serveur

`POST /sign-out` passe par Better Auth, qui supprime la ligne de session et efface le cookie. Comme Better Auth avale une panne de la base pendant la suppression, notre gestionnaire **relit la session** avec le cookie reçu (`auth.api.getSession`, appel serveur, hors routeur) :

- session introuvable : `{ ok: true }` et les `Set-Cookie` d'effacement ;
- session encore lisible, ou lecture en échec : `500 { ok: false, raison: "erreur", incident }`, **sans** effacer le cookie. L'utilisateur voit l'erreur et sait que sa session n'est pas fermée, au lieu d'une déconnexion apparente.

Sans cookie, ou avec un cookie inconnu : `{ ok: true }` (rien à fermer). Après une déconnexion réussie, le navigateur charge `/connexion` par une navigation complète, qui vide le cache du routeur de Next.js.

#### 4.3 Cookie

Réglages de la 1.1 inchangés : `HttpOnly`, `SameSite=Lax`, `Secure` en `https` (préfixe `__Secure-`, constaté sur la prévisualisation de la 1.1). La connexion crée toujours une nouvelle session avec un nouveau jeton : un jeton posé avant la connexion n'est jamais repris (fixation de session, T-03).

**Reconnexion depuis un navigateur connecté** (correctif de la 1.2, constat sur la prévisualisation du 2026-10-16). Lu dans `node_modules/better-auth/dist/api/routes/sign-in.mjs` : `signInEmail` crée la nouvelle session (`createSession`) sans lire ni révoquer celle du cookie reçu, que notre gestionnaire ne lui transmet d'ailleurs pas ; l'ancienne restait valide en base jusqu'à son terme. Retenu : après une connexion **réussie**, notre gestionnaire révoque en base la session du cookie reçu (`revoquerSession`, `internalAdapter.deleteSession` du jeton du cookie), puis renvoie le nouveau cookie. Une connexion échouée ne révoque rien : une faute de frappe ne déconnecte pas, et la révocation ne dépend jamais de l'existence d'un compte. Révocation en échec : `erreur` avec incident, aucun cookie ; la nouvelle session, dont le jeton n'a jamais quitté le serveur, reste inutilisable et disparaît à la purge des sessions expirées. Écartées : révoquer avant l'appel à Better Auth (une tentative échouée déconnecterait) ; fermer toutes les sessions de l'utilisateur (relève de la 1.5 et de S-17, au changement de mot de passe). Les sessions ouvertes depuis d'autres navigateurs restent valables, visibles et révocables en 1.5.

#### 4.4 Purge des sessions expirées (S-63)

`purgerSessionsExpirees()` (`src/server/db/comptes.ts`) supprime les sessions dont `expires_at` est passé ; nouvelle étape `sessions_expirees` de la tâche quotidienne (`src/server/taches/etapes.ts`). Une session expirée ne sert plus à rien, et elle contient une adresse IP et un navigateur (`THREATS.md` 7.2). Requête par `db`, dans `src/server/db/`, comme `purgerComptesNonVerifies`.

### 5. Zone « compte » et pages (décision 2)

#### 5.1 Une zone pour un utilisateur connecté sans organisation

Aucun utilisateur n'a d'organisation avant la 2.1, et toute page de `(app)/` exige une adhésion. **Retenu** : un nouveau groupe de routes, `src/app/(compte)/`, pour les pages qui demandent une session vérifiée mais aucune organisation. Il servira ensuite aux pages de compte du jalon 1 (double authentification en 1.4, sessions en 1.5) et à la création d'organisation (2.1).

- **`lireComptePourPage(lire)`** (`src/server/actions/exposer.ts`) : lit la session par `lireSession` ; absente : `notFound()`, la même page « introuvable » que `lirePourPage` (S-02 au sens de `THREATS.md` 5.4). Elle ne lit aucune organisation ni adhésion, et ne donne à `lire` que l'identifiant de l'utilisateur. Aucune donnée d'une organisation n'est lisible par elle.
- **Règle du test d'inventaire**, comme pour `(app)/` : chaque `page.tsx` de `(compte)/` appelle `lireComptePourPage` ; aucune métadonnée propre ni `loading.tsx` dans `(compte)/`.
- **Gabarit** `(compte)/layout.tsx` : en-tête au nom de l'application, bouton « Se déconnecter ». Il ne protège pas (comme `(app)/layout.tsx`).

#### 5.2 Pages

| Adresse | Zone | Contenu |
|---|---|---|
| `/connexion` | `(public)` | Email, mot de passe, « Se connecter » ; message et aide de la section 2.1 ; lien « Recevoir un nouveau lien de confirmation » ; lien « Créer un compte ». Envoi par `fetch` en JSON. Succès : `/compte` (navigation du routeur, page jamais visitée auparavant, rendue par le serveur avec le nouveau cookie) |
| `/connexion/nouveau-lien` | `(public)` | Formulaire de renvoi du lien de confirmation (1.1), réponse identique pour toute adresse |
| `/compte` | `(compte)` | « Vous êtes connecté » et le nom de l'utilisateur ; bouton « Se déconnecter ». La 2.1 y ajoutera la création d'organisation et la liste des organisations (UC-02, étape 4) |
| Gabarit de `(app)/` | `(app)` | Bouton « Se déconnecter » en bas de la barre latérale (et du menu replié sous 768 px) |
| `/inscription/verifiee` | `(public)` | Lien vers `/compte` (la vérification ouvre une session) |

**Utilisateur connecté** (correctif de la 1.2, constat sur la prévisualisation du 2026-10-16) : `/connexion`, `/connexion/nouveau-lien`, `/inscription` et `/inscription/envoyee` appellent `redirigerSiConnecte` (`src/server/actions/exposer.ts`), qui lit la session côté serveur et redirige vers `/compte` (307). Sans session, avec une session invalide ou une lecture en échec, la page s'affiche comme avant, au même document : rien ne dépend de l'existence d'un compte. Ne redirigent pas : `/inscription/verifiee`, qui s'adresse justement à l'utilisateur dont la vérification vient d'ouvrir la session (UC-01, étape 5), et `/lien/verification` (zone par lien). Le test d'inventaire vérifie l'appel dans chaque page concernée. Formulaires affichés seulement après hydratation, `<noscript>` sinon, comme en 1.1 (décision par défaut 4 de la PR 2 : un formulaire HTML partirait en `GET`, mot de passe dans l'adresse). Interface selon `docs/DESIGN-SYSTEM.md` (compétence `interface`), textes dans `src/textes/compte.ts`, vérifiée à 390 et 1280 px. `/connexion` entre dans le projet `mobile-390` de Playwright, comme `inscription`.

#### 5.3 Après la connexion

En 1.2, la connexion mène toujours à `/compte`. La 2.1 choisira entre la dernière organisation active et la liste (UC-02, étape 4). Les erreurs 3a, 3b et 4a d'UC-02 viennent avec la 1.4.

### 6. Dette : l'identifiant d'incident (S-85)

- **Serveur.** Toute réponse `erreur` de `/api/auth` porte un identifiant : `{ ok: false, raison: "erreur", incident: "<uuid>" }`. C'est celui de la ligne `[auth]` écrite au même moment : nouvelle fonction `consignerIncidentAuth(): string` dans `src/server/auth/journal.ts`, qui écrit la ligne et rend l'identifiant ; `consignerAuth` (le journal de Better Auth) garde sa signature et son comportement. Cas couverts : exception attrapée autour de `auth.handler`, statut `5xx` de Better Auth, comptage par compte en échec, déconnexion non vérifiée (section 4.2), réponse `200` inattendue de la connexion (section 1.1). Une seule ligne de journal par réponse.
- **Rien d'autre** dans la réponse : ni message, ni code de Better Auth (S-85, T-35).
- **Navigateur.** `src/components/compte/appel-auth.ts` lit `incident` seulement s'il a la forme d'un UUID ; les formulaires d'inscription, de renvoi, de vérification, de connexion et de déconnexion affichent « Une erreur est survenue. » puis « Identifiant de l'incident : » et l'identifiant (textes de `src/textes/erreurs.ts`, présentation de `src/components/erreurs/incident.tsx`). Une erreur réseau, sans réponse du serveur, s'affiche sans identifiant.
- `PLAN.md` section 7 : la ligne de la dette est retirée par la PR.

### 7. Dette : le texte de l'email `compte.existant`

Le modèle est envoyé pour une adresse dont le compte est vérifié **ou non** (1.1, section 4.4). Le texte actuel (« Si c'est vous, connectez-vous avec votre mot de passe habituel ») ne vaut que pour un compte vérifié. Nouveau texte (`src/textes/emails.ts`), sujet inchangé :

> Quelqu'un a tenté de créer un compte sur Facturation PME avec votre adresse email, qui a déjà un compte. Si c'est vous, connectez-vous depuis la page de connexion de Facturation PME avec votre mot de passe. Si vous n'avez pas encore confirmé votre adresse, demandez un nouveau lien de confirmation depuis cette même page. Sinon, ignorez cet email : votre compte n'a pas été modifié.

**Aucun lien dans l'email en 1.2** : la règle 17 n'admet que des liens `/lien/` construits depuis un jeton, et l'ajout des liens vers la connexion et la réinitialisation est prévu en 1.3 (`inscription.md`, « Reporté »). Le texte ne mentionne pas le mot de passe oublié, qui n'existe pas encore. Le test des modèles (`modeles.test.ts`) fige le texte.

### 8. Tests de bout en bout connectés

#### 8.1 Comptes de test

Les comptes de bout en bout sont créés par le parcours réel : inscription, lecture de l'email dans le dossier du transport `fichier`, vérification (1.1, `e2e/comptes-e2e.ts`). Un compte connecté par le formulaire de `/connexion` sert ensuite aux tests de la connexion et de la déconnexion.

#### 8.2 Organisation de test pour le gabarit de l'application

Le gabarit de `(app)/` demande une adhésion, qu'aucun écran ne crée avant la 2.1. Un outil de bout en bout, `e2e/organisation-e2e.ts`, crée par SQL une organisation, une adhésion au rôle `proprietaire` et l'organisation active de la session, pour un compte de l'exécution. Conditions fixées par le développeur (décision 4), **chacune testée** (`e2e/organisation-e2e.spec.ts`, faux `Pool`, sans base) :

1. **Code dans `e2e/` seulement**, jamais dans `src/` (test : aucun fichier de `src/` ne l'importe ni ne contient ses requêtes).
2. **Base jetable ou service PostgreSQL de la CI seulement.** Le lanceur `scripts/e2e-base-jetable.mjs` pose `E2E_BASE_JETABLE=1` pour Playwright en mode jetable ; en CI, `CI` est défini. L'outil exige l'un des deux, **et** une `DATABASE_URL` dont l'hôte est `127.0.0.1` ou `localhost`. Avec `E2E_BASE=dev`, ou sans ces conditions, les tests qui en dépendent sont **sautés** (`test.skip`) avec un message explicite, et l'outil n'ouvre aucune connexion, donc n'écrit rien.
3. **`DATABASE_URL` seule**, prise dans l'environnement du processus, jamais dans `.env.local`, jamais `DATABASE_URL_MIGRATION` ; utilisateur de l'adresse égal à `app_facturation`, le rôle de l'application, jamais le rôle propriétaire.
4. **Identifiants tirés à chaque exécution** : identifiant d'organisation par `randomUUID()`, `slug` `e2e-<exécution>-<aléa>`.
5. **Suppression par liste exacte** : les identifiants créés par l'exécution, `DELETE FROM "organization" WHERE id = ANY($1::uuid[])`, sans `LIKE` ni motif ; adhésions par `ON DELETE CASCADE`. En fin de fichier (`afterAll`), donc avant le nettoyage des comptes.
6. **Refus si `VERCEL_ENV` est défini**, quelle que soit sa valeur, avant toute autre lecture.

Requêtes paramétrées seulement. L'adresse du compte doit être une adresse de l'exécution (`ADRESSES_E2E`). Hors de `src/` : la règle 4 ne s'y applique pas, comme pour le nettoyage des comptes.

#### 8.3 Reprise de la 0.6 (décision 27)

Dans un navigateur connecté, sur `/tableau-de-bord`, à 1280 et 390 px : barre latérale de 240 px à 1280 px ; barre au-dessus du contenu sous 768 px ; cibles de 44 px au moins pour les liens de navigation, le menu replié et « Se déconnecter » ; anneau de focus de 2 px en `accent` décalé de 2 px sur ces éléments ; aucun défilement horizontal à 390 et 360 px ; captures du tableau de bord connecté jointes à la PR. `docs/features/socle-interface.md`, « Limites connues » : la ligne est close par renvoi à cette fiche.

### 9. Évènements de compte et journal d'audit

**Retenu** (décision par défaut 7) : rien au journal d'audit, et aucune nouvelle table.

- Le journal d'audit exige une organisation ; une connexion n'en a pas (`SPEC.md` section 8, point 5).
- **Trace d'une connexion réussie** : la ligne de la table `session` (date, adresse IP, navigateur), que la 1.5 affichera à l'utilisateur (UC-05), supprimée à son expiration (section 4.4).
- **Échecs** : le compteur de débit, sans valeur en clair, et une ligne fixe `[auth] warn` par échec au journal technique (Better Auth appelle `logger.warn("User not found")` ou `("Invalid password")`, que `consignerAuth` réduit au niveau seul, T-39). Aucune adresse, aucun identifiant d'utilisateur.
- **« Connexions sensibles » de S-70** : à définir avec les rôles qui les rendent sensibles, au plus tard en 1.4 (double authentification exigée pour les Propriétaires et Comptables). Noté dans « Reporté ».

### 10. Contrôle après déploiement

`scripts/controle-deploiement.mjs` (production seulement, lancé par le workflow, jamais par l'assistant) :

- les contrôles `inscription:*` deviennent `comptes:*` et visent cinq `POST` sans corps ni `Origin` : les trois de la 1.1, plus `/api/auth/sign-in/email` et `/api/auth/sign-out`, chacun identique au `POST` d'un chemin inexistant de `/api/auth` (comptes fermés en production, section 1.3). Mêmes contraintes que la 1.1 sur ces `POST` (`optionsRequete` : ni corps, ni `Origin`, ni cookie, ni `Authorization`) ;
- `auth:identique` gagne `GET /api/auth/get-session` (fermé, section 1.2) ;
- `/connexion` et `/compte` rejoignent les pages contrôlées : `/connexion` comme `/inscription` (statut, politique, en-têtes, aucune fuite) ; `/compte` sans session et avec un cookie forgé, identiques entre eux et sans aucun texte du gabarit de compte, comme `/tableau-de-bord`.

Utile : c'est la seule preuve, en production, que la connexion y reste fermée et que `/get-session` n'y est pas ouvert. En local, seuls les contrôles `comptes:*` échouent (témoin, comme `inscription:*` en 1.1). `CLAUDE.md`, ligne du contrôle, et `docs/features/controle-deploiement.md` mis à jour.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Ouvrir `/get-session` | Corps qui contient le jeton de session en clair, lisible par un script (S-82) ; aucun besoin, les pages lisent la session côté serveur (section 1.2) |
| Message distinct pour un compte non vérifié (« confirmez votre adresse ») | Dit qu'un compte existe à qui a son mot de passe ; demandé identique (T-07) |
| `sendOnSignIn: true` | Effet de bord propre au compte non vérifié ; voie d'envoi de plus vers une victime de pré-appropriation (section 2.3) |
| Limite par compte sur les seuls échecs | Lecture avant, incrément après Better Auth : deux appels, une course entre requêtes simultanées, et un code différent selon le résultat. `DESIGN.md` 3.1 retient toutes les tentatives |
| Limite par adresse IP seule | Ne freine pas un attaquant aux nombreuses adresses (T-01) |
| Prolongation de la session à chaque jour d'activité (défaut de Better Auth) | Session sans fin pour un usage régulier ; cookie du navigateur désaligné de la base, les pages ne pouvant pas le réécrire (section 4.1) |
| `rememberMe` (session limitée au navigateur) | Un réglage choisi par la requête ; une seule durée, plus simple à raisonner et à tester |
| Déconnexion de Better Auth sans vérification | Une panne de la base laisse la session vivante derrière une déconnexion apparente (section 4.2) |
| Connexion ouverte en production dès la 1.2 | Aucun compte n'y existe tant que l'inscription y est fermée (section 1.3) |
| Arrivée sur `/tableau-de-bord` | Page « introuvable » pour tout utilisateur jusqu'à la 2.1 (section 5.1) |
| Table d'évènements de compte | Une table hors organisation, une exception au modèle d'isolation, pour une trace que la table `session` donne déjà (section 9) |
| Lien vers `/connexion` dans `compte.existant` | Change la règle 17 ; prévu en 1.3 avec la réinitialisation (section 7) |

## Règles de sécurité et permissions

- **S-11, T-01, T-07, T-43** : sections 2 et 3. Réponse et durée identiques pour une adresse inconnue, un mauvais mot de passe et un compte non vérifié ; limites par adresse IP et par compte, comptées pour toute adresse.
- **S-17, T-03** : session de 7 jours sans prolongation, relue en base à chaque requête, nouveau jeton à chaque connexion, déconnexion vérifiée en base (section 4).
- **S-54, T-39** : aucune adresse ni aucun jeton au journal ; une ligne fixe par échec ; le corps de Better Auth, qui contient le jeton, n'est jamais renvoyé.
- **S-63** : sessions expirées purgées chaque jour (section 4.4).
- **S-81, T-17** : `verifierOrigine` sur les deux `POST`, dont la déconnexion (une déconnexion forcée depuis un autre site est refusée).
- **S-82** : cookie `HttpOnly`, `SameSite=Lax`, `Secure` en `https` ; jeton jamais dans un corps de réponse ; `/get-session` fermé.
- **S-85** : identifiant d'incident dans toute réponse `erreur`, aucun message (section 6).
- **T-55** : liste fermée de cinq points d'entrée, test d'inventaire, contrôle après déploiement.
- **Matrice des droits** : aucune ligne. La connexion n'appartient à aucune organisation ; `THREATS.md` section 6 : « chaque utilisateur gère son propre compte ». Aucune action déclarée par `declarerAction`.
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3), comme en 1.1 : « sans session » devient, pour la page `/compte`, « sans session et cookie forgé : page introuvable » ; pour les points d'entrée anonymes, « origine absente ou étrangère » ; « autre organisation » et « rôle insuffisant » sont sans objet (aucune organisation lue), remplacés par « point d'entrée fermé » et « `lireComptePourPage` ne donne aucune donnée d'organisation » ; « entrée falsifiée » s'applique tel quel (`rememberMe`, `callbackURL`, champ inconnu).
- **Tables** : aucune créée ni modifiée. `session` est une table de Better Auth (RR-8) ; la purge ne filtre que sur `expires_at`.

## Dépendances nouvelles

Aucune.

## Migration

Aucune. Le dossier `drizzle/` n'est pas touché.

## Découpage en PR

Une seule PR. La connexion reste fermée en production (section 1.3) : rien de nouveau n'y est joignable après la fusion, hors des pages `/connexion` et `/compte`, inertes. Aucune variable de Vercel à poser ; aucune preuve sur la prévisualisation exigée avant fusion. Essai recommandé au développeur sur la prévisualisation (adresse propre du déploiement, section 2.4 de la 1.1) : connexion, `/compte`, déconnexion, retour arrière du navigateur sur `/compte` (page « introuvable »).

## Critères d'acceptation

- [x] Les seuls points d'entrée de `/api/auth` qui ne répondent pas comme une adresse inexistante sont les cinq de la section 1, vérifié pour chaque point déclaré par l'instance ; `GET /get-session` répond comme une adresse inexistante (T-55, S-82).
- [x] Adresse inconnue, mauvais mot de passe, compte non vérifié avec son bon mot de passe : même statut, mêmes en-têtes, même corps, aucun `Set-Cookie`, durée de 800 ms au moins (T-07).
- [x] Aucun email n'est envoyé par une tentative de connexion, compte non vérifié compris.
- [x] La sixième tentative en 15 minutes sur une même adresse, connue ou non, depuis des adresses IP différentes, reçoit `trop_de_requetes`, même avec le bon mot de passe ; la onzième depuis une même adresse IP aussi ; aucune adresse email ni IP en clair dans `compteur_debit` (T-01, T-43).
- [x] La connexion réussie répond `{ ok: true }`, sans jeton dans le corps ; cookie `HttpOnly`, `SameSite=Lax`, `Max-Age` de 7 jours ; `Secure` en `https`.
- [x] Un cookie posé avant la connexion n'est pas repris : le jeton change (T-03).
- [x] La session n'est jamais prolongée : `expiresAt` inchangé après une lecture un jour plus tard (horloge simulée).
- [x] Après la déconnexion, l'ancien cookie rejoué donne une session absente, et `/compte` comme `/tableau-de-bord` répondent « introuvable » (T-03, UC-02 abus 4).
- [x] Une déconnexion dont la suppression en base échoue répond `erreur` avec un incident, et le cookie n'est pas effacé.
- [x] `POST /sign-in/email` et `POST /sign-out` sans `Origin`, avec une autre origine ou `Origin: null` : refusés, Better Auth jamais appelé (S-81, T-17).
- [x] `rememberMe`, `callbackURL`, un champ inconnu, un corps de plus de 4 Kio ou un autre type que JSON : refusés, Better Auth jamais appelé.
- [x] En production, `POST /sign-in/email` et `POST /sign-out` répondent comme un chemin fermé, octet pour octet.
- [x] Toute réponse `erreur` de `/api/auth` porte un `incident` au format UUID, égal à celui de la ligne `[auth]` du journal ; les formulaires l'affichent (dette de `PLAN.md`).
- [x] Le modèle `compte.existant` porte le nouveau texte (section 7).
- [x] `/compte` sans session, avec un cookie forgé, ou pour un utilisateur non vérifié : page « introuvable » ; chaque `page.tsx` de `(compte)/` appelle `lireComptePourPage` (test d'inventaire).
- [x] Les sessions expirées sont supprimées par la tâche quotidienne ; une session en cours est gardée.
- [x] Gabarit de l'application connecté vérifié à 1280 et 390 px (section 8.3), captures jointes.
- [x] Contrôle après déploiement : `comptes:*` et `auth:identique` étendus ; en local, seuls `comptes:*` échouent.
- [x] `npm run verifier` et `npm run test:integration` verts, sorties montrées.

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code.

### Tests d'attaque, puis unitaires

1. [x] **T-55 et S-82, liste fermée** — `src/server/auth/points-entree.attaque.test.ts` : l'inventaire passe à cinq points ouverts ; `GET /get-session`, `POST /get-session`, `/sign-in/social`, `/revoke-session`, `/list-sessions` reçoivent `reponseInexistante()`, octet pour octet ; `auth.handler` jamais appelé (espion).
2. [x] **T-07, réponse unique** — même fichier, Better Auth simulé : `401 INVALID_EMAIL_OR_PASSWORD`, `403 EMAIL_NOT_VERIFIED`, `401` sans code et `400 INVALID_EMAIL` donnent la même réponse (statut, en-têtes, corps), sans `Set-Cookie` ; un `Set-Cookie` présent sur un refus n'est pas transmis.
3. [x] **S-82, corps de la connexion** — même fichier : un `200` de Better Auth avec `token` et `user` dans le corps donne exactement `{ ok: true }` et ses `Set-Cookie` ; un `200` sans cookie de session, ou avec `twoFactorRedirect`, donne `erreur` avec un incident.
4. [x] **Origine et entrée falsifiée** — même fichier : `Origin` absente, étrangère, `null`, `Sec-Fetch-Site: cross-site` sur les deux `POST` ; `rememberMe`, `callbackURL`, champ inconnu, mot de passe de 129 caractères, adresse hors de la règle de la porte, corps de 4 Kio + 1, autre type que JSON, données dans l'adresse ; `/sign-out` avec un corps non vide. Refus, Better Auth jamais appelé, limite par compte jamais comptée.
5. [x] **Comptes fermés en production** — même fichier : avec `estProduction` vrai, les cinq `POST` reçoivent exactement `reponseInexistante()` ; témoin hors production.
6. [x] **Limite par compte** — même fichier, `limiterCompte` simulé : appelé avec l'adresse validée et normalisée, avant Better Auth ; refus : `trop_de_requetes`, Better Auth jamais appelé ; en échec : `erreur` avec incident ; jamais appelé pour `/sign-out` ni pour une entrée refusée.
7. [x] **Durée plancher** — `points-entree.test.ts`, horloge simulée : la connexion retenue jusqu'à 800 ms pour un refus, une limite atteinte, une entrée invalide et un succès ; `/sign-out` sans plancher.
8. [x] **Déconnexion vérifiée** — `points-entree.test.ts` : session relue absente : `{ ok: true }` avec les `Set-Cookie` d'effacement ; session encore lisible ou relecture qui lève : `erreur`, incident, aucun `Set-Cookie` ; l'en-tête `cookie` n'est transmis qu'à `/sign-out`.
9. [x] **Identifiant d'incident** — `points-entree.test.ts` et `journal.test.ts` : chaque chemin vers `erreur` (exception, `5xx`, limite en échec, déconnexion non vérifiée, `200` inattendu) porte un UUID égal à celui de l'unique ligne `[auth]` écrite ; aucune autre propriété dans le corps.
10. [x] **Configuration** — `config.test.ts`, ajouts : `session.expiresIn` 604 800, `disableSessionRefresh` vrai, `cookieCache` absent, `sendOnSignIn` absent ou faux ; attributs du cookie de session pour une `baseURL` en `https`, `Max-Age` 604 800.
11. [x] **Limites** — `limites.test.ts` : `auth.connexion`, `auth.connexion_compte`, `auth.deconnexion` présentes, sous 24 h ; `par` `adresse_ip` ou `adresse_email` ; `reglesBetterAuth()` couvre exactement les chemins ouverts qui passent par Better Auth ; aucune règle partagée entre deux limites `auth.*`. `debit/better-auth.test.ts` : la règle de `/sign-in/email` est acceptée par le stockage.
12. [x] **Zone compte** — `inventaire.test.ts` : chaque `page.tsx` de `(compte)/` appelle `lireComptePourPage`, aucune métadonnée ni `loading.tsx` ; `exposer.test.ts` : sans session, `lireComptePourPage` appelle `notFound()` sans appeler `lire` ; avec session, `lire` ne reçoit que l'identifiant de l'utilisateur.
13. [x] **Modèle `compte.existant`** — `modeles.test.ts` : nouveau texte, aucun lien.
14. [x] **Client** — `appel-auth.test.ts` : `incident` lu seulement au format UUID ; `identifiants_incorrects` reconnue ; raison inconnue : `erreur`.

### Tests d'intégration, avec base

15. [x] `src/server/db/connexion.integration.test.ts` (dans `src/server/db/`, seul dossier dont les tests peuvent importer `db`) (par `traiterRequeteAuth`, vraie instance, banc de la 1.1) : compte vérifié, compte non vérifié, adresse inconnue ; les trois refus identiques octet pour octet, chacun d'au moins 800 ms ; aucun email dans le transport `memoire` ; connexion réussie, puis `lireSession` avec le cookie reçu ; le jeton diffère de celui de la session ouverte par la vérification ; déconnexion, puis `lireSession` avec l'ancien cookie : `null`, et ligne de session absente en base.
16. [x] Même fichier, **limites** : 5 tentatives sur une adresse depuis 5 adresses IP, la sixième refusée avec le bon mot de passe ; même chose pour une adresse inconnue ; `compteur_debit` sans adresse en clair. Nettoyage des clés et des comptes.
17. [x] Même fichier, **sans prolongation** : session lue après avoir reculé `updated_at` et `created_at` de deux jours en base ; `expires_at` inchangé.
18. [x] `src/server/db/comptes.integration.test.ts` : `purgerSessionsExpirees` supprime une session expirée et garde une session en cours ; nouvelle étape dans `etapes.test.ts`.

### Tests de bout en bout

19. [x] **Parcours UC-02** — `e2e/connexion.spec.ts` (ordinateur-1280 et mobile-390) : compte créé par le parcours de la 1.1 ; déconnexion ; connexion par le formulaire ; arrivée sur `/compte` ; la requête porte `Origin` ; le corps de la réponse ne contient pas le jeton ; cookie `HttpOnly`, `SameSite=Lax`, `Max-Age` de 7 jours.
20. [x] **T-07 en bout en bout** — même fichier : adresse inconnue, mauvais mot de passe, compte non vérifié : même écran, même message, même corps de réponse ; lien vers le renvoi présent.
21. [x] **T-03** — même fichier : cookie copié avant la déconnexion, puis rejoué dans un nouveau contexte : `/compte` et `/tableau-de-bord` donnent la page « introuvable » ; retour arrière du navigateur après déconnexion : aucune donnée affichée.
22. [x] **T-01 et T-43** — `e2e/auth.attaque.spec.ts` : six tentatives sur une adresse, chacune avec un `X-Forwarded-For` différent : la sixième reçoit `trop_de_requetes` ; `GET /get-session` avec un cookie valide : réponse identique à `/api/auth/n-existe-pas`.
23. [x] **Incident affiché** — `e2e/erreurs.attaque.spec.ts`, serveur en panne : la connexion affiche « Une erreur est survenue. » et un identifiant ; cet identifiant figure dans `.e2e-journaux/` sur une ligne `[auth]`, sans adresse ni jeton.
24. [x] **Gabarit connecté** — `e2e/affichage-connecte.spec.ts` (outil de la section 8.2) : vérifications de la section 8.3 à 1280, 390 et 360 px, focus au clavier, captures.
25. [x] **Contrôle après déploiement** — `e2e/controle-deploiement.spec.ts`, serveur factice : `comptes:*` échoue si l'un des cinq `POST` diffère d'un chemin inexistant ; `auth:identique` échoue si `/get-session` diffère ; `/compte` contrôlé comme `/tableau-de-bord`.
26. [x] **Organisation de test, conditions de la décision 4** — `e2e/organisation-e2e.spec.ts` (faux `Pool`, sans base), un test par condition : aucun fichier de `src/` ne l'importe ; sans `CI` ni `E2E_BASE_JETABLE`, avec `E2E_BASE=dev`, ou avec un hôte autre que `127.0.0.1` ou `localhost` : saut annoncé par un message explicite, aucune connexion ouverte ; `DATABASE_URL_MIGRATION` jamais prise, `.env.local` jamais lu, utilisateur autre que `app_facturation` refusé ; identifiants différents d'une exécution à l'autre ; suppression par `id = ANY($1::uuid[])` de la liste exacte, sans `LIKE` ; refus si `VERCEL_ENV` est défini, pour toute valeur, sans connexion ; adresse hors de l'exécution refusée. `scripts/e2e-base-jetable.test.mjs` : `E2E_BASE_JETABLE=1` transmis à Playwright en mode jetable seulement.
27. [x] **Utilisateur connecté redirigé** (correctif) — `exposer.test.ts` (`redirigerSiConnecte` : session valide, absente, lecture en échec), `inventaire.test.ts` (appel dans chaque page concernée, sauf « Adresse vérifiée »), `e2e/connexion.spec.ts` aux deux largeurs : connecté, chaque page mène à `/compte` ; « Adresse vérifiée » et `/lien/verification` restent ; en HTML brut, 307 vers `/compte` avec une session valide, même statut et même document sans cookie, avec un cookie forgé, aléatoire ou vide.
28. [x] **Reconnexion : ancienne session révoquée** (correctif) — `points-entree.test.ts` (après Better Auth, seulement sur succès, échec de la révocation : `erreur` sans cookie, jamais sur les autres points) ; `points-entree.attaque.test.ts` (ni en production ni sur une origine refusée) ; `gestionnaire.test.ts` (`deleteSession` du jeton du cookie) ; `connexion.integration.test.ts` (ancienne session supprimée en base, nouvelle lisible ; échec : l'ancienne reste) ; `e2e/connexion.spec.ts` aux deux largeurs (ancien cookie rejoué : page « introuvable » ; nouveau : `/compte`).

### Vérifications manuelles (développeur)

- [ ] Essai sur la prévisualisation, adresse propre du déploiement (« Découpage en PR ») ; journaux du déploiement sans adresse ni jeton.
- [ ] Correctif : connecté, ouvrir `/connexion`, `/connexion/nouveau-lien`, `/inscription` et `/inscription/envoyee` : chacune mène à `/compte` ; `/inscription/verifiee` s'affiche. Déconnecté, ou cookie de session supprimé, les quatre pages s'affichent normalement.
- [ ] Correctif : connecté dans un navigateur, copier la valeur du cookie `__Secure-better-auth.session_token` ; se reconnecter (après déconnexion du seul onglet, ou par un `POST /api/auth/sign-in/email` portant ce cookie) ; dans une fenêtre privée, poser l'ancienne valeur : `/compte` répond « introuvable ».

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `src/server/auth/points-entree.ts` | Deux points ouverts, `limiterCompte`, déconnexion vérifiée, incident, constante renommée |
| `src/server/auth/gestionnaire.ts` | Liaison de `limiterCompte` à `verifierDebit` et de la relecture de session |
| `src/server/auth/journal.ts` | `consignerIncidentAuth` |
| `src/server/auth/config.ts` | `session` (durée, sans prolongation) |
| `src/server/debit/limites.ts`, `src/server/debit/better-auth.ts` | Trois limites, `adresse_email`, règles des deux chemins |
| `src/server/actions/exposer.ts` | `lireComptePourPage` |
| `src/server/db/comptes.ts`, `src/server/taches/etapes.ts` | `purgerSessionsExpirees`, étape `sessions_expirees` |
| `src/schemas/compte.ts`, `src/schemas/regles-compte.ts` | Schémas de connexion et de déconnexion |
| `src/app/(public)/connexion/page.tsx`, `src/app/(compte)/layout.tsx`, `src/app/(compte)/compte/page.tsx` | Nouveaux |
| `src/app/(public)/inscription/verifiee/page.tsx` | Lien vers `/compte` |
| `src/components/compte/*`, `src/components/gabarits/*` | Formulaire de connexion, bouton de déconnexion, incident dans les formulaires |
| `src/textes/compte.ts`, `src/textes/emails.ts` | Textes de la connexion ; texte de `compte.existant` |
| `src/server/actions/inventaire.test.ts` | Règle de `(compte)/` |
| `e2e/*.spec.ts`, `e2e/organisation-e2e.ts`, `e2e/organisation-e2e.spec.ts`, `playwright.config.ts`, `scripts/e2e-base-jetable.mjs` (`E2E_BASE_JETABLE=1`) | Nouveaux tests, organisation de test, `connexion` dans `mobile-390` |
| `scripts/controle-deploiement.mjs` | `comptes:*`, `/get-session`, `/connexion`, `/compte` |
| `docs/THREATS.md` 8 (RR-12), `docs/PLAN.md` 7, `docs/DESIGN.md` 3.1, `docs/STRUCTURE.md` 2, 3 et 7, `docs/THREATS.md` 10, `docs/features/controle-deploiement.md`, `docs/features/socle-interface.md`, `docs/features/inscription.md`, `CLAUDE.md` | Dette close, zone `(compte)`, liste des points ouverts, contrôle |

## Reporté

- **1.3** : ouverture des comptes en production (retrait de `COMPTES_OUVERTS_EN_PRODUCTION`) ; liens de `compte.existant` vers la connexion et la réinitialisation ; lien « Mot de passe oublié » sur `/connexion`.
- **1.4** : étape 3 d'UC-02 (code temporaire, codes de secours), erreurs 3a, 3b et 4a ; branche `twoFactorRedirect` ; définition des « connexions sensibles » de S-70 et de leur lieu.
- **1.5** : liste et révocation des sessions ; sessions multiples d'un même utilisateur. **Traité** par `docs/features/profil-sessions.md`.
- **1.6** : `freshAge` et nouvelle authentification.
- **2.1** : arrivée sur la dernière organisation active ou la liste (UC-02, étape 4) ; création d'organisation dans `(compte)/`.
- **8.1** : signalement des lignes `[auth] error` et du rythme des `[auth] warn` (essais en masse) au service de suivi.
- **Prévus pour la 1.2 par `socle-interface.md`, non repris ici** (constaté à l'implémentation) : le nom de l'utilisateur en bas de la barre latérale (section 10 de la 0.6 ; demande une lecture de `user`, RR-8) et le scénario « base injoignable avec une session valide » (section 4.3 de la 0.6) passent au jalon 2. La redirection de `connexion_requise` vers `/connexion` (section 2.2 de la 0.6) passe aussi au jalon 2, par une fiche dédiée (décision du développeur du 2026-10-16). Les trois reports sont inscrits dans `docs/PLAN.md`, jalon 2.

## Limites connues

- **Blocage d'un compte par un tiers** (T-43) : 5 requêtes bloquent la connexion d'une adresse 15 minutes, renouvelables (section 3), sans rien apprendre sur l'existence du compte. Risque résiduel RR-12 de `THREATS.md` (décision 5).
- **Durée au-delà du plancher** : une base lente rend l'écart mesurable (section 2.2), comme en 1.1.
- **Reconnexion hebdomadaire** : une session ne dure que 7 jours, même active (décision 3).
- **Sessions d'autres navigateurs gardées** : se reconnecter révoque la session du navigateur qui se reconnecte (section 4.3), pas celles des autres navigateurs ; visibles et révocables en 1.5.
- **Vérification d'une autre adresse depuis un navigateur connecté** : la vérification ouvre une nouvelle session sans révoquer celle du cookie reçu (le gestionnaire ne transmet pas le cookie à `/verify-email`). Cas rare (une seconde inscription vérifiée dans le même navigateur), sans élévation de droits. **Close par la 1.3** : une vérification qui ouvre une session révoque celle du cookie reçu (`docs/features/mot-de-passe.md`, section 8).
- **Pages inertes en production** jusqu'à la 1.3 : `/connexion` y affiche une erreur à l'envoi (section 1.3).
- **Ligne `[auth] warn` par échec** : un essai en masse remplit le journal technique d'autant de lignes, bornées par les limites de la section 3.

## Décisions

Prises par le développeur le 2026-10-14.

1. **`/get-session` reste fermé** (section 1.2).
2. **Zone `(compte)/` et page `/compte` comme arrivée** (section 5).
3. **Session de 7 jours sans prolongation** (section 4.1).
4. **Organisation de test créée par SQL**, aux conditions de la section 8.2, chacune testée (test 26).
5. **Risque assumé de la limite par compte**, inscrit dans `THREATS.md` (RR-12) : un tiers peut bloquer la connexion d'un compte 15 minutes, sans apprendre s'il existe.

## Décisions par défaut

Appliquées par l'assistant le 2026-10-14, selon sa recommandation, sauf avis contraire du relecteur.

1. **Comptes fermés en production jusqu'à la 1.3**, connexion et déconnexion comprises ; constante renommée `COMPTES_OUVERTS_EN_PRODUCTION` (section 1.3).
2. **Une seule réponse** `identifiants_incorrects` (401) pour adresse inconnue, mauvais mot de passe et compte non vérifié ; message unique qui renvoie aussi vers le renvoi du lien (section 2.1).
3. **`sendOnSignIn` à `false`** (section 2.3).
4. **Limites** : `auth.connexion` 10 par 15 min par adresse IP ; `auth.connexion_compte` 5 par 15 min par adresse email, comptée pour toute adresse valide ; `auth.deconnexion` 20 par minute par adresse IP ; toutes les tentatives comptent (section 3).
5. **Plancher de 800 ms** sur toute réponse de la connexion, succès compris ; aucun sur la déconnexion (section 2.2).
6. **Déconnexion vérifiée** par relecture de la session ; échec : `erreur`, cookie gardé (section 4.2).
7. **Évènements de compte** : rien au journal d'audit, aucune table ; la table `session` et les lignes fixes `[auth]` suffisent ; « connexions sensibles » en 1.4 (section 9).
8. **Identifiant d'incident** : l'UUID de la ligne `[auth]`, une ligne par réponse `erreur` (section 6).
9. **`compte.existant`** : nouveau texte, sans lien ; liens en 1.3 (section 7).
10. **Purge des sessions expirées** par la tâche quotidienne (section 4.4).
11. **Organisation de test par SQL** : remplacée par la décision 4.
12. **Une seule PR** (« Découpage en PR »).
13. **Contrôle après déploiement étendu** : `comptes:*`, `/get-session`, `/connexion`, `/compte` (section 10).

## Notes de l'implémentation

Le 2026-10-14, une seule PR (branche `feat/1.2-connexion`) : commits `docs(1.2): fiche`, `docs(1.2): décisions`, `test(1.2)` (phase rouge), `feat(1.2)`.

**Phase rouge** (commit `test(1.2)`). Unitaires : 72 tests en échec dans 12 fichiers, chacun faute du code (points d'entrée absents de la liste, donc réponse inexistante au lieu de 401, 400, 429 ou 500 ; `consignerIncidentAuth`, `lireComptePourPage`, `purgerSessionsExpirees` et les trois limites absentes ; session sans réglage ; texte de `compte.existant` ; étape de la tâche). Intégration (sur `dev`) : 9 échecs, mêmes causes. Bout en bout (site construit avant le code, base jetable) : 67 échecs (pages `/connexion`, `/connexion/nouveau-lien` et `/compte` absentes, points d'entrée fermés, contrôle après déploiement sans les nouveaux contrôles, marque de la base jetable absente) ; `affichage-connecte.spec.ts` et `organisation-e2e.spec.ts` non chargés (module `e2e/organisation-e2e.ts` absent). La construction vérifiant les types de tout le dépôt, le site de la phase rouge a été construit avec les tests remisés (`git stash`), puis les tests restaurés.

**Passaient avant le code, et pourquoi** : les chemins qui restent fermés (`/get-session`, `/sign-in/social`, sessions) et l'identité des quatre échecs entre eux (tous en 404 avant le code) : garde-fous de non-régression ; « la limite par compte n'est jamais comptée » ailleurs (la dépendance n'existait pas) ; `config.test.ts`, durée et `Max-Age` de 7 jours et `sendOnSignIn` absent (valeurs par défaut de Better Auth, figées) ; les démonstrations de l'inventaire et `RANGS` (outillage de test) ; la zone `(compte)` sans session en bout en bout (la page n'existait pas : 404 « introuvable » ; le test d'inventaire exige qu'elle existe) ; `/get-session` avec un cookie valide (déjà fermé) ; la règle « code dans e2e/ seulement » de l'organisation de test.

**Tests modifiés, sans changer ce qu'ils prouvent** :

- Tests de la 1.1 qui attendaient un corps « erreur » exact (`points-entree.test.ts`, `journal.attaque.test.ts`, `mots-de-passe.attaque.test.ts`, `e2e/erreurs.attaque.spec.ts`) : l'identifiant d'incident s'ajoute au corps (dette soldée) ; ils le vérifient désormais.
- Listes de la 1.1 (trois points ouverts, `/sign-in/email` et `/sign-out` fermés, `INSCRIPTION_OUVERTE_EN_PRODUCTION`, contrôles `inscription:*`, 34 requêtes du contrôle) : étendues à cinq points, `COMPTES_OUVERTS_EN_PRODUCTION`, `comptes:*`, 46 requêtes.
- `e2e/pages-livrees.ts` : la première action de « Adresse vérifiée » est le nouveau lien « Accéder à mon compte ».
- Texte de la connexion échouée : « Email ou mot de passe incorrect », mot pour mot `DESIGN-SYSTEM.md` ; l'aide sur la confirmation devient une phrase fixe de la page (section 2.1).
- `gestionnaire.test.ts` : la relecture de session est simulée sur l'adaptateur (`findSession`) au lieu d'`auth.api.getSession` (constat ci-dessous).
- `e2e/connexion.spec.ts` et `e2e/erreurs.attaque.spec.ts` : l'alerte est cherchée dans le formulaire, l'annonceur de route de Next.js portant aussi `role="alert"`.
- `e2e/affichage-connecte.spec.ts` : le lien d'évitement, masqué hors focus (1 px), n'est pas compté parmi les cibles de 44 px ; son anneau de focus reste vérifié.
- Banc d'inscription, `LIMITES_TEST`, appels de `creerTraitementAuth` des tests de la 1.1 : nouvelles dépendances exigées par le type.

**Constats et corrections pendant l'implémentation** :

- **Déconnexion** : relire la session par `auth.api.getSession` faisait écrire par l'extension `nextCookies` un `Set-Cookie` d'effacement dans notre réponse (cookie vide resté dans le navigateur), y compris quand la déconnexion échouait. La relecture passe par `internalAdapter.findSession`, avec le jeton du cookie reçu (`jetonDeSession`, testée).
- **Gabarit `(compte)`** : sans session, il s'affichait autour de la page « introuvable », bouton « Se déconnecter » compris. Il appelle désormais `lireComptePourPage`, comme `(app)/layout.tsx` appelle `lirePourPage` ; chaque page continue de se protéger elle-même.
- **Connexion réussie** : navigation par le routeur (`router.push("/compte")`) plutôt que `window.location.assign`, refusée par la règle de Next.js ; `/compte` n'ayant jamais été visitée, elle est rendue par le serveur avec le nouveau cookie. La déconnexion garde `window.location.replace("/connexion")` : rechargement complet, et l'entrée quittée sort de l'historique.
- **Test d'intégration** dans `src/server/db/connexion.integration.test.ts` (seul dossier dont les tests importent `db`).

**Point prévu par la 0.6, non repris (reporté au jalon 2, fiche dédiée, décision du 2026-10-16)** : `socle-interface.md` (section 2.2) prévoyait qu'en 1.2, `connexion_requise` redirige vers `/connexion` avec l'adresse de retour. Non fait : la réponse « introuvable » reste, pour `(app)/` comme pour `(compte)/`, comme décidé dans cette fiche. Les tests de la 0.6 et le contrôle après déploiement reposent sur ce 404. Le nom de l'utilisateur dans la barre latérale et le scénario « base injoignable avec une session valide » passent au jalon 2 (« Reporté »).

**Vérifications** : `npm run verifier` vert (format, lint, typecheck, 59 fichiers et 1 968 tests unitaires, construction, 381 tests de bout en bout sur la base jetable, aucun sauté, ports 3000 et 3101 libres) ; `npm run test:integration` sur `dev` : 22 fichiers, 194 réussis et 1 échec attendu (déjà présent).

### Correctif du 2026-10-16 (constat sur la prévisualisation)

Un utilisateur connecté pouvait ouvrir `/connexion` et `/inscription` ; une reconnexion laissait l'ancienne session valide en base. Corrigé dans la même PR : sections 4.3 et 5.2, tests 27 et 28.

**Phase rouge** (commit `test(1.2)` du correctif) : 8 tests unitaires en échec (`redirigerSiConnecte` absente ; pages sans l'appel ; aucune révocation après la connexion, ni par le gestionnaire), 1 d'intégration (ancienne session encore lisible après la reconnexion), 6 de bout en bout aux deux largeurs (pages affichées au lieu de rediriger, en navigateur comme en HTML brut ; ancien cookie encore accepté). Passaient avant le code, et pourquoi : les cas « rien n'est révoqué » (échecs, autres points, production, origine refusée, sans cookie) et « connexion échouée : l'ancienne session reste », puisque rien n'était révoqué ; les démonstrations de l'inventaire ; `RANGS` à 18 (outillage).

**Tests modifiés** : appels de `creerTraitementAuth` des tests de la 1.1 (nouvelle dépendance exigée par le type, sans effet) ; `RANGS` passe de 16 à 18 (deux comptes de bout en bout de plus), le rang 15 « limite », inutilisé, devient « redirection ».

**Docker** : il n'était pas démarré à la reprise. L'assistant a lancé Docker Desktop sur le poste pour la base jetable.
