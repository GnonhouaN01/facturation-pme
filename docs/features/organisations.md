# Fonctionnalité : créer son organisation et en changer (2.1)

Statut : en cours

## Contexte

Un utilisateur connecté, adresse vérifiée, n'a aujourd'hui aucune organisation : toute page de `(app)/` lui répond « introuvable », et la connexion le mène à `/compte` (1.2). Le gérant d'une PME doit créer son entreprise et en devenir Propriétaire (UC-06) ; un comptable externe, membre de plusieurs organisations, doit passer de l'une à l'autre (UC-11).

Cas d'utilisation : UC-06, UC-11, et UC-02 étape 4 (arrivée après la connexion). Exigences : F-010, F-014, S-01, S-02, S-12, S-13, RR-8. Reports reçus : organisation active perdue après un changement de mot de passe (1.5) ; configuration du créateur et variante « portée compte » de la chaîne (0.4, `chaine-controles.md`, section 8.3, divergence 4) ; UC-02 4a (1.4) ; trace éventuelle des évènements de second facteur au journal d'une organisation (`SPEC.md` section 8, point 5).

## Problème

- Aucune action ne crée une organisation ni une adhésion : la seule voie est l'outil de bout en bout `e2e/organisation-e2e.ts`, par SQL.
- La chaîne de contrôles exige une organisation active et une adhésion (étapes 3 et 6) : elle ne peut pas porter une action qui n'en a pas encore.
- La session ne garde pas l'organisation active quand Better Auth la remplace (changement du mot de passe, `profil-sessions.md`, section 4).

## Solution retenue

### 1. Ce que fait Better Auth 1.7.7 (lu dans `node_modules/better-auth/dist/plugins/organization/`)

| Point | Comportement constaté |
|---|---|
| `POST /organization/create` (`routes/crud-org.mjs`) | Corps `z.object` non strict (`name`, `slug`, `logo`, `metadata`, `userId`, `keepCurrentActiveOrganization`). Crée l'organisation, **puis** l'adhésion, par deux écritures de l'adaptateur **sans transaction** (défaut figé par `config.test.ts`) : une panne entre les deux laisse une organisation sans Propriétaire. Rôle du créateur : `creatorRole`, défaut `owner`. Puis `setActiveOrganization` sur la session. Ni journal d'audit, ni limite par compte (seulement `organizationLimit`, un plafond total) |
| `POST /organization/set-active` | Vérifie l'adhésion, écrit `session.active_organization_id`, repose le cookie de session ; accepte aussi un `organizationSlug` |
| Autres (`/organization/list`, `/get-full-organization`, `/update`, `/delete`, membres, invitations, équipes, `has-permission`) | Appliquent les rôles du module, sans notre matrice ni notre journal (T-55) |
| Connexion (`sign-in`, `verify-totp`) | `createSession` n'écrit aucune organisation active : une session neuve n'en a pas. Le module n'ajoute aucun rappel de base de données sur la création d'une session |
| Journal technique | Erreurs par `logger.error`, réduites à une ligne fixe par `consignerAuth` (T-39, 1.1) |
| Tables | `organization` (`slug` `NOT NULL UNIQUE`, `created_at` sans défaut), `member` (`role` défaut `member`, sans unicité du couple), `session.active_organization_id` (`text`) : déjà créées (`schema/auth.ts`), sans règle d'isolation (RR-8) |

### 2. Les points d'entrée de Better Auth : aucun n'est ouvert (T-55)

**Retenu (décision 1)** : la liste fermée de `/api/auth` ne change pas. Tout `/organization/*` reste fermé et répond comme une adresse inexistante, vérifié après chaque déploiement. Créer et changer d'organisation sont deux **actions serveur** de l'application, par une variante de la chaîne de contrôles (section 3), et non des points composés de la passerelle :

- la création doit écrire l'organisation, l'adhésion, la trace d'audit et l'organisation active **dans une seule transaction** ; Better Auth ne le fait pas ;
- la règle 5 de `CLAUDE.md` veut que toute action passe par la fonction commune de contrôle, et la fiche de la 0.4 a prévu cette variante pour la 2.1.

Le module `organization()` reste chargé pour son schéma et le champ `activeOrganizationId` de la session. Réglage ajouté, défense en profondeur : `allowUserToCreateOrganization: false` et `creatorRole: "proprietaire"` (le point reste fermé ; un appel par `auth.api` sans session et avec `userId` passerait quand même : aucun code ne le fait).

### 3. La chaîne « portée compte »

Une action de compte n'a ni organisation active ni adhésion au départ. Elle se déclare par `declarerActionCompte` (`src/server/actions/action.ts`) et s'expose par le même `exposer` (règle G inchangée). Champs, tous obligatoires, sans défaut :

```ts
declarerActionCompte({
  nom: "organisation.creer",
  entree: schemaCreationOrganisation,     // z.strictObject
  cible: "nouvelle_organisation",         // ou "adhesion"
  journal: "organisation.creee",          // ou null
  debit: "organisation.creation",         // limite « par utilisateur », ou null
  executer: async (ctx, entree) => { ... },
});
```

| # | Contrôle | Refus |
|---|---|---|
| 1 | Origine (S-81) | `refuse` |
| 2 | Session relue en base, adresse vérifiée | `connexion_requise` |
| 3 | Comptes fermés en production (`COMPTES_OUVERTS_EN_PRODUCTION` faux et `VERCEL_ENV=production`) | `refuse` |
| 4 | Limite de débit, pour l'utilisateur de la session, avant toute transaction | `trop_de_requetes` |
| 5 | Validation de l'entrée (schéma strict) | `invalide` |
| 6 | Transaction `executerDansOrganisation(id)` : `nouvelle_organisation`, identifiant tiré par la chaîne (`randomUUID`), jamais par l'entrée ; `adhesion`, `entree.organisationId` (le schéma doit l'avoir en `z.uuid()`, vérifié par `declarerActionCompte`) | `refuse` si l'identifiant est invalide |
| 7 | `adhesion` : `lireAdhesion` `FOR SHARE` dans cette transaction, rôle parmi les quatre ; absente (organisation inexistante, d'un tiers, ou sans adhésion) : même refus (S-02) | `refuse` |
| 8 | Le service, dans la transaction | `refuse` par `ctx.introuvable()` |
| 9 | Trace déclarée et non écrite : annulation | `erreur` |

Différences avec la chaîne d'organisation : validation avant la transaction (pas de rôle à vérifier d'abord, donc rien à sonder) ; pas d'étape 7 (double authentification) ni 8 (nouvelle authentification) : aucune action de compte ne lit de données d'une organisation, et l'étape 7 s'applique à la requête suivante, dans l'organisation choisie. Contexte remis au service : `utilisateurId`, `sessionId`, `doubleAuthentification`, `organisationId`, `role` (`null` pour une nouvelle organisation), `tx`, `journaliser` (si `journal`), `introuvable`.

Règle M étendue : `executerChaineCompte` ne s'importe que dans `exposer.ts` et les tests, `creerChaineCompte` que dans les tests. Registre : `REGISTRE_COMPTE` à côté de `REGISTRE` ; le test d'inventaire accepte une déclaration de l'un ou de l'autre, noms uniques sur les deux ; `registre.integration.test.ts` exige un cas par action de compte (sans session : `connexion_requise` ; avec session : accepté).

### 4. Créer une organisation (UC-06, F-010)

Sur `/compte`, carte « Créer une organisation » : un champ « Raison sociale », bouton principal « Créer l'organisation ».

Service, dans la transaction de la nouvelle organisation :

1. `organization` : `id` de la chaîne, `name` = raison sociale validée, `slug` = l'identifiant (unique par construction, jamais affiché), `created_at` = maintenant ;
2. `member` : l'utilisateur de la session, rôle `proprietaire` (R2 de la 0.4) ;
3. `session.active_organization_id` = la nouvelle organisation, pour la session de la requête seulement (`id` et `user_id` de la session) ;
4. trace `organisation.creee`, ressource : l'organisation, détails vides.

Réponse : `{ organisationId, doubleAuthentificationRequise }`. Le navigateur va sur `/tableau-de-bord`, ou sur `/compte/double-authentification` si le second facteur n'est pas actif.

**Champs saisis (décision 4)** : la raison sociale seule, comme UC-06 étape 1. Adresse, NCC, régime d'imposition, mentions légales, logo, taux de TVA et délais sont la fiche de l'organisation (F-011, UC-07, 2.2). Le RCCM ne figure pas dans `SPEC.md` : il n'est pas ajouté ici (question pour la 2.2). Les valeurs par défaut d'UC-06 étape 2 (TVA 18 %, validité et échéance de 30 jours) vivent dans les tables de paramètres, créées par la 2.2 avec ces valeurs par défaut : aucune table ni migration en 2.1.

**Raison sociale** (`src/schemas/organisation.ts`) : texte normalisé NFC, espaces de bord retirés, suites d'espaces réduites à une ; 2 à 100 caractères ; au moins une lettre ou un chiffre ; aucun caractère de contrôle ni de format (`\p{Cc}`, `\p{Cf}`, dont les marques de direction) ; entrée brute bornée à 400 caractères avant normalisation. Deux organisations peuvent porter le même nom (deux entreprises homonymes) : aucune unicité.

**Second facteur du créateur (décision 2) : exigé juste après, pas avant.** UC-06 étape 3 dit « le système lui demande d'activer la double authentification si ce n'est pas fait ». La création ne donne accès à aucune donnée ; l'étape 7 de la chaîne refuse déjà toute lecture et toute action d'un Propriétaire sans second facteur (S-12, S-13, T-02). Bloquer avant ajouterait un contrôle sans protéger plus. Effets : réponse `doubleAuthentificationRequise: true`, renvoi vers l'activation ; sur `/compte`, l'organisation porte la mention « Activez la double authentification pour ouvrir cette organisation » ; la désactivation reste refusée à un Propriétaire (1.4).

### 5. L'organisation active (UC-11, F-014, UC-02 étape 4)

**Lieu (décision 3)** : `session.active_organization_id`, seule source lue par la chaîne (inchangé). Écrite seulement par nos deux actions, dans leur transaction, pour la session de la requête. Jamais lue de l'entrée d'une action d'organisation.

**Changer d'organisation** : action de compte `organisation.changer`, cible `adhesion`, entrée `{ organisationId }`. L'adhésion est relue `FOR SHARE` dans la transaction de l'organisation demandée ; puis la session est mise à jour. Réponse `{ doubleAuthentificationRequise }` (rôle Propriétaire ou Comptable sans second facteur : UC-11 2a, renvoi vers UC-04). Aucune trace d'audit : changer d'organisation ne modifie aucune donnée.

**Nouvelle connexion** : la session neuve n'a pas d'organisation active ; la connexion mène toujours à `/compte`, qui liste les organisations de l'utilisateur, chacune avec « Ouvrir l'organisation » (une action). Pas d'ouverture automatique de la dernière organisation : il faudrait la garder hors de la session (colonne sur `user`, donc migration et régénération de `auth.ts`), pour un clic économisé. Choix restant 1.

**Changement du mot de passe (report de la 1.5)** : le point composé `/change-password` lit l'organisation active de la session reçue avant d'appeler Better Auth, puis l'écrit sur la session neuve, par une seule requête qui exige l'adhésion (`UPDATE session ... WHERE token = <neuf> AND user_id = <utilisateur> AND EXISTS (adhésion)`). Valeur invalide, absente ou adhésion retirée entre-temps : la session neuve reste sans organisation. En échec : ligne fixe au journal technique, le changement reste fait (comme la suppression des liens de réinitialisation). La réinitialisation par lien (1.3) ferme toutes les sessions : rien à reprendre.

**Changer depuis l'application** : la barre latérale affiche le nom de l'organisation active (lu dans la transaction de la chaîne, filtré sur l'organisation de la transaction, RR-8) et un lien « Changer d'organisation » vers `/compte`.

### 6. La liste des organisations sur `/compte`

Lue par `lireComptePourPage`, pour l'utilisateur de la session seulement : `member` joint à `organization`, filtré sur `member.user_id` (RR-8), triée par nom ; chaque ligne : identifiant, raison sociale, rôle. Un rôle hors des quatre n'est pas affiché (aucun droit, T-51). Plafond de lecture : 100 lignes (T-42). Aucun membre ni aucune autre donnée d'une organisation n'est lue.

### 7. Limites de débit (UC-06 abus, T-41)

| Limite | Valeur | Par |
|---|---|---|
| `organisation.creation` (nouvelle) | 3 par 24 heures | utilisateur |
| `membre.action` (existante), pour `organisation.changer` | 60 par minute | utilisateur |

Aucun plafond total d'organisations par compte : `SPEC.md` n'en prévoit pas (UC-06 dit « par compte et par jour »).

### 8. Journal d'audit (S-70, règle 9)

- Nouvelle action de la liste fermée : `organisation.creee`, ressource `organisation`, détails vides. Écrite dans la transaction de la création ; une organisation créée sans sa trace n'existe pas.
- Changement d'organisation : rien.
- **`SPEC.md` section 8, point 5 (décision 5)** : une organisation ne reçoit **pas** de trace des évènements de second facteur ou de connexion de ses Propriétaires et Comptables. Ce sont des évènements du compte, pour plusieurs organisations à la fois ; la trace remise est l'email au titulaire (1.4), et la remise à zéro manuelle reste la seule exception écrite. `SPEC.md` est mis à jour.
- Effet sur les tests : une organisation qui a une trace ne se supprime pas (ajout seul, `ON DELETE RESTRICT`). Chaque création par l'action dans un test d'intégration laisse une organisation sur `dev` (préfixe de slug impossible : le slug est l'identifiant ; nom de test reconnaissable `Test ...`). Les tests en créent au plus cinq par exécution (comme `journal-audit.md`, section 3, accepté). En bout en bout, la base est jetable.

### 9. Écrans

`/compte` (zone compte, `lireComptePourPage`) :

1. Carte « Vos organisations » : pour chacune, la raison sociale (texte échappé par React, S-51), le rôle en libellé, et un bouton secondaire « Ouvrir l'organisation » (nom accessible complété par la raison sociale) ; la mention du second facteur si exigé et inactif. Sans organisation : « Vous n'êtes membre d'aucune organisation. »
2. Carte « Créer une organisation » : champ, aide (« Le nom de votre entreprise, tel qu'il apparaîtra sur vos documents. Vous compléterez la fiche ensuite. »), bouton principal « Créer l'organisation », seul bouton principal de l'écran.
3. Les cartes existantes (second facteur, profil, sessions).

Résultats : `invalide` → message sous le champ ; `refuse`, `trop_de_requetes`, `connexion_requise` → bandeau `TEXTES_RESULTATS` ; `erreur` → « Une erreur est survenue. » et l'incident. Sans JavaScript : bandeau « Activez JavaScript » comme les autres formulaires de compte. Cibles de 44 px, focus visible, 360 px.

L'action est passée en propriété par la page au composant client (aucun composant n'importe `src/app/`).

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Ouvrir `/organization/create` et `/organization/set-active` dans la passerelle | Écritures sans transaction (organisation orpheline possible), ni journal ni limite par compte ; T-55 et le contrôle après déploiement exigent `/organization/*` fermé |
| Points composés sous un autre chemin de `/api/auth` | Ce n'est pas de l'authentification ; la règle 5 veut la fonction commune de contrôle, et la 0.4 a prévu la variante « portée compte » |
| Exiger le second facteur avant la création | Ne protège rien de plus que l'étape 7 ; contredit UC-06 étape 3 |
| Dernière organisation gardée dans une colonne de `user` | Migration et régénération de `auth.ts` pour un clic ; choix restant 1 |
| Ouvrir automatiquement la seule organisation à la connexion | Quatre points de connexion à modifier (mot de passe, code, code de secours, vérification) ; reporté avec le choix 1 |
| Créer en 2.1 les tables de paramètres et de taux | Périmètre de la 2.2 (F-011) ; migration évitée ici |
| Une page dédiée `/compte/nouvelle-organisation` | Une page de plus au contrôle après déploiement pour un seul champ |

## Règles de sécurité et permissions

- Exigences : S-01, S-02, S-03, S-12, S-13 (étape 7 inchangée, appliquée après), S-50, S-51, S-70, S-81, RR-8.
- Menaces : T-02, T-41, T-50, T-51, T-53, T-55, T-17.
- Matrice : aucune ligne. Créer et changer d'organisation sont ouverts à tout utilisateur connecté (`DESIGN.md` section 1, « Tout utilisateur connecté ... crée une organisation et change d'organisation active ») ; ils ne passent pas par `peut`.
- Tables de Better Auth (RR-8) : chaque requête de la fiche filtre explicitement — liste : `member.user_id` = session ; nom de l'organisation active : `organization.id` = organisation de la transaction ; écriture de la session : `session.id` et `session.user_id` de la session ; reprise après le mot de passe : jeton neuf, utilisateur et adhésion. Test d'attaque pour chacune, avec deux organisations.
- Aucune table créée ni modifiée. Aucun point d'entrée nouveau sous `/api/auth`.

## Dépendances nouvelles

Aucune.

## Migration

Aucune : `organization`, `member` et `session.active_organization_id` existent ; la nouvelle limite et la nouvelle action du journal sont du code.

## Critères d'acceptation

- [ ] Un utilisateur connecté crée une organisation : organisation, adhésion `proprietaire`, organisation active de sa session et trace `organisation.creee`, dans une seule transaction (une panne de la trace annule tout).
- [ ] Sans second facteur, la création aboutit, la réponse demande l'activation, et toute page de l'application reste « introuvable » jusqu'à l'activation.
- [ ] Raison sociale invalide (vide, 1 caractère, 101 caractères, caractères de contrôle ou de direction, seulement des signes) : `invalide`, rien n'est écrit. Clé en trop (`organisationId`, `role`, `slug`) : `invalide`.
- [ ] 4e création en 24 heures : `trop_de_requetes`.
- [ ] Changer vers une organisation dont on est membre : session mise à jour, rôle de cette organisation à la requête suivante.
- [ ] Changer vers une organisation inexistante, d'un tiers, ou un identifiant mal formé : `refuse` (même réponse), session inchangée.
- [ ] Sans session : `connexion_requise` ; origine étrangère : `refuse` ; production avec comptes fermés : `refuse`.
- [ ] Après un changement du mot de passe, la session neuve garde l'organisation active (si l'adhésion existe toujours).
- [ ] `/compte` ne liste que les organisations de l'utilisateur de la session.
- [ ] La barre latérale affiche le nom de l'organisation active et le lien « Changer d'organisation ».
- [ ] `/api/auth/organization/*` répond toujours comme une adresse inexistante.

## Tests à écrire

### Tests d'attaque, puis unitaires

- `action-compte.test.ts` (chaîne factice) : ordre des contrôles ; origine ; sans session ; production fermée ; débit avant toute transaction ; entrée invalide avant la transaction ; identifiant de la nouvelle organisation tiré par la chaîne même si l'entrée en porte un (refusé par le schéma) ; adhésion absente et rôle inconnu → `refuse` ; trace manquante → annulation ; déclaration invalide (schéma non strict, `adhesion` sans `organisationId`, limite d'une autre portée, journal inconnu).
- `organisation.test.ts` (schéma) : normalisation et refus de la section 4.
- `exposer.test.ts` : une déclaration de compte s'expose, une copie non marquée est refusée.
- `inventaire.test.ts` : registre de compte, noms uniques sur les deux registres.
- `profil.attaque.test.ts` : reprise de l'organisation active après le changement du mot de passe ; panne de la reprise : changement fait, ligne fixe.
- Matrice, limites et liste du journal : nouvelles entrées.

### Tests d'intégration, avec base

- `organisations.integration.test.ts` (`src/server/db/`) : création réelle (quatre écritures, rôle, session) ; panne de la trace : rien n'est écrit ; changement réel ; refus vers B pour un membre de A, vers une organisation inexistante (même résultat, session inchangée) ; liste filtrée sur l'utilisateur (RR-8, deux organisations, un autre membre) ; nom de l'organisation active filtré ; reprise après le mot de passe avec et sans adhésion.
- `registre.integration.test.ts` : cas des deux actions de compte.

### Tests de bout en bout

- `e2e/organisations.spec.ts` (deux projets) : un compte vérifié sans second facteur crée son organisation, est renvoyé vers l'activation, active le second facteur, ouvre l'organisation, voit son nom dans la barre latérale ; un second compte, membre de deux organisations (outil SQL existant), passe de l'une à l'autre par « Changer d'organisation » ; raison sociale vide : message sous le champ. Captures à 390 et 1280 px.

### Vérifications manuelles (développeur)

- Aucune avant la fusion. À l'ouverture des comptes en production (#52) : rien de plus, les actions suivent la même constante.

## Fichiers concernés

`src/server/actions/action.ts`, `exposer.ts`, `registre.ts`, `organisations.ts` (déclarations) ; `src/server/services/organisations.ts` ; `src/server/db/requetes/organisations.ts`, `src/server/db/organisations.ts`, `src/server/db/sessions.ts` ; `src/server/auth/config.ts`, `profil.ts`, `dependances-profil.ts`, `gestionnaire.ts` ; `src/server/debit/limites.ts` ; `src/server/journal/actions.ts` ; `src/schemas/organisation.ts` ; `src/app/(compte)/compte/page.tsx` et `actions.ts` ; `src/app/(app)/layout.tsx` ; `src/components/compte/organisations.tsx` ; `src/components/gabarits/gabarit-application.tsx` ; `src/textes/compte.ts`, `navigation.ts` ; `eslint.config.mjs` (règle M) ; tests ; `docs/SPEC.md` (point 5), `docs/THREATS.md` (RR-8), `docs/features/chaine-controles.md` (renvoi).

## Reporté

- 2.2 : valeurs par défaut d'UC-06 étape 2 (TVA 18 %, délais de 30 jours) dans les tables de paramètres ; RCCM à trancher ; formulaire de confirmation à plusieurs changements (nouvelle authentification, `PLAN.md`).
- Ouverture automatique de la dernière organisation (choix restant 1).

## Décisions par défaut

1. Aucun point de Better Auth ouvert ; actions serveur par la chaîne « portée compte ».
2. Second facteur exigé juste après la création, par l'étape 7 existante.
3. Organisation active dans la session seule ; reprise après le changement du mot de passe ; liste à l'arrivée.
4. Raison sociale seule à la création, 2 à 100 caractères.
5. Aucune trace d'organisation pour les évènements de compte de ses membres.
6. 3 créations par 24 heures et par utilisateur ; aucun plafond total.

## Choix restants

1. Ouvrir automatiquement la dernière organisation à la connexion (colonne sur `user`, migration) ou garder la liste.
2. Plafond total d'organisations par compte (anti-abus durable), non prévu par `SPEC.md`.
3. RCCM dans la fiche de la 2.2.
