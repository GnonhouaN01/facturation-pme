# Fonctionnalité : profil et sécurité du compte (sessions, mot de passe, nom)

Statut : validée le 2026-10-20 par application des recommandations de l'assistant (consigne du développeur : « applique tes recommandations aux questions ouvertes ») ; les vrais choix restants sont listés à la fin (« Choix restants »).

Jalon 1, fonctionnalité 1.5 de `docs/PLAN.md`. Taille S dans le plan, M avec les reports. Cas d'utilisation : UC-05, UC-03 (« Abus », par symétrie : changer de mot de passe ferme les autres sessions). Exigences : F-004, S-17, S-10, S-11, S-81, S-82, S-85, S-87, NF-01, NF-02. Menaces : T-03, T-01 (essais de mot de passe par une session volée), T-34 (texte saisi par un tiers affiché), T-39, T-55, T-65.

## Contexte

Un utilisateur doit voir où son compte est connecté et fermer une session suspecte (UC-05, F-004). Depuis la 1.2, une session dure 7 jours sans prolongation et une connexion ne révoque que la session du navigateur qui se reconnecte : les sessions des autres navigateurs restent valables, invisibles pour l'utilisateur.

Points reportés à la 1.5 par les fiches précédentes, tous traités ici :

| Point | Origine | Section |
|---|---|---|
| Liste et révocation des sessions ; sessions multiples d'un même utilisateur | `connexion.md`, « Reporté » et « Limites connues » | 2, 3 |
| Les fermetures de sessions de la 1.4 (section 8.2) y deviennent visibles ; une révocation en échec après un changement du second facteur se rattrape ici | `double-authentification.md`, « Reporté » et « Limites connues » | 3 |
| Changement du mot de passe depuis une session (`/change-password`), avec `haveIBeenPwned` et la fermeture des autres sessions (S-17) | `mot-de-passe.md`, « Reporté » ; `inscription.md`, section 3 (S-10) | 4 |
| Correction du nom saisi par un tiers sur un compte récupéré par réinitialisation | `mot-de-passe.md`, section 4.3, décision B, « Reporté » | 5 |
| Format de l'heure | `socle-interface.md`, sections 11.3 et « Reporté » | 7 |
| `/list-sessions`, `/revoke-session*`, `/revoke-other-sessions`, `/update-user`, `/change-password` fermés « jusqu'à la 1.5 » ou « une fiche qui en a besoin » | `connexion.md` 1.2, `inscription.md` 2.3, `mot-de-passe.md` 2.2 | 1, 2 |

## Problème

- L'utilisateur ne voit pas ses sessions et ne peut en fermer aucune, sauf la sienne (déconnexion).
- Il ne peut pas changer son mot de passe sans passer par « mot de passe oublié », ni corriger son nom.
- Tels que Better Auth 1.7.7 les fournit (section 1), les points d'entrée :
  - `/list-sessions` renvoie **le jeton de chaque session** (la valeur du cookie, qui suffit à se connecter) : un script de la page, ou une extension du navigateur, lirait toutes les sessions du compte (S-82) ;
  - `/revoke-session` demande ce jeton en entrée : le navigateur devrait le connaître ;
  - `/change-password` renvoie le jeton de la nouvelle session dans son corps, ne ferme les autres sessions que sur demande (`revokeOtherSessions`, facultatif), ne supprime pas les liens de réinitialisation encore valables, et n'envoie aucune notification ;
  - `/update-user` accepte aussi `image` et tout champ additionnel déclaré par une extension ;
  - aucun ne limite les essais du mot de passe actuel par compte : une session volée essaierait des mots de passe sans fin, au rythme de la seule limite par adresse IP.

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Quatre points d'entrée de plus | `src/server/auth/points-entree.ts`, `src/server/auth/profil.ts` | Révocation d'une session, des autres sessions ; changement du mot de passe ; modification du nom |
| Dépendances | `src/server/auth/dependances-profil.ts`, `src/server/auth/gestionnaire.ts` | Liaison à Better Auth (adaptateur interne), aux requêtes et aux limites |
| Requêtes | `src/server/db/sessions.ts`, `src/server/db/comptes.ts` | Sessions de l'utilisateur, révocation par identifiant, profil |
| Limites | `src/server/debit/limites.ts`, `src/server/debit/better-auth.ts` | Par utilisateur, par adresse IP |
| Email | `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | `compte.mot_de_passe_change` |
| Appareil | `src/lib/appareil.ts` | Description de l'appareil depuis le navigateur déclaré, liste fermée |
| Heure | `src/lib/format/dates.ts` | `formaterDateHeure` |
| Pages | `src/app/(compte)/compte/`, `src/app/(compte)/compte/profil/`, `src/app/(compte)/compte/sessions/` | Liens sur `/compte`, profil (nom, mot de passe), sessions |

### 1. Ce que fait Better Auth 1.7.7

Lu dans `node_modules/better-auth/dist/api/routes/session.mjs` (`listSessions`, `revokeSession`, `revokeSessions`, `revokeOtherSessions`), `update-user.mjs` (`updateUser`, `changePassword`), `db/schema.mjs` (`parseSessionOutput`), `db/internal-adapter.mjs` (`createSession`, `deleteUserSessions`) et `plugins/haveibeenpwned/index.mjs`.

| Point | Ce qu'il fait |
|---|---|
| `GET /list-sessions` | Session exigée (`freshSessionMiddleware`). Sessions non expirées de l'utilisateur, chacune passée par `parseSessionOutput`, qui **garde `token`** : corps `[{ id, token, userId, ipAddress, userAgent, createdAt, updatedAt, expiresAt, activeOrganizationId }]`. En panne : `logger.error(e)` puis `500` |
| `POST /revoke-session` | Corps `{ token }`. Supprime la session si elle est à l'utilisateur, sinon ne fait rien ; dans les deux cas `{ status: true }` (aucune différence entre une session d'un autre et une absente). Échec de la suppression : `logger.error(nom, erreur)`, `500` |
| `POST /revoke-sessions` | Supprime **toutes** les sessions de l'utilisateur, la courante comprise ; `{ status: true }` |
| `POST /revoke-other-sessions` | Supprime les sessions non expirées de l'utilisateur sauf la courante, une par une (`Promise.all`) ; `{ status: true }` |
| `POST /change-password` | Corps `{ newPassword, currentPassword, revokeOtherSessions? }`. Longueurs (`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`). Hache **d'abord** le nouveau mot de passe (l'extension `haveIBeenPwned` agit sur ce hachage pour le chemin `/change-password` : `PASSWORD_COMPROMISED`), **puis** vérifie l'actuel (`400 INVALID_PASSWORD`), écrit le nouveau hachage. Avec `revokeOtherSessions: true` : `deleteUserSessions` (toutes, la courante comprise), `createSession(userId)` **sans reprise** de l'ancienne (adresse IP et navigateur relus de la requête, `activeOrganizationId` perdu, échéance de 7 jours à partir de là), cookie de session posé. Corps : `{ token, user }`, **jeton en clair**. Ni notification, ni suppression des jetons de réinitialisation, ni rappel `onPasswordReset` |
| `POST /update-user` | Corps `{ name?, image?, ...champs additionnels }`, `email` refusé (`EMAIL_CAN_NOT_BE_UPDATED`). `internalAdapter.updateUser`, puis le cookie de session réécrit (`setSessionCookie`) ; `{ status: true }` |

**Sessions en base.** `session` porte `id` (uuid, `generateId: "uuid"`), `token` (32 caractères, la valeur du cookie avant la signature), `user_id`, `ip_address` (lue de `x-forwarded-for`, seul en-tête admis, 1.1), `user_agent`, `created_at`, `updated_at`, `expires_at`, `active_organization_id`. Sans prolongation (`disableSessionRefresh`, 1.2), `updated_at` ne bouge pas après la création : **aucune « dernière activité »** n'est connue (section 3.3).

**Journal.** Les `logger.error` ci-dessus passent par `consignerAuth` (1.1) : une ligne fixe `[auth] error`, sans message ni argument. `onAPIError.throw` relance l'erreur vers la passerelle.

### 2. Les points d'entrée (T-55, S-81, S-82)

#### 2.1 Ouverts par cette fiche

Mêmes étapes que la section 2.2 de `inscription.md` (origine, taille et type, schéma strict, réponse traduite en une liste fermée, jamais le corps de Better Auth). Les quatre points sont **composés** par la passerelle, comme ceux de la 1.4 : seul `/change-password` appelle Better Auth ; les trois autres agissent par nos requêtes (`src/server/db/`) ou par l'adaptateur interne de Better Auth, sans réponse de Better Auth à filtrer.

| Méthode et chemin public | Usage | Ce que fait la passerelle | Cookie transmis à Better Auth |
|---|---|---|---|
| `POST /revoke-session` | UC-05 étape 2 : une session | `revoquerSessionDe(utilisateur, identifiant, jetonCourant)` | Aucun appel |
| `POST /revoke-other-sessions` | UC-05 étape 2 : toutes sauf la sienne | `revoquerAutresSessions(utilisateur, jetonCourant)` (1.4) | Aucun appel |
| `POST /change-password` | Changer son mot de passe (S-17) | Contrôles, puis `/change-password` avec `revokeOtherSessions: true`, puis section 4 | Session **seule** |
| `POST /update-user` | Corriger son nom | `modifierNom(utilisateur, nom)` par `internalAdapter.updateUser` | Aucun appel |

**Schémas** (`src/schemas/profil.ts`, stricts) :

| Point | Corps admis | Refusés notamment |
|---|---|---|
| `revoke-session` | `{ session }`, un uuid (forme `z.uuid()`) | `token`, `id`, tout jeton, champ inconnu |
| `revoke-other-sessions` | `{}` | tout champ |
| `change-password` | `{ motDePasseActuel, nouveauMotDePasse }`, 1 à 128 caractères chacun (la longueur minimale du nouveau est vérifiée à part : `mot_de_passe_trop_court`) | `revokeOtherSessions`, `currentPassword`, `newPassword`, champ inconnu |
| `update-user` | `{ nom }`, règle du nom de l'inscription (100 caractères au plus, aucun caractère de contrôle, non vide après suppression des espaces de bord) | `name`, `image`, `email`, champ inconnu |

**Ordre des contrôles** (les quatre points) :

1. origine, type, taille, schéma (comme tout point) ;
2. **session** relue par la même lecture que la gestion de la 1.4 (`lireSession` de l'adaptateur interne : absente, expirée, adresse non vérifiée, cookie forgé) et cookie de session présent : sinon `connexion_requise`, rien d'autre appelé ;
3. **limite du profil** par utilisateur (`auth.profil_compte`, section 6) ;
4. `change-password` seulement : limite `auth.mot_de_passe_compte`, puis longueur minimale du nouveau mot de passe, puis **mot de passe actuel** (`motDePasseValide`, dépendance de la 1.4, sans rien écrire) : `mot_de_passe_incorrect` ; puis **mot de passe compromis** (`motDePasseCompromis`, 1.3) : `mot_de_passe_compromis`, Better Auth jamais appelé ;
5. l'opération ;
6. après le succès : section 3 ou 4.

Le mot de passe actuel est vérifié **avant** Better Auth, et avant le service Have I Been Pwned : un mauvais mot de passe actuel ne part jamais vers le service (même sous la forme de 5 caractères d'empreinte), et l'ordre de Better Auth (hachage du nouveau d'abord) n'a plus d'effet visible.

#### 2.2 Restent fermés

| Points d'entrée | Jusqu'à |
|---|---|
| `GET /list-sessions` | **Toujours.** Son corps porte le jeton de chaque session ; la liste est lue par la page, côté serveur (section 3.1) |
| `POST /revoke-sessions` | **Toujours.** Fermer toutes ses sessions, la courante comprise, revient à « fermer les autres » puis « se déconnecter », deux boutons existants |
| `/change-email`, `/delete-user`, `/delete-user/callback`, `/verify-password`, `/update-session` | Une fiche qui en a besoin (suppression du compte : `THREATS.md` 6, « chaque utilisateur gère son propre compte ») |
| Tous ceux de `connexion.md` 1.2, `mot-de-passe.md` 2.2, `double-authentification.md` 2.3 | Inchangé |

Le test d'inventaire passe à **dix-huit** points ouverts ; chaque point déclaré par l'instance, hors de la liste, répond comme une adresse inexistante, Better Auth jamais appelé.

#### 2.3 Réponses

| Situation | Réponse |
|---|---|
| Révocation d'une session (à soi, d'un autre utilisateur, inexistante, ou la courante) | `200 { ok: true }`, la même dans les quatre cas (S-02, section 3.2) |
| Autres sessions fermées | `200 { ok: true }` |
| Mot de passe changé | `200 { ok: true }` et le **seul** cookie de la nouvelle session |
| Nom modifié | `200 { ok: true }` |
| Sans session valable | `401 { ok: false, raison: "connexion_requise" }` |
| Mot de passe actuel faux | `400 { ok: false, raison: "mot_de_passe_incorrect" }` |
| Nouveau mot de passe trop court, compromis | `400 mot_de_passe_trop_court`, `400 mot_de_passe_compromis` |
| Limite atteinte (adresse IP, utilisateur) | `429 { ok: false, raison: "trop_de_requetes" }` |
| Panne, service Have I Been Pwned injoignable, réponse de Better Auth hors de la forme attendue | `500 { ok: false, raison: "erreur", incident }` |

Aucune raison nouvelle : toutes sont déjà dans la liste fermée de `/api/auth` (1.1 à 1.4) et reconnues par `appel-auth.ts`.

### 3. Les sessions (UC-05, F-004, T-03)

#### 3.1 Lecture, côté serveur seulement

La page `/compte/sessions` appelle `lireComptePourPage(lireSessions)`. `ContexteCompte` gagne `sessionId` (identifiant de la session de la requête, lu avec elle : `SessionLue` gagne `sessionId`). `lireSessions` (`src/server/auth/sessions-compte.ts`) appelle `sessionsDe(utilisateurId)` (`src/server/db/sessions.ts`, requête par `db`, `WHERE user_id = $1 AND expires_at > now()`, filtrée sur l'utilisateur de la session, RR-8) et rend, pour chaque session :

| Champ | Contenu | Jamais |
|---|---|---|
| `id` | L'identifiant (uuid) : il ne permet aucune connexion, et ne sert qu'à désigner la session à fermer | Le jeton |
| `courante` | Vrai pour la session de la requête | |
| `appareil` | Description fermée (section 3.4) | Le texte du navigateur déclaré |
| `adresseIp` | L'adresse enregistrée si c'est une adresse IPv4 ou IPv6 valide (`isIP` de `node:net`), sinon `null` (« inconnue ») | Une autre valeur |
| `ouverteLe`, `expireLe` | Instants (`created_at`, `expires_at`) | |

Ordre : la session courante d'abord, puis les autres de la plus récente à la plus ancienne. Le navigateur ne reçoit que ces champs, dans le rendu de la page (composant serveur) ; aucun point d'entrée ne les rend.

#### 3.2 Révocation (UC-05, étapes 2 et 3)

- **Une session** : `DELETE FROM session WHERE id = $1 AND user_id = $2 AND token <> $3` (`revoquerSessionDe`, `src/server/db/sessions.ts`). Une session d'un autre utilisateur, une session inexistante et la session courante ne sont pas touchées, et la réponse est la même (`{ ok: true }`) : on n'apprend rien d'un identifiant (UC-05 « Abus », S-02). La session courante se ferme par « Se déconnecter » (1.2), qui vérifie la suppression en base.
- **Les autres** : `revoquerAutresSessions(utilisateurId, jetonCourant)` de la 1.4, inchangée.
- **Immédiat** (UC-05, étape 3) : la session est relue en base à chaque requête (aucun cache de session dans un cookie, 1.2) ; une session supprimée est refusée dès la requête suivante, par la chaîne comme par la passerelle.
- **Aucun mot de passe demandé** : fermer une session est un geste de défense. Un voleur de session qui ferme celles du titulaire le déconnecte, sans plus ; le titulaire se reconnecte (mot de passe, et code s'il a un second facteur), puis ferme la session du voleur ou change son mot de passe (section 4). Exiger le mot de passe ralentirait le titulaire face à une session suspecte.
- **Aucun email** : l'utilisateur voit le résultat à l'écran ; une alerte à chaque fermeture n'apprend rien au titulaire qui la fait, et un voleur la ferait taire en fermant d'abord les sessions.
- Après la réponse, la page se recharge (`router.refresh()`) : la liste relue en base est la preuve affichée.

#### 3.3 « Dernière activité » (écart à UC-05, étape 1)

UC-05 cite « appareil, date, dernière activité ». La dernière activité n'est pas connue : la session n'est jamais réécrite après sa création (décision 3 de la 1.2, aucune écriture pendant la lecture d'une page). **Retenu** : « Ouverte le » et « Expire le », avec l'heure. L'enregistrer demanderait une écriture en base à chaque requête ou à intervalle, donc une décision sur la décision 3 de la 1.2 (« Choix restants », 1).

#### 3.4 L'appareil : une description fermée (T-34)

Le navigateur déclaré (`User-Agent`) est choisi par qui ouvre la session, donc par un attaquant qui a le mot de passe : un texte comme « Support : appelez le 07… » s'afficherait chez le titulaire. `decrireAppareil(userAgent)` (`src/lib/appareil.ts`, fonction pure) ne rend que deux valeurs de listes fermées :

- navigateur : Edge, Opera, Samsung Internet, Firefox, Chrome, Safari, sinon « Navigateur inconnu » (ordre de recherche fixé : Edge et Opera portent aussi « Chrome », Chrome porte aussi « Safari ») ;
- système : Windows, Android, iOS (iPhone, iPad), macOS, ChromeOS, Linux, sinon « système inconnu ».

Affiché : « Chrome sur Android ». Le texte déclaré n'est jamais affiché ni transmis au navigateur. Un attaquant peut se déclarer « Safari sur iOS » : la description aide à reconnaître une session, elle ne prouve rien ; l'adresse IP et la date la complètent.

#### 3.5 Les fermetures des autres fiches, visibles ici

Connexion (révocation de la session du navigateur qui se reconnecte, 1.2), réinitialisation (toutes, 1.3), activation, remplacement et désactivation du second facteur (autres sessions, 1.4), changement du mot de passe (section 4) : la liste montre le résultat. Une révocation en échec après un changement du second facteur (`double-authentification.md`, « Limites connues ») se rattrape par « Fermer les autres sessions ».

### 4. Changer son mot de passe depuis une session (S-17, S-10)

Page `/compte/profil`, bloc « Mot de passe » : « Mot de passe actuel », « Nouveau mot de passe » (même composant et mêmes règles que la réinitialisation, `choix-mot-de-passe.tsx` : 12 caractères au moins, indications), « Enregistrer ».

1. Contrôles de la section 2.1 (mot de passe actuel, puis Have I Been Pwned).
2. `POST /change-password` interne : `{ currentPassword, newPassword, revokeOtherSessions: true }`, cookie de session seul.
3. Réponse lue : succès sans cookie de session neuf, ou jeton absent : `erreur`. Codes de Better Auth traduits : `INVALID_PASSWORD` → `mot_de_passe_incorrect`, `PASSWORD_TOO_SHORT` → `mot_de_passe_trop_court`, `PASSWORD_COMPROMISED` → `mot_de_passe_compromis`, `429` → `trop_de_requetes`, tout autre → `erreur`.
4. **Toutes les autres sessions fermées, vérifié** : Better Auth a supprimé toutes les sessions et en a ouvert une neuve ; la passerelle appelle ensuite `revoquerAutresSessions(utilisateurId, jetonNeuf)` (une session ouverte pendant l'opération, par une connexion simultanée, est fermée aussi). Échec : `erreur`, aucun cookie (section « Limites connues »).
5. **Liens de réinitialisation encore valables supprimés** (`supprimerJetonsReinitialisation`, 1.3) : un lien demandé avant le changement ne permet plus de le défaire. Échec : ligne `[auth]` fixe, la réponse reste un succès (le lien expire en 30 minutes au plus).
6. **Notification** `compte.mot_de_passe_change` planifiée (section 8).
7. Réponse : `{ ok: true }` et le seul cookie de la nouvelle session ; le navigateur reste connecté.

**Pourquoi une session neuve, et non garder la courante** : quand le titulaire change son mot de passe parce qu'il soupçonne un vol de son cookie, garder le même jeton laisserait la copie volée valable. La rotation de Better Auth (`revokeOtherSessions: true`) remplace aussi la session courante. Effet : la nouvelle session dure 7 jours à partir du changement (comme la rotation de la 1.4, acceptée pour la même raison : le changement exige le mot de passe, il vaut une connexion), et perd l'organisation active (aucune avant la 2.1 ; « Reporté »).

**Pas de code du second facteur exigé** : il n'apporterait rien contre la prise du compte. Un attaquant qui a une session et le mot de passe, sans le second facteur, ne peut pas se reconnecter quand sa session expire (la connexion demande le code, et la réinitialisation ne retire pas le second facteur, T-04). Son changement de mot de passe ferme les sessions du titulaire, qui reçoit l'email, réinitialise depuis sa boîte et ferme ainsi toutes les sessions, celle de l'attaquant comprise. La 1.4 exigeait le code pour les codes de secours, parce qu'ils donnent un accès durable sans téléphone ; un mot de passe, non. La nouvelle authentification avant une action sensible relève de la 1.6 (S-14), qui ne cite pas ce changement.

**Le même mot de passe** que l'actuel est accepté (Better Auth l'accepte, aucune règle de `SPEC.md` ne l'interdit) : les sessions sont fermées quand même, ce qui sert à qui veut seulement « tout fermer ».

### 5. Corriger son nom (report de la 1.3, décision B)

Page `/compte/profil`, bloc « Nom » : le nom actuel prérempli, « Enregistrer ». Le serveur supprime les espaces de bord, applique la règle de l'inscription (section 2.1), écrit par `internalAdapter.updateUser(utilisateurId, { name })` (jamais `image`, ni un autre champ), et répond `{ ok: true }`. Aucun email : le nom n'apparaît encore dans aucun email ni aucun écran d'un tiers (il apparaîtra dans la barre latérale et chez les autres membres au jalon 2) ; le titulaire voit le changement à l'écran.

Le nom est affiché par React, échappé ; jamais dans un attribut ni une adresse. L'adresse email est affichée en lecture seule (son changement, `/change-email`, reste fermé).

### 6. Les limites (S-11, T-01)

Valeurs dans `limites.ts` seulement (règle 15) ; aucune règle `(fenêtre, maximum)` partagée entre deux limites `auth.*` (invariant de la 1.1).

| Nom | Maximum | Fenêtre | Par | Où |
|---|---|---|---|---|
| `auth.profil_compte` | 30 | 1 h | Utilisateur | Notre passerelle, les quatre points, avant tout autre contrôle que la session |
| `auth.mot_de_passe_compte` | 8 | 24 h | Utilisateur | Notre passerelle, `change-password`, avant la vérification du mot de passe actuel |
| `auth.changement_mot_de_passe` | 4 | 10 min | Adresse IP | Better Auth, chemin interne `/change-password` |

- **Effet sur T-01** : une session volée essaie au plus 8 mots de passe actuels par jour sur un compte, quelle que soit la provenance (sans la limite par utilisateur : celle de Better Auth seule, environ 576 par jour et par adresse IP).
- **Blocage par un voleur de session** : 8 essais faux bloquent le changement du mot de passe du titulaire 24 heures au plus. La réinitialisation (1.3) reste ouverte : elle ferme toutes les sessions, celle du voleur comprise, et change le mot de passe.
- **Valeur comptée** : l'identifiant de l'utilisateur de la session, jamais l'entrée.

### 7. L'heure (NF-02)

`formaterDateHeure(instant)` (`src/lib/format/dates.ts`) → `20/10/2026 à 14:05`, heure d'Abidjan (UTC+0, fuseau fixé comme `formaterDate`), sur 24 heures, minutes sur deux chiffres, assemblée depuis les parties d'`Intl.DateTimeFormat` (même résultat sur le serveur et dans tout navigateur). Une date invalide lève une `RangeError`. Le mot « à » vit dans `src/textes/commun.ts` (NF-01). Les pages sont rendues par le serveur : l'heure ne dépend pas du fuseau du navigateur.

### 8. L'email (règle 17, S-55, T-65)

| Modèle | Quand | Contenu |
|---|---|---|
| `compte.mot_de_passe_change` | Mot de passe changé depuis une session | Sujet « Votre mot de passe a été modifié ». « Le mot de passe de votre compte Facturation PME vient d'être modifié depuis une session ouverte, et vos autres sessions ont été fermées. Si vous êtes à l'origine de ce changement, aucune action n'est attendue. » ; « Sinon, choisissez sans attendre un nouveau mot de passe depuis cette page : » ; lien `mot-de-passe-oublie` |

Planifié par `after()` depuis `src/server/auth/emails.ts`, adresse lue en base par l'identifiant de l'utilisateur (`adresseUtilisateur`, 1.4), jamais reçue de la requête. Aucun paramètre (`z.strictObject({})`), ni date, ni adresse IP, ni appareil. Limites : `email.reinitialisation`, puis `email.application`, sans limite par destinataire (comme `compte.mot_de_passe_modifie`, décision par défaut 8 de la 1.3 : l'alerte suit une preuve du mot de passe, bornée par `auth.mot_de_passe_compte`, et ne doit pas être réduite au silence). Un modèle distinct de `compte.mot_de_passe_modifie`, dont le texte dit « toutes vos sessions » (réinitialisation).

### 9. Les pages

| Adresse | Zone | Contenu |
|---|---|---|
| `/compte` | `(compte)` | Deux blocs de plus : « Profil » (lien « Modifier » vers `/compte/profil`) et « Sessions » (lien « Voir les sessions » vers `/compte/sessions`) |
| `/compte/profil` | `(compte)` | Adresse email (lecture seule) ; bloc « Nom » ; bloc « Mot de passe ». `lireComptePourPage(lireProfil)` : nom et adresse de l'utilisateur de la session seulement |
| `/compte/sessions` | `(compte)` | Liste (section 3.1) : appareil, « Cette session » ou bouton « Fermer », adresse IP, « Ouverte le », « Expire le » ; « Fermer les autres sessions » s'il y en a d'autres. `lireComptePourPage(lireSessions)` |

Formulaires affichés après hydratation, `<noscript>` sinon (comme la 1.1). Interface selon `docs/DESIGN-SYSTEM.md` (compétence `interface`), textes dans `src/textes/compte.ts`, vérifiée à 390 et 1280 px ; les deux pages rejoignent le projet `mobile-390` (avec un compte connecté, comme `affichage-connecte`). Aucune métadonnée propre dans `(compte)/` (règle de la 1.2). Chaque `page.tsx` appelle `lireComptePourPage` (règle 5, test d'inventaire).

Après un changement du mot de passe : message « Mot de passe modifié. Vos autres sessions ont été fermées. », champs vidés. Après la modification du nom : « Nom enregistré. ».

### 10. Journal (S-70, T-39)

- Aucun journal d'audit : il exige une organisation (décision 7 de la 1.2). La trace remise est l'email du changement de mot de passe ; l'état se lit en base (`session`, `account.updated_at`, `user.updated_at`).
- Journal technique : lignes fixes `[auth]` (avec incident pour `erreur`) et `[email]`. Jamais un mot de passe, un jeton, un identifiant de session, une adresse email, une adresse IP, un nom, ni le texte du navigateur.
- Test : un passage complet (révocations, changement du mot de passe, du nom) avec capture du journal ; aucune de ces valeurs n'y figure (Vitest et site construit).

### 11. Contrôle après déploiement

`scripts/controle-deploiement.mjs` (production seulement, lancé par le workflow, jamais par l'assistant) :

- `comptes:*` passe de quatorze à **dix-huit** `POST` sans corps ni `Origin`, identiques au `POST` d'un chemin inexistant tant que les comptes sont fermés ;
- `auth:identique` gagne `GET /api/auth/list-sessions` et `POST /api/auth/revoke-sessions` ;
- `/compte/profil` et `/compte/sessions` contrôlées comme `/compte` (sans session et avec un cookie forgé, identiques, sans texte du gabarit).

**Interaction avec la PR 2 de la 1.3 (#52)** : #52 doit passer les dix-huit `POST` à `403 refuse` (et non quatorze) ; à reprendre dans #52 avant sa fusion (`PLAN.md`, jalon 1).

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Ouvrir `/list-sessions` et `/revoke-session` de Better Auth | Le corps de la liste porte le jeton de chaque session, et la révocation l'attend en entrée (S-82) |
| Liste des sessions par un point d'entrée `GET` de la passerelle | Inutile : la page la lit côté serveur ; un point de plus à protéger et à contrôler |
| Désigner une session par une empreinte de son jeton | L'identifiant de la session existe déjà, ne permet aucune connexion, et une empreinte du jeton serait une valeur de plus dérivée du secret |
| `/revoke-sessions` (toutes, la courante comprise) | « Fermer les autres » puis « Se déconnecter » ; un bouton de moins qui déconnecte par erreur |
| Mot de passe exigé pour fermer une session | Ralentit la défense ; un voleur n'y gagne qu'une déconnexion du titulaire (section 3.2) |
| Changement du mot de passe sans `revokeOtherSessions` puis fermeture des autres par notre requête | La session courante garderait son jeton : une copie volée resterait valable (section 4) |
| Code du second facteur exigé pour changer de mot de passe | Aucun gain contre la prise du compte (section 4) ; S-14 et la 1.6 ne le citent pas |
| Afficher le texte du navigateur déclaré | Texte choisi par qui ouvre la session (section 3.4) |
| Bibliothèque d'analyse du `User-Agent` | Dépendance pour une description indicative ; une liste fermée suffit |
| Enregistrer la dernière activité | Écriture à chaque requête, contraire à la décision 3 de la 1.2 (« Choix restants », 1) |
| Email à chaque fermeture de session ou changement de nom | Aucune information pour le titulaire qui agit ; budget d'emails (RR-10) |
| `/update-user` de Better Auth tel quel | Accepte `image` et les champs additionnels, et réécrit le cookie de session |

## Règles de sécurité et permissions

- **F-004, UC-05** : liste des sessions actives de l'utilisateur, révocation d'une session ou de toutes les autres, effet immédiat (section 3).
- **S-17** : changer son mot de passe ferme toutes les autres sessions, et remplace la courante (section 4).
- **S-10** : nouveau mot de passe de 12 caractères au moins, refusé s'il est compromis (Have I Been Pwned, fermé par défaut).
- **S-11, T-01** : 8 essais du mot de passe actuel par jour et par compte, 30 opérations de profil par heure, limite par adresse IP (section 6).
- **T-03** : une session révoquée est refusée dès la requête suivante (relue en base) ; la rotation au changement du mot de passe invalide aussi une copie volée du cookie courant.
- **S-82** : aucun jeton de session dans un corps ni dans le rendu d'une page ; l'identifiant de session seul désigne une session.
- **S-02** : révoquer la session d'un autre utilisateur, une session inexistante ou la sienne donne la même réponse, sans effet hors de ses propres sessions.
- **T-34** : texte du navigateur jamais affiché, nom échappé par React.
- **S-81** : `verifierOrigine` sur les quatre nouveaux `POST`.
- **S-85** : identifiant d'incident sur toute réponse `erreur`. **S-87** : réponse de Better Auth vérifiée (cookie de session neuf présent) avant transmission.
- **T-55** : dix-huit points ouverts, `/list-sessions` et `/revoke-sessions` toujours fermés ; test d'inventaire ; contrôle après déploiement.
- **T-65** : lien de l'email vers la page fixe `mot-de-passe-oublie` seulement.
- **Matrice des droits** : aucune ligne (`THREATS.md` section 6 : « chaque utilisateur gère son propre compte : mot de passe, double authentification, sessions »). Aucune action `declarerAction` (portée compte, sans organisation).
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3) : « sans session » : chaque point sans session ou avec un cookie forgé reçoit `connexion_requise`, rien appelé ; les pages « introuvable ». « Autre organisation » devient « autre compte » : la session de A ne lit ni ne ferme jamais une session de B, ne change ni le nom ni le mot de passe de B. « Rôle insuffisant » : sans objet (aucun rôle ne restreint son propre compte) ; remplacé par « point fermé » (`/list-sessions`, `/revoke-sessions`). « Entrée falsifiée » : `token`, `revokeOtherSessions`, `image`, `email`, noms de champs de Better Auth, champ inconnu, identifiant hors forme, nom à caractère de contrôle.
- **Tables** : aucune créée ni modifiée. `session`, `user`, `account`, `verification` sont des tables de Better Auth (RR-8) ; les lectures et écritures nouvelles (`sessionsDe`, `revoquerSessionDe`, `lireProfil`, `modifierNom`) filtrent sur l'utilisateur de la session.

## Dépendances nouvelles

Aucune.

## Migration

Aucune. Le dossier `drizzle/` n'est pas touché.

## Critères d'acceptation

- [ ] Les seuls points d'entrée ouverts de `/api/auth` sont les dix-huit de la section 2 ; `/list-sessions`, `/revoke-sessions` et tout autre point de Better Auth répondent comme une adresse inexistante.
- [ ] En production, les dix-huit `POST` répondent comme un chemin inexistant, octet pour octet.
- [ ] `/compte/sessions` liste les sessions non expirées de l'utilisateur, la courante marquée et en tête, avec appareil (liste fermée), adresse IP, dates et heures ; le rendu ne contient aucun jeton ni le texte du navigateur.
- [ ] Fermer une session la supprime en base ; elle est refusée dès la requête suivante ; la session d'un autre utilisateur, un identifiant inexistant et la session courante donnent la même réponse, sans rien supprimer.
- [ ] « Fermer les autres sessions » ne laisse que la courante.
- [ ] Changer son mot de passe exige le mot de passe actuel ; ferme toutes les autres sessions et remplace la courante (l'ancien cookie refusé, le nouveau valable) ; supprime les liens de réinitialisation en attente ; envoie `compte.mot_de_passe_change` ; l'ancien mot de passe ne connecte plus, le nouveau oui.
- [ ] Mot de passe actuel faux : `mot_de_passe_incorrect`, ni Have I Been Pwned, ni Better Auth appelé, rien changé ; nouveau trop court ou compromis : refus, rien changé ; 9e essai du jour : `trop_de_requetes`.
- [ ] Corriger son nom l'écrit en base pour l'utilisateur de la session seulement ; un nom vide, trop long ou à caractère de contrôle est refusé.
- [ ] Sans session ou avec un cookie forgé : `connexion_requise` sur les quatre points ; pages « introuvable ».
- [ ] Champs falsifiés, sans `Origin` ou d'une autre origine : refusés, rien appelé.
- [ ] Aucun corps de réponse ne contient de jeton ; le changement du mot de passe ne transmet que le cookie de session.
- [ ] Journal du serveur, Vitest et site construit : aucune valeur de la section 10.
- [ ] `formaterDateHeure` : heure d'Abidjan, quel que soit le fuseau du poste.
- [ ] Contrôle après déploiement : dix-huit `POST`, deux chemins fermés de plus, deux pages ; en local, seuls les `comptes:*` échouent.
- [ ] `/compte/profil` et `/compte/sessions` vérifiées à 390 et 1280 px ; captures jointes.
- [ ] `npm run verifier` et `npm run test:integration` verts, sorties montrées.

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code.

### Tests d'attaque, puis unitaires

1. [ ] **T-55, liste fermée** — `src/server/auth/points-entree.attaque.test.ts` : inventaire à dix-huit points ; `GET /list-sessions`, `POST /revoke-sessions`, `/change-email`, `/delete-user`, `GET` des quatre nouveaux : `reponseInexistante()`, Better Auth jamais appelé ; en production, les dix-huit `POST` aussi.
2. [ ] **S-81, entrée falsifiée, sans session** — `src/server/auth/profil.attaque.test.ts` : quatre points, `Origin` absente, étrangère ; `token`, `id`, `revokeOtherSessions`, `currentPassword`, `newPassword`, `name`, `image`, `email`, champ inconnu, identifiant hors forme, nom vide, de 101 caractères ou à caractère de contrôle, corps trop grand, autre type : refus, aucune dépendance appelée ; sans session ou cookie forgé : `connexion_requise`, ni limite ni opération.
3. [ ] **Autre compte** — même fichier : `revoquerSessionDe` reçoit toujours l'utilisateur de la session et son jeton, jamais une valeur reçue ; même réponse quand rien n'est supprimé.
4. [ ] **Ordre du changement du mot de passe** — même fichier : limites avant tout ; trop court → `mot_de_passe_trop_court`, mot de passe jamais vérifié ; actuel faux → ni Have I Been Pwned ni Better Auth ; compromis → Better Auth jamais appelé ; service injoignable → `erreur` ; Better Auth reçoit exactement `{ currentPassword, newPassword, revokeOtherSessions: true }` et le seul cookie de session.
5. [ ] **S-82 et après le succès** — même fichier : `200 { token, user }` → `{ ok: true }` et le seul cookie de session neuf ; sans cookie neuf → `erreur` ; `revoquerAutresSessions` appelé avec le jeton neuf ; en échec : `erreur`, aucun cookie ; jetons de réinitialisation supprimés (échec : succès quand même, ligne `[auth]`) ; email planifié ; traductions `INVALID_PASSWORD`, `PASSWORD_TOO_SHORT`, `PASSWORD_COMPROMISED`, `429`, `5xx`, code inconnu.
6. [ ] **Limites** — `limites.test.ts` : trois limites nouvelles ; `reglesBetterAuth()` couvre `/change-password` ; invariant des règles.
7. [ ] **Appareil** — `src/lib/appareil.test.ts` : chaînes réelles de Chrome, Edge, Opera, Firefox, Safari, Samsung Internet sur Windows, macOS, Android, iOS, Linux, ChromeOS ; chaîne vide, absente, texte libre (« Support : appelez… ») → « Navigateur inconnu sur système inconnu » ; la sortie n'est jamais qu'une combinaison des deux listes.
8. [ ] **Heure** — `dates.test.ts` : `formaterDateHeure`, poste à UTC+14, minuit, 23:59, date invalide.
9. [ ] **Email** — `emails.test.ts` et `modeles.test.ts` : `compte.mot_de_passe_change`, texte, aucun paramètre, lien `mot-de-passe-oublie`, limites `email.reinitialisation` puis `email.application`.
10. [ ] **Journal** — `journal.attaque.test.ts`, ajout : passage simulé des quatre points avec capture de la console : aucune valeur de la section 10.
11. [ ] **Pages** — `inventaire.test.ts` : deux nouvelles pages appellent `lireComptePourPage`, sans métadonnée ; `exposer.test.ts` : `ContexteCompte` porte `sessionId` ; `session.test.ts` : `sessionId` lu ; composant de la liste : aucun jeton, aucun texte du navigateur.

### Tests d'intégration, avec base

12. [ ] `src/server/db/profil.integration.test.ts` (par `traiterRequeteAuth`, vraie instance, transport `memoire`) : trois sessions d'un compte A et une de B ; `sessionsDe` ne rend que celles de A, sans jeton ; fermeture d'une session de A : supprimée, refusée ensuite ; fermeture de la session de B avec la session de A : B intacte, même réponse ; identifiant inexistant et session courante : même réponse, rien supprimé ; « autres » : seule la courante reste.
13. [ ] Même fichier, **mot de passe** : changement réussi : ancien cookie refusé, nouveau valable, autres sessions supprimées, jeton de réinitialisation en attente supprimé, email ; connexion avec l'ancien mot de passe refusée, avec le nouveau acceptée ; actuel faux : rien changé ; 9e essai : `trop_de_requetes` ; `compteur_debit` sans valeur en clair.
14. [ ] Même fichier, **nom** : écrit pour A seulement, B inchangé.

### Tests de bout en bout

15. [ ] `e2e/profil-sessions.spec.ts` (ordinateur-1280 et mobile-390) : compte vérifié, deux connexions (deux contextes de navigateur) ; `/compte/sessions` : deux sessions, « Cette session » ; fermer l'autre : l'autre contexte reçoit la page « introuvable » à la navigation suivante ; `/compte/profil` : nom corrigé ; mot de passe changé : message, toujours connecté, l'autre contexte déconnecté, email lu dans le dossier du transport `fichier` ; reconnexion avec le nouveau mot de passe. Aucun corps de réponse ne contient `token` ; aucun jeton dans le HTML de la page des sessions.
16. [ ] `e2e/auth.attaque.spec.ts` : `GET /api/auth/list-sessions` avec une session valide : identique à `/api/auth/n-existe-pas`. `e2e/controle-deploiement.spec.ts` : dix-huit `POST`, chemins fermés, deux pages. `e2e/affichage-connecte.spec.ts` : les deux pages à 1280, 390 et 360 px, cibles de 44 px, focus, captures. Journal du site construit (`JOURNAL_SITE_E2E`) sans mot de passe, jeton, adresse ni nom.

### Vérifications manuelles (développeur)

- [ ] **À regrouper avec la preuve de la 1.4**, sur la prévisualisation, adresse propre du déploiement : deux navigateurs (ordinateur et téléphone) connectés au même compte ; la liste montre les deux, appareil reconnaissable ; fermer l'un depuis l'autre ; changer le mot de passe : l'autre navigateur déconnecté, email reçu ; corriger le nom. Journaux du déploiement sans mot de passe, jeton ni adresse.

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `src/server/auth/profil.ts` | Nouveau : les quatre points composés |
| `src/server/auth/dependances-profil.ts` | Nouveau : liaisons (adaptateur interne, requêtes, limites, email) |
| `src/server/auth/points-entree.ts` | Dix-huit points ; dépendance `profil` |
| `src/server/auth/gestionnaire.ts`, `src/server/db/outils-test/` | Liaison, banc d'intégration, dépendances inertes |
| `src/server/auth/sessions-compte.ts` | Nouveau : `lireSessions`, `lireProfil` pour les pages |
| `src/server/auth/session.ts`, `src/server/actions/action.ts`, `src/server/actions/exposer.ts` | `sessionId` dans `SessionLue` et `ContexteCompte` |
| `src/server/db/sessions.ts`, `src/server/db/comptes.ts` | `sessionsDe`, `revoquerSessionDe`, `lireProfil` |
| `src/server/debit/limites.ts`, `src/server/debit/better-auth.ts` | Trois limites, règle de `/change-password` |
| `src/server/auth/emails.ts`, `src/server/email/modeles.ts`, `src/textes/emails.ts` | `compte.mot_de_passe_change` |
| `src/schemas/profil.ts` | Nouveau |
| `src/lib/appareil.ts`, `src/lib/format/dates.ts`, `src/textes/commun.ts` | Appareil, heure |
| `src/app/(compte)/compte/page.tsx`, `src/app/(compte)/compte/profil/page.tsx`, `src/app/(compte)/compte/sessions/page.tsx`, `src/components/compte/*`, `src/textes/compte.ts` | Pages et formulaires |
| `src/components/compte/appel-auth.ts` | Quatre chemins de plus dans `PointAuth` |
| `scripts/controle-deploiement.mjs` | Dix-huit `POST`, deux chemins fermés, deux pages |
| Tests listés ci-dessus, `e2e/*.spec.ts`, `playwright.config.ts` | |
| `CLAUDE.md` (ligne du contrôle), `docs/THREATS.md` (T-03, 10), `docs/PLAN.md`, `docs/STRUCTURE.md`, `docs/features/connexion.md`, `mot-de-passe.md`, `double-authentification.md`, `socle-interface.md`, `controle-deploiement.md` (reports clos) | Documents |

## Reporté

- **2.1** : le changement du mot de passe ouvre une session sans organisation active (rotation de Better Auth) ; la 2.1, qui choisit l'organisation d'arrivée, la reprend ou renvoie vers le choix.
- **Jalon 2** : nom de l'utilisateur dans la barre latérale (déjà reporté par la 1.2) ; il affichera le nom corrigé ici.
- **Une fiche à venir** : suppression du compte (`/delete-user`) et changement d'adresse email (`/change-email`), toujours fermés.
- **8.1** : signalement des blocages `auth.mot_de_passe_compte` au service de suivi.

## Limites connues

- **Pas de « dernière activité »** (section 3.3).
- **Description de l'appareil déclarative** : un attaquant choisit son `User-Agent` (section 3.4) ; l'adresse IP et les dates la complètent.
- **Adresse IP de la session** : celle de `x-forwarded-for` à la connexion ; un changement de réseau ensuite n'est pas visible.
- **Fermeture en échec après un changement du mot de passe** : le mot de passe est changé, et Better Auth a déjà supprimé l'ancienne session ; la réponse est `erreur`, sans cookie : l'utilisateur se reconnecte avec le nouveau mot de passe, et « Fermer les autres sessions » rattrape une session ouverte entre-temps.
- **Blocage du changement par un voleur de session** : 8 essais faux le bloquent 24 heures (section 6) ; la réinitialisation reste ouverte.
- **Rotation** : le changement du mot de passe ouvre une session de 7 jours à partir de là.

## Décisions par défaut

Appliquées par l'assistant le 2026-10-20, selon sa recommandation (consigne du développeur), sauf avis contraire du relecteur.

1. **Quatre points composés**, `/list-sessions` et `/revoke-sessions` toujours fermés ; liste lue par la page, côté serveur (sections 2, 3.1).
2. **Session désignée par son identifiant**, jamais par son jeton ; même réponse pour toute révocation (section 3.2).
3. **Aucun mot de passe** pour fermer une session ; aucun email (section 3.2).
4. **« Ouverte le » et « Expire le »** à la place de la dernière activité (section 3.3).
5. **Appareil en liste fermée**, texte déclaré jamais affiché, sans dépendance (section 3.4).
6. **Changement du mot de passe** : mot de passe actuel, puis Have I Been Pwned, avant Better Auth ; rotation complète de la session ; fermeture vérifiée ; liens de réinitialisation supprimés ; email (section 4).
7. **Aucun code du second facteur** pour changer de mot de passe (section 4).
8. **Nom** par l'adaptateur interne, champ `name` seul, sans email (section 5).
9. **Limites** de la section 6 : 30 opérations par heure, 8 essais du mot de passe par jour, 4 changements par 10 minutes et par adresse IP.
10. **Email** `compte.mot_de_passe_change` sur le budget `email.reinitialisation`, sans limite par destinataire (section 8).
11. **Deux pages** `/compte/profil` et `/compte/sessions`, liens depuis `/compte` (section 9).
12. **Une seule PR**, fermée en production comme le reste des comptes.

## Choix restants

1. **Dernière activité** (UC-05) : l'enregistrer (une écriture par requête, ou au plus une par heure et par session) revient sur la décision 3 de la 1.2 ; recommandé : non, dates d'ouverture et d'expiration seulement.
2. **Code du second facteur au changement du mot de passe** : recommandé non (section 4) ; à revoir avec la 1.6 si le développeur préfère l'uniformité avec les codes de secours.
3. **Organisation active après le changement du mot de passe** : perdue par la rotation de Better Auth ; à traiter en 2.1 (« Reporté »).
