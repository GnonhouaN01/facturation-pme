# Fonctionnalité : nouvelle authentification avant une action sensible

Statut : validée le 2026-10-21 par application des recommandations de l'assistant (consigne du développeur : une seule passe, recommandations appliquées) ; implémentée le 2026-10-21 (« Notes de l'implémentation ») ; les vrais choix restants sont listés à la fin (« Choix restants »).

Jalon 1, fonctionnalité 1.6 de `docs/PLAN.md`. Taille M. Cas d'utilisation : UC-07 (étape 4), UC-10 (étape 2), UC-13 (étape 3), UC-30 (étape 1). Exigences : S-14, S-33 (partie « après nouvelle authentification »), S-10, S-11, S-81, S-85. Menaces : T-12, T-44, T-51, T-33 (session volée), T-01 (essais de mot de passe par une session volée), T-39, T-55.

## Contexte

Depuis la 0.4, toute action déclarée avec `nouvelleAuthentification: true` est **refusée** par l'étape 8 de la chaîne (`docs/features/chaine-controles.md`, section 5, décision 10). Les fonctionnalités 2.2 (instructions de paiement), 2.4 (rôles), 2.5 (suppression de l'organisation) et 7.2 (export complet) en ont besoin : elles ne peuvent pas être livrées avant la 1.6.

Points reportés à la 1.6 par les fiches précédentes :

| Point | Origine | Section |
|---|---|---|
| Le mécanisme (`freshAge` de Better Auth, 24 h par défaut, « trop long pour S-14 ») | `chaine-controles.md`, section 11 ; `connexion.md`, « Reporté » | 1, 3 |
| « Le code du second facteur pourra en faire partie » | `double-authentification.md`, « Reporté » | 4 |
| Code du second facteur pour changer de mot de passe, « à trancher dans la 1.6 » | `profil-sessions.md`, section 4 ; décision du développeur du 2026-10-21 | 9 |
| `/verify-password` fermé « jusqu'à une fiche qui en a besoin » | `mot-de-passe.md`, section 2.2 ; `profil-sessions.md`, section 2.2 | 2 |

## Problème

- Une session volée (cookie copié, poste laissé ouvert) donne aujourd'hui tout ce que le rôle permet. Pour les quatre actions de S-14, l'effet est grave et durable : détourner les règlements (T-12), s'attribuer un rôle (T-51), supprimer l'organisation (T-44), emporter le fichier client (T-33).
- La chaîne sait refuser ces actions, pas les permettre sous condition : aucune preuve d'une saisie récente des identifiants n'existe.

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Un point d'entrée de plus | `src/server/auth/points-entree.ts`, `src/server/auth/nouvelle-authentification.ts` | `POST /api/auth/verify-password` : mot de passe, et code si le second facteur est actif ; pose la preuve |
| Dépendances | `src/server/auth/dependances-nouvelle-authentification.ts`, `src/server/auth/gestionnaire.ts` | Liaison aux fonctions de la double authentification, aux requêtes et à la limite |
| Requêtes | `src/server/db/nouvelle-authentification.ts` | Poser la preuve ; la consommer dans la transaction d'une action |
| Chaîne | `src/server/actions/action.ts`, `src/server/actions/refus.ts` | Étape 8 : preuve exigée et consommée ; nouveau refus `nouvelle_authentification_requise` |
| Limite | `src/server/debit/limites.ts` | `auth.nouvelle_authentification` |
| Schéma | `src/schemas/nouvelle-authentification.ts` | Entrée stricte du point |

### 1. Ce que fait Better Auth 1.7.7

Lu dans `node_modules/better-auth/dist/api/routes/session.mjs` (`freshSessionMiddleware`, `sensitiveSessionMiddleware`), `api/routes/password.mjs` (`verifyPassword`), `utils/password.mjs` (`validatePassword`), `context/create-context.mjs` (`freshAge`), `plugins/two-factor/verify-two-factor.mjs` et `plugins/two-factor/totp/index.mjs`.

| Élément | Ce qu'il fait |
|---|---|
| `session.freshAge` | 24 h par défaut. `freshSessionMiddleware` refuse (`403 SESSION_NOT_FRESH`) quand `Date.now() - session.createdAt >= freshAge`. **C'est l'âge de la session, pas une nouvelle saisie** : une session volée dans la minute qui suit la connexion passe ; la seule façon de « rafraîchir » est une nouvelle connexion, qui crée une autre session. N'est utilisé que par `/list-sessions` (fermé, 1.5) |
| `POST /verify-password` | `scope: "server"` (absent du routeur HTTP), `sensitiveSessionMiddleware` (session relue en base, sans cache). Corps `{ password }` ; `validatePassword` compare au hachage du compte `credential`. Réponse `{ status: true }` ou `400 INVALID_PASSWORD`. **N'écrit rien** : ni en base, ni dans la session, ni au journal. Aucune limite par compte |
| `POST /two-factor/verify-totp` **avec une session** | `verifyTwoFactor` prend la branche « session » : aucune tentative comptée (`beginAttempt` vide), **aucun verrouillage du compte vérifié ni compté** (`assertTwoFactorNotLocked` et `recordTwoFactorFailure` ne s'appliquent qu'à la connexion). Succès : `{ token, user }` (jeton de la session en clair), sans cookie ni écriture. Échec : `401 INVALID_CODE` |
| `POST /two-factor/verify-totp` avec une session, **ligne à confirmer** (remplacement en cours, 1.4 section 7.1) | Le code est vérifié contre la **nouvelle** clé, puis la ligne est marquée vérifiée : le remplacement est achevé sans `/two-factor/confirm-enable`, donc sans fermeture des autres sessions ni email |
| `POST /two-factor/verify-backup-code` avec une session | Consomme le code de secours (liste chiffrée réécrite), répond `{ token, user }` sans cookie |
| Journal | Aucun `logger` sur ces chemins, hors panne (`consignerAuth`, ligne fixe `[auth] error`, 1.1) |

Conséquences : `freshAge` ne prouve pas une saisie récente ; `/verify-password` et la vérification du code avec une session ne laissent **aucune trace** utilisable par la chaîne et **ne limitent rien** par compte. La preuve, son stockage, sa durée et la limite sont à construire.

### 2. Le point d'entrée (T-55, S-81)

`POST /api/auth/verify-password`, composé par notre passerelle (comme `/update-user` en 1.5) : le nom est celui d'un point déclaré par Better Auth, qui n'est jamais appelé tel quel.

Contrôles communs de `points-entree.ts` : fermé en production tant que `COMPTES_OUVERTS_EN_PRODUCTION` vaut `false` (réponse d'une adresse inexistante), origine, taille et type du corps, schéma strict, durée plancher, réponse traduite.

Entrée (`schemaNouvelleAuthentification`, strict) : `{ motDePasse: string (1 à 128), code?: string (1 à 20) }`, longueurs de la 1.4. Aucun autre champ (ni `password`, ni session, ni utilisateur, ni durée).

Ordre, arrêt au premier refus :

1. Cookie de session et session relue en base (adaptateur interne, comme la 1.4) : sinon `connexion_requise`.
2. Limite `auth.nouvelle_authentification` (section 5), comptée avant toute vérification : sinon `trop_de_requetes`.
3. Forme du code selon l'état du second facteur relu avec la session : actif et code absent ou mal formé, ou inactif et code présent : `invalide`. Second facteur actif mais remplacement en cours (ligne à confirmer) : `refuse` ; vérifier le code achèverait le remplacement (section 1).
4. Mot de passe (`motDePasseValide`, fonction de la 1.4) : sinon `mot_de_passe_incorrect`, et le code n'est pas vérifié.
5. Code, si le second facteur est actif, par `verifierCode` de la 1.4 : code de l'application (tranche réservée, anti-rejeu, puis `/two-factor/verify-totp` avec le cookie de session) ou code de secours (empreinte, `/two-factor/verify-backup-code`, consommé). Sinon `code_incorrect`. Un code de secours utilisé planifie l'email `compte.code_secours_utilise` (1.4).
6. Preuve posée pour **cette session** (section 3).
7. `200 { ok: true }`, aucun cookie, aucun corps de Better Auth.

| Situation | Réponse |
|---|---|
| Preuve posée | `200 { ok: true }` |
| Sans session valable | `401 connexion_requise` |
| Entrée hors schéma, code absent ou en trop | `400 invalide` |
| Remplacement du second facteur en cours | `403 refuse` |
| Mot de passe faux | `400 mot_de_passe_incorrect` |
| Code faux, déjà utilisé, code de secours inconnu | `400 code_incorrect` |
| Limite atteinte (utilisateur, ou adresse IP sur le chemin interne du code) | `429 trop_de_requetes` |
| Panne | `500 erreur` avec incident |

Aucune raison nouvelle pour `/api/auth`. Le test d'inventaire passe à **dix-neuf** points ouverts.

### 3. La preuve

- **Où** : une ligne de `verification` (table de Better Auth, sans organisation, déjà utilisée par la 1.4 pour l'anti-rejeu), `identifier = "nouvelle-authentification:<identifiant de la session>"`, `value = <identifiant de l'utilisateur>`, `expires_at = now() + 5 minutes`. **Aucune migration.** Une nouvelle preuve remplace la précédente de la même session (suppression puis insertion, dans une transaction).
- **Liée à la session** par son identifiant, jamais par son jeton : une autre session du même utilisateur (un autre navigateur, ou la copie d'un voleur ouverte par une nouvelle connexion) n'en profite pas. Une session fermée (déconnexion, changement de mot de passe) laisse une ligne orpheline, inutilisable, qui expire.
- **Durée : 5 minutes**, constante unique (`DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES`). Assez pour saisir puis valider le formulaire de l'action ; assez court pour qu'un poste laissé ouvert après une action sensible ne serve pas à une autre plus tard.
- **Usage unique** : consommée par l'action qu'elle autorise (section 4). Deux actions sensibles demandent deux saisies (UC-10 : changer deux rôles).
- Purge : les lignes expirées de `verification` sont déjà supprimées par la tâche quotidienne (`purgerJetonsExpires`, 1.3).

### 4. L'étape 8 de la chaîne

Pour une déclaration `nouvelleAuthentification: true`, après les étapes 6 (adhésion, matrice) et 7 (second facteur par rôle), avant la validation de l'entrée (9), **dans la transaction de l'action** :

```sql
DELETE FROM verification
WHERE identifier = $1 AND value = $2 AND expires_at > now()
RETURNING id
```

- Une ligne supprimée : l'action continue.
- Aucune : refus `nouvelle_authentification_requise` ; le service n'est pas appelé, l'entrée n'est pas lue.
- **Consommée seulement si l'action aboutit** : la suppression appartient à la transaction ; tout refus ou erreur qui l'annule (service qui lève `ctx.introuvable()`, trace manquante, panne) rend la preuve. Une entrée **invalide** (étape 9) annule aussi la transaction quand une preuve vient d'être consommée : l'utilisateur corrige sa saisie sans se réauthentifier.
- **Concurrence** : deux actions simultanées avec une même preuve ; la seconde attend le verrou de la ligne, puis ne trouve plus rien : une seule passe.
- `nouvelleAuthentification: false` : aucune lecture. Les lectures des pages (`etablirContexte`) ne consomment jamais de preuve.

**Le refus `nouvelle_authentification_requise`** est distinct de `refuse`, pour que l'interface ouvre le formulaire de confirmation (comme `connexion_requise` renvoie vers la connexion). Il ne révèle rien sur une ressource : il n'est atteint qu'après le contrôle du droit (un non-membre, un rôle sans le droit, un Propriétaire sans second facteur reçoivent `refuse` avant), et avant toute lecture de l'entrée. Ajouté au type `Resultat` de `refus.ts`, avec son libellé dans `src/textes/resultats.ts` : « Confirmez votre identité pour continuer. » (affiché par le formulaire de la 2.2).

### 5. La limite (S-11, T-01)

| Nom | Maximum | Fenêtre | Par | Où |
|---|---|---|---|---|
| `auth.nouvelle_authentification` | 10 | 24 h | Utilisateur | Notre passerelle, avant le mot de passe |

Better Auth ne limite ni le mot de passe ni le code vérifiés avec une session (section 1) : sans elle, une session volée essaierait des mots de passe sans fin. Dix essais par jour suffisent à un titulaire qui se trompe ; un voleur sans le mot de passe ne passe pas. Le chemin interne `/two-factor/verify-totp` garde sa limite par adresse IP (`auth.double_auth_code`, 1.4). Aucune règle `(fenêtre, maximum)` partagée avec une autre limite `auth.*` (invariant de la 1.1).

### 6. Les facteurs exigés

Le mot de passe, **et** le code du second facteur quand il est actif. Toute action de S-14 est réservée au Propriétaire (matrice), qui a toujours le second facteur (S-12, étape 7) : en pratique, mot de passe et code. UC-13 l'écrit ainsi ; UC-07, UC-10 et UC-30 ne citent que le mot de passe (écart, « Choix restants », 1). Raison : un mot de passe hameçonné plus un cookie volé ne suffisent pas à détourner les règlements (T-12) ; le téléphone reste nécessaire. Les autres exigences propres à une action (le nom de l'organisation pour UC-13) restent dans l'entrée de l'action.

### 7. Journal et email (S-70, T-39)

- Aucun journal d'audit pour la preuve : elle n'a pas d'organisation (décision 7 de la 1.2). L'action sensible qu'elle autorise écrit sa propre trace, dans sa transaction.
- Aucun email à la pose de la preuve : l'action sensible prévient elle-même (S-33 : email à tous les Propriétaires pour les instructions de paiement). Un code de secours utilisé prévient, comme en 1.4.
- Journal technique : lignes fixes `[auth]`. Jamais un mot de passe, un code, un identifiant de session, un jeton ni une adresse.

### 8. Interface : aucun écran dans la 1.6

Aucune action sensible n'existe encore. Le formulaire de confirmation (mot de passe et code, textes dans `src/textes/`) arrive avec la première d'entre elles, la 2.2 : il s'ouvre quand l'action reçoit `nouvelle_authentification_requise`, appelle `/api/auth/verify-password`, puis renvoie l'action. Le client de `/api/auth` (`appel-auth.ts`) gagne le chemin à ce moment-là.

### 9. Changer de mot de passe : pas de code (report de la 1.5)

Inchangé : le mot de passe actuel suffit. L'analyse de la 1.5 (section 4) tient : un voleur qui a la session et le mot de passe, sans le second facteur, ne peut pas se reconnecter quand sa session expire, et son changement prévient le titulaire, qui reprend la main par la réinitialisation. La 1.6 ajoute un argument : avec le nouveau mot de passe, il ne peut toujours pas faire d'action de S-14, qui demande le code. S-14 ne cite pas ce changement.

### 10. Contrôle après déploiement

`scripts/controle-deploiement.mjs` : `comptes:*` passe de dix-huit à **dix-neuf** `POST` (`/api/auth/verify-password`), identiques au `POST` d'un chemin inexistant tant que les comptes sont fermés. #52 (PR 2 de la 1.3) devra passer ces dix-neuf à `403 refuse` avant sa fusion.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| `freshAge` de Better Auth (session récente) | Mesure l'âge de la session, pas une saisie (section 1) ; « rafraîchir » obligerait à une nouvelle connexion, donc une nouvelle session, et l'organisation active serait perdue |
| Preuve valable une fenêtre de temps, pour plusieurs actions | Un poste laissé ouvert juste après une action sensible en permettrait d'autres ; usage unique plus simple à prouver |
| Mot de passe (et code) dans l'entrée de chaque action sensible | Chaque service relirait des identifiants ; secrets mêlés aux données métier, au schéma et aux erreurs `invalide` ; l'étape 8 ne pourrait plus précéder la lecture de l'entrée |
| Colonne sur `session` (date de la dernière saisie) | Migration d'une table de Better Auth générée ; la ligne de `verification` suffit et expire seule |
| Preuve dans un cookie signé | Une copie du cookie volée avec celui de la session la porterait aussi ; aucune révocation ni usage unique côté serveur |
| `refuse` pour une preuve absente | L'interface ne saurait pas qu'il faut demander les identifiants |
| Mot de passe seul pour UC-07, UC-10, UC-30 | Voir section 6 et « Choix restants », 1 |
| Écran de confirmation dès la 1.6 | Aucune action ne l'utiliserait ; testé à vide (section 8) |

## Règles de sécurité et permissions

- Exigences couvertes : S-14 (mécanisme), S-11 (limite), S-81 (origine, par la passerelle), S-85 (incident).
- Menaces : T-12, T-44, T-51, T-33 (session volée sans le mot de passe ni le téléphone) ; T-01 (essais par une session volée, limite) ; T-55 (point composé, liste fermée) ; T-39 (journal).
- Matrice : inchangée. La 1.6 ne déclare aucune action ; l'étape 8 vaut pour toute déclaration `nouvelleAuthentification: true`.
- Tables : aucune créée ni modifiée ; lignes de `verification` (table de Better Auth, dans `TABLES_SANS_ORGANISATION`).

## Dépendances nouvelles

Aucune.

## Migration

Aucune.

## Critères d'acceptation

- [ ] Une action `nouvelleAuthentification: true` sans preuve reçoit `nouvelle_authentification_requise`, quel que soit le rôle autorisé ; le service n'est pas appelé, l'entrée n'est pas lue.
- [ ] Avec une preuve de la session, posée depuis moins de 5 minutes : l'action passe, une fois ; la seconde est refusée.
- [ ] Une preuve d'une autre session, d'un autre utilisateur ou expirée : refus.
- [ ] Un non-membre, un rôle sans le droit, un Propriétaire sans second facteur : `refuse`, et la preuve n'est pas consommée.
- [ ] Action annulée (service qui refuse, entrée invalide, panne) : la preuve reste.
- [ ] Deux actions simultanées avec une même preuve : une seule passe.
- [ ] `POST /api/auth/verify-password` : ordre session, limite, forme, mot de passe, code ; aucune preuve sur un refus ; aucun cookie ni corps de Better Auth ; fermé en production.
- [ ] Code de l'application rejoué : refusé (anti-rejeu de la 1.4) ; code de secours : consommé, email.
- [ ] Onzième essai dans la journée : `trop_de_requetes`, mot de passe non vérifié.
- [ ] Aucun mot de passe, code, identifiant de session ni jeton dans le journal technique.

## Tests à écrire

### Tests d'attaque, puis unitaires

1. [ ] `src/server/actions/action.test.ts`, étape 8 (remplace « fermée en 0.4 ») : sans preuve, pour chaque rôle autorisé, `nouvelle_authentification_requise`, service non appelé, consommation appelée avec la transaction, l'utilisateur et la session ; avec preuve, service appelé ; ordre `adhesion` puis `preuve` puis `service` ; non-membre, droit refusé, Propriétaire sans second facteur : `refuse`, consommation jamais appelée ; entrée invalide sans preuve : `nouvelle_authentification_requise` ; entrée invalide avec preuve : `invalide` et transaction annulée ; service qui refuse : `refuse`, annulation ; `nouvelleAuthentification: false` et `etablirContexte` : consommation jamais appelée.
2. [ ] `src/server/auth/nouvelle-authentification.attaque.test.ts` : sans cookie, cookie forgé, session expirée : `connexion_requise`, rien posé ; limite atteinte : `trop_de_requetes`, mot de passe non vérifié ; mot de passe faux : `mot_de_passe_incorrect`, code non vérifié, rien posé ; second facteur actif sans code, inactif avec code, champ en trop : `invalide` ; code faux, tranche déjà utilisée : `code_incorrect`, rien posé ; code de secours : preuve posée, email planifié ; succès : preuve posée pour l'utilisateur et la session de la requête, `{ ok: true }`, aucun cookie ; corps de Better Auth (jeton) jamais transmis ; mot de passe et code jamais dans le journal.
3. [ ] `src/server/auth/points-entree.attaque.test.ts` : inventaire à dix-neuf points ; `/verify-password` retiré des chemins fermés ; `GET /verify-password` : adresse inexistante ; fermé en production.
4. [ ] `src/server/debit/limites.test.ts` (existant, invariant) : la nouvelle limite ne partage pas sa règle.

### Tests d'intégration, avec base

5. [ ] `src/server/db/nouvelle-authentification.integration.test.ts` (vraie instance, banc d'inscription de la 1.4, membres réels) : preuve posée par le point, ligne `nouvelle-authentification:<session>` qui expire dans 5 minutes ; action `demo.sensible` acceptée une fois, refusée la seconde ; preuve d'une autre session du même utilisateur, preuve expirée (`expires_at` reculé) : refus ; deux actions simultanées : une seule passe ; entrée invalide et service qui refuse : la preuve reste ; non-membre : `refuse`, preuve restée ; nouvelle preuve qui remplace l'ancienne.
6. [ ] `src/server/db/chaine.integration.test.ts` : `demo.sensible` sans preuve, chaque rôle : `nouvelle_authentification_requise` (Propriétaire, Comptable avec second facteur) ou `refuse` (avant l'étape 8).

### Tests de bout en bout

7. [ ] `e2e/auth.attaque.spec.ts` : `/verify-password` dans les points ouverts en `POST` (sans session : `connexion_requise`) ; `GET` : adresse inexistante.
8. [ ] `e2e/controle-deploiement.spec.ts` et `scripts/controle-deploiement.mjs` : dix-neuf `POST` des comptes.

### Vérifications manuelles (développeur)

Aucune : pas d'écran, et le point est fermé en production (contrôlé par le workflow après déploiement). La preuve manuelle du parcours viendra avec le formulaire de la 2.2.

## Fichiers concernés

- `src/server/auth/nouvelle-authentification.ts`, `dependances-nouvelle-authentification.ts`, `points-entree.ts`, `gestionnaire.ts`, `double-authentification.ts` (export de `verifierCode` et `lireCode`), `dependances-double-auth.ts` (identifiant de la session)
- `src/server/db/nouvelle-authentification.ts`, `src/server/db/outils-test/inscription.ts`, `src/server/db/outils-test/nouvelle-authentification.ts` (dépendances inertes des tests des fiches 1.1 à 1.5)
- `src/server/actions/action.ts`, `refus.ts`
- `src/server/debit/limites.ts`
- `src/schemas/nouvelle-authentification.ts`
- `scripts/controle-deploiement.mjs`, `e2e/auth.attaque.spec.ts`, `e2e/controle-deploiement.spec.ts`
- `docs/features/chaine-controles.md` (étape 8), `CLAUDE.md` (dix-neuf `POST`), `docs/PLAN.md`

## Reporté

- Formulaire de confirmation et chemin dans `appel-auth.ts` : 2.2, première action sensible (section 8).

## Limites connues

- Une preuve posée puis inutilisée reste valable 5 minutes pour sa session : un voleur qui aurait la session dans cet intervalle pourrait faire **une** action sensible. Atténué par l'usage unique et la durée courte.
- Aucun email quand la limite de la nouvelle authentification est atteinte (section 7).
- Pendant un remplacement du second facteur, la nouvelle authentification est refusée jusqu'à sa confirmation (section 2, étape 3).

**Constat hors périmètre** (aucun changement fait) : `/two-factor/generate-backup-codes`, `/two-factor/disable` et `/two-factor/replace` de la 1.4 vérifient le code avec la session sans exiger une ligne active ; pendant un remplacement, un code de la **nouvelle** application achève le remplacement (section 1) sans fermer les autres sessions ni envoyer l'email « second facteur remplacé ». Correctif à faire dans une PR `fix` de la 1.4 : exiger `etat === "active"` comme ici.

## Décisions par défaut

Recommandations de l'assistant, appliquées :

1. Preuve propre à la session dans `verification`, 5 minutes, usage unique, consommée dans la transaction de l'action (sections 3 et 4).
2. Refus distinct `nouvelle_authentification_requise`, après le contrôle du droit (section 4).
3. Mot de passe et code quand le second facteur est actif (section 6).
4. Limite de 10 essais par jour et par utilisateur (section 5).
5. Point `/verify-password` composé, sans appel au point de Better Auth du même nom (section 2).
6. Pas d'écran avant la 2.2 (section 8).
7. Pas de code pour changer de mot de passe (section 9).

## Choix restants

1. **Le code du second facteur pour UC-07, UC-10 et UC-30**, que les cas d'utilisation n'écrivent pas (section 6). Revenir au mot de passe seul demanderait un niveau par déclaration (`nouvelleAuthentification: "mot_de_passe" | "second_facteur"`).
2. **Usage unique ou fenêtre de 5 minutes** (section 3) : l'usage unique impose une saisie par rôle changé (UC-10).

## Notes de l'implémentation

**Phase rouge** (commit `test(1.6)`). Unitaires : 46 échecs (étape 8 de `action.test.ts`, point `/verify-password`, inventaire à dix-neuf, limite), plus les erreurs de type des dépendances absentes. Intégration (sur `dev`) : 15 échecs (11 dans `nouvelle-authentification.integration.test.ts`, 4 dans `chaine.integration.test.ts`). Bout en bout (site construit avant le code) : 2 échecs (`/verify-password` sans session, origine étrangère). Trois tests passaient à vide avant le code (journal sans secret, service qui refuse avec preuve) : un témoin leur a été ajouté avant le commit (statut attendu, étape « preuve » franchie).

**Écarts à la fiche, signalés :**

- La lecture de la session avec son identifiant est une fabrique partagée, `creerLectureSession` (`dependances-double-auth.ts`), utilisée par la double authentification et par la nouvelle authentification : `SessionGestion` de la 1.4 reste inchangée, ses tests aussi.
- `verifierCode` de la 1.4 prend l'utilisateur et le cookie au lieu du contexte de gestion ; ses trois appels sont adaptés, sans changement de comportement.
- `ResultatLecture` garde son type : une lecture ne produit jamais `nouvelle_authentification_requise`, et `traduireLecture` traiterait ce cas inatteignable comme une erreur.
- Les fabriques de chaîne des tests (`action-debit.test.ts`, `action-email.test.ts`, `chaine-debit*.integration.test.ts`, `outils-test/email.ts`) reçoivent la nouvelle dépendance ; la table de limites de `outils-test/email.ts` reçoit la nouvelle limite.
- `scripts/controle-deploiement.mjs` est dans le commit des tests : outil de vérification, dont le test (`e2e/controle-deploiement.spec.ts`) change avec lui.

**Lenteur de `double-authentification.integration.test.ts`** (trois dépassements de 60 s dans un passage complet ralenti) : déjà présente sur `origin/main` (302 à 352 s ; 265 à 298 s sur cette branche), corrigée dans `fix/tests-instables` (activations préparées ensemble avant les tests) : 177 à 198 s, 5 passages verts sur 5 ; passage complet de l'intégration en 187 s.

