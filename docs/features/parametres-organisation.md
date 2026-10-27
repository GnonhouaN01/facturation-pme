# Fonctionnalité : paramètres de l'organisation (2.2)

Statut : validée le 2026-10-28 par application des recommandations de l'assistant (consigne du développeur : une seule passe, recommandations appliquées) ; **migration en attente de l'accord du développeur** (section « Migration »).

Jalon 2, fonctionnalité 2.2 de `docs/PLAN.md`. Taille L. Cas d'utilisation : UC-07, UC-06 (étape 2, valeurs par défaut), UC-02 (étape 4, arrivée après la connexion). Exigences : F-011, F-057, S-14, S-33, S-51, S-53, S-70, RR-8. Menaces : T-12, T-60, T-34, T-62, T-41, T-42, T-50, T-55.

## Contexte

Le Propriétaire doit renseigner ce qui figurera sur ses devis et factures (UC-07) : la fiche de l'organisation, ses taux de TVA, ses délais par défaut, son logo et ses instructions de paiement. Ces dernières décident où le client envoie son argent : leur modification est l'action la plus exposée au détournement (T-12).

Reports reçus :

| Point | Origine |
|---|---|
| Valeurs par défaut d'UC-06 étape 2 (TVA 18 %, validité et échéance de 30 jours), dans les tables de paramètres | `organisations.md`, section 4 et « Reporté » |
| RCCM à trancher | `organisations.md`, choix restant 3 |
| Formulaire de confirmation (mot de passe, et code quand le second facteur est actif) ; plusieurs changements en une seule validation ; repris par la 2.4 | `nouvelle-authentification.md`, section 8 ; `PLAN.md`, jalon 2 |
| Chemin `/verify-password` dans le client de `/api/auth` (`appel-auth.ts`) | `nouvelle-authentification.md`, « Reporté » |

Décisions du développeur reçues avec la consigne (2026-10-28) :

1. Un utilisateur membre d'une seule organisation l'a pour organisation active dès la connexion, **sans migration** (section 9).
2. RCCM ajouté à la fiche. Obligation sur une facture vérifiée dans les documents du dépôt (section 3.1).
3. Aucun plafond total d'organisations par compte, pour l'instant (choix restant 2 de la 2.1, clos).

## Problème

- Une organisation n'a ni adresse, ni NCC, ni taux de TVA, ni délais : rien de ce qu'il faut pour un devis (jalon 4).
- Aucune table ne porte ces valeurs (`DESIGN.md`, section 2.1, `PARAMETRES` et `TAUX_TVA`, non créées).
- L'étape 8 de la chaîne (1.6) sait exiger une preuve de nouvelle authentification, mais aucun écran ne la demande.
- À chaque connexion, un utilisateur qui n'a qu'une organisation doit l'ouvrir à la main depuis `/compte`.

## Solution retenue

### 1. Tables (migration, section « Migration »)

Deux tables métier, chacune avec `organisation_id NOT NULL`, la règle d'isolation, forcée, et un index qui commence par `organisation_id` (règle 3).

**`parametres_organisation`** : une ligne par organisation, clé primaire `organisation_id` (index unique, qui satisfait la règle de l'index).

| Colonne | Type | Règle |
|---|---|---|
| `organisation_id` | `uuid` PK, FK `organization` `ON DELETE RESTRICT` | |
| `adresse` | `text` NULL | NULL : non renseigné |
| `ncc` | `text` NULL | |
| `rccm` | `text` NULL | |
| `regime_imposition` | `text` NULL | |
| `mentions_legales` | `text` NULL | |
| `validite_devis_jours` | `integer NOT NULL DEFAULT 30` | `CHECK` 1 à 365 |
| `echeance_facture_jours` | `integer NOT NULL DEFAULT 30` | `CHECK` 1 à 365 |
| `paiement_mobile_money` | `text` NULL | Instructions de paiement (S-33), écrites par un seul chemin de code (section 6) |
| `paiement_bancaire` | `text` NULL | Idem |
| `logo` | `bytea` NULL | `CHECK octet_length(logo) <= 204800` |
| `logo_type` | `text` NULL | `CHECK` `image/png` ou `image/jpeg` ; NULL si et seulement si `logo` est NULL |
| `modifie_le` | `timestamptz NOT NULL DEFAULT now()` | |

**`taux_tva`** :

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | |
| `organisation_id` | `uuid NOT NULL`, FK `ON DELETE RESTRICT` | |
| `libelle` | `text NOT NULL` | |
| `taux_centiemes` | `integer NOT NULL` | Centièmes de pour cent (1800 = 18 %, `DESIGN.md`) ; `CHECK` 0 à 10000 |
| `actif` | `boolean NOT NULL DEFAULT true` | Un taux n'est jamais supprimé, seulement désactivé (UC-07 2a) |
| `cree_le` | `timestamptz NOT NULL DEFAULT now()` | |

Index unique `taux_tva_organisation_taux_idx (organisation_id, taux_centiemes)` : deux taux de même valeur dans une organisation ne servent à rien et rendraient le choix ambigu au jalon 4.

Les instructions de paiement restent dans `parametres_organisation`, comme le veut `DESIGN.md` (« isolées dans une colonne dont la modification suit un chemin de code distinct ») : la requête de la fiche ne nomme jamais ces deux colonnes, vérifié par un test (section 6).

**Contrôles en base** (`CHECK`) : défense en profondeur derrière les schémas Zod ; une valeur hors bornes écrite par erreur de code échoue en base (`23514`).

### 2. Valeurs par défaut (UC-06 étape 2, report de la 2.1)

La création d'une organisation (`organisation.creer`, 2.1) écrit en plus, dans sa transaction :

- la ligne `parametres_organisation` (délais de 30 jours par défaut de colonne, le reste NULL) ;
- deux taux : « TVA 18 % » (1800) et « Exonération » (0), actifs. F-051 : « 18 % par défaut, 0 % pour les exonérations ».

Une panne de l'une de ces écritures annule la création entière (test). Libellés dans `src/textes/parametres.ts`.

**Organisations créées avant la 2.2** (seulement sur `dev` et dans les bases jetables : aucune en production, comptes fermés) : la lecture rend les valeurs par défaut quand la ligne manque (délais 30, champs vides), et la première écriture l'insère (`INSERT ... ON CONFLICT (organisation_id) DO UPDATE`). Aucun taux n'est créé pour elles : le Propriétaire les ajoute. Pas de migration de données (les migrations personnalisées admises ne portent que `FORCE` et `REVOKE`).

### 3. La fiche (F-011, UC-07 étape 1)

#### 3.1 RCCM et NCC sur une facture : obligation non établie

Recherche dans le dépôt (`SPEC.md`, `USECASES.md`, `DESIGN.md`, `THREATS.md`, `PLAN.md`, fiches) : le NCC est cité par F-011, F-020 et UC-07 comme un champ de la fiche, **sans dire s'il est obligatoire sur une facture** ; le RCCM n'est cité nulle part avant cette fiche. **À CONFIRMER** (par le développeur, auprès de la DGI ou d'un comptable, avant le jalon 5 et la certification) : l'obligation de faire figurer le NCC et le RCCM sur une facture en Côte d'Ivoire. En attendant, **les deux champs sont facultatifs** ; s'ils deviennent obligatoires, c'est l'émission (5.x) qui l'exigera, pas la fiche.

#### 3.2 Champs

Schéma `schemaFicheOrganisation` (`src/schemas/parametres.ts`, `z.strictObject`), règles sans Zod dans `src/schemas/regles-parametres.ts`, partagées avec le formulaire. Tout texte : normalisé NFC, espaces de bord retirés ; entrée brute bornée à quatre fois la longueur maximale avant normalisation ; vide après normalisation : NULL (champ non renseigné).

| Champ | Règle | Raison |
|---|---|---|
| Raison sociale | Règle de la 2.1 (2 à 100, obligatoire) ; écrite dans `organization.name` | F-011 la cite ; même règle qu'à la création |
| Adresse | 0 à 300 caractères, sur plusieurs lignes (retour à la ligne admis, au plus 5 lignes) | Reprise sur les documents |
| NCC | 0 à 30 caractères : lettres, chiffres, espace, `-`, `/`, `.` | Format exact non établi dans le dépôt : borne technique, pas une règle métier |
| RCCM | 0 à 50 caractères : lettres, chiffres, espace, `-`, `/`, `.` | Idem |
| Régime d'imposition | 0 à 100 caractères, une ligne | La liste des régimes n'est pas écrite dans le dépôt : texte libre, pas de liste fermée inventée |
| Mentions légales | 0 à 1000 caractères, plusieurs lignes (au plus 15) | Reprises dans les PDF et emails (S-51, T-62) |
| Validité d'un devis | Entier de 1 à 365 jours | Borne technique ; 30 par défaut |
| Échéance d'une facture | Entier de 1 à 365 jours | Idem |

Partout : aucun caractère de contrôle ni de format (`\p{Cc}`, `\p{Cf}`), hors le retour à la ligne (`\n`) dans les champs sur plusieurs lignes ; `\r\n` est ramené à `\n`. Les nombres arrivent en entiers (`z.int()`), jamais en flottants (règle 8).

**Une seule action pour toute la fiche** : `organisation.fiche.modifier`, entrée complète (tous les champs), une validation, une trace. Champs inchangés réécrits à l'identique : pas de calcul de différence côté client.

#### 3.3 Échappement (S-51, T-34, T-62)

Les textes sont stockés tels que saisis, jamais transformés en HTML ; React les échappe à l'affichage ; les PDF (4.3) et les emails (texte brut, 0.7) les reçoivent comme texte. Test : une mention `<script>alert(1)</script>` s'affiche telle quelle.

### 4. Taux de TVA (UC-07 étape 2)

Droit : `organisation.fiche.modifier` (« Modifier la fiche, les taux de TVA, les délais »).

| Action | Entrée | Effet |
|---|---|---|
| `organisation.taux.ajouter` | `{ libelle, taux }` | Insère un taux actif |
| `organisation.taux.changer_etat` | `{ tauxId: uuid, actif: boolean }` | Désactive ou réactive |

- `taux` : texte décimal en pour cent, virgule ou point, au plus deux décimales, de 0 à 100 (« 18 », « 9,5 », « 0 ») ; converti en centièmes **par lecture des chiffres**, sans `parseFloat` ni nombre à virgule (règle 8) : `"9,5"` → 950. Fonction pure `tauxEnCentiemes` (`src/lib/taux.ts`), testée.
- `libelle` : 1 à 50 caractères, une ligne.
- Même valeur qu'un taux existant (actif ou non) : `invalide` avec le message « Ce taux existe déjà. » (violation `23505` traduite, jamais le message de PostgreSQL).
- Plafond : 20 taux par organisation (T-42) ; au-delà : `invalide`, « Vous avez atteint le nombre maximal de taux. »
- **Aucune suppression** : un taux sert aux articles (3.3) et aux documents émis (R-06). Désactivé, il n'est plus proposé pour les nouvelles lignes. Le dernier taux actif peut être désactivé : le jalon 4 refusera un devis sans taux actif.
- `tauxId` d'une autre organisation ou inexistant : `refuse`, la même réponse (S-02) ; la règle d'isolation ne laisse voir aucune ligne d'une autre organisation, la requête filtre aussi sur l'organisation de la transaction.

### 5. Logo (S-53, T-60, UC-07 1a)

Action `organisation.logo.modifier`, entrée `{ contenu }` : le fichier encodé en base64 par le navigateur (`FileReader`), une chaîne, comme toute entrée de la chaîne (`z.strictObject`) ; pas de `FormData` à faire passer par `declarerAction`. Action `organisation.logo.retirer`, entrée `{}`.

Contrôles sur le serveur, dans cet ordre, sur les **octets décodés** (jamais sur le nom du fichier ni sur le type annoncé par le navigateur) :

1. Chaîne base64 stricte, au plus 273 068 caractères (204 800 octets encodés) ; sinon `invalide`.
2. Taille décodée de 1 à 204 800 octets (200 Ko, `STACK.md`).
3. Type réel par signature : PNG (`89 50 4E 47 0D 0A 1A 0A`, puis un bloc `IHDR`) ou JPEG (`FF D8 FF`, fin `FF D9`, un segment `SOFn`). Rien d'autre : ni SVG (script possible), ni GIF, ni WebP.
4. Dimensions lues dans `IHDR` ou `SOFn` : de 1 à 2048 pixels de côté. Borne technique : une image de 200 Ko peut annoncer des dimensions énormes, que le générateur de PDF (4.3) devrait décoder (épuisement de mémoire).
5. Type enregistré : celui de la signature.

Refus : `invalide`, message unique « Choisissez une image PNG ou JPEG de 200 Ko au plus. » (UC-07 1a), sans dire lequel des contrôles a échoué. Fonction pure `analyserLogo` (`src/server/parametres/logo.ts`), testée avec des fichiers construits (PNG et JPEG minimaux, HTML renommé, SVG, PNG tronqué, PNG à 4096 px, GIF, 200 Ko + 1 octet).

Limite de taille des actions serveur de Next.js : 1 Mo par défaut, au-dessus de 273 Ko : inchangée.

**Affichage** : la politique de sécurité du contenu n'admet que `img-src 'self'` (pas de `data:`), et aucune route ne sert le logo. La page affiche donc « Logo enregistré : PNG, 34 Ko » et le bouton « Retirer le logo », **sans aperçu** ; le logo apparaît sur les documents avec le PDF (4.3), qui l'intègre sur le serveur. Choix restant 1.

### 6. Instructions de paiement (F-057, S-14, S-33, T-12, UC-07 étapes 3 à 5)

Action `organisation.instructions_paiement.modifier`, droit `organisation.instructions_paiement.modifier` (Propriétaire seul), **`nouvelleAuthentification: true`**, journal `organisation.instructions_paiement_modifiees` (déjà dans la liste fermée), modèle d'email `organisation.instructions_paiement_modifiees` (nouveau).

Entrée `{ mobileMoney, bancaire }`, les deux champs **dans une seule validation** (une seule nouvelle authentification, décision 2 de la 1.6) :

| Champ | Règle |
|---|---|
| `mobileMoney` | 0 à 200 caractères, au plus 3 lignes (« Orange Money : 07 00 00 00 00 ») |
| `bancaire` | 0 à 500 caractères, au plus 6 lignes (banque, titulaire, RIB) |

Texte libre borné, mêmes interdits qu'en section 3.2 : le dépôt ne fixe ni la liste des opérateurs ni le format du RIB ; aucune règle métier inventée.

Service, dans la transaction :

1. `UPDATE parametres_organisation SET paiement_mobile_money, paiement_bancaire, modifie_le` (ou insertion si la ligne manque), filtré sur l'organisation de la transaction. **Seule requête du code qui écrit ces deux colonnes** (fonction `ecrireInstructionsPaiement`, `src/server/db/requetes/parametres.ts`) ; la requête de la fiche ne les nomme pas. Test unitaire sur le SQL produit par les deux requêtes.
2. Trace `organisation.instructions_paiement_modifiees`, ressource : l'organisation, détails vides (aucune valeur, ni ancienne ni nouvelle : S-54).
3. Lecture des Propriétaires de l'organisation : `member` joint à `user`, filtré sur `member.organization_id` = organisation de la transaction et `role = 'proprietaire'` (RR-8), au plus 20 lignes (T-42).
4. Un `ctx.preparerEmail("organisation.instructions_paiement_modifiees", destinataire, { organisation })` par Propriétaire, auteur compris. Envoi après la validation de la transaction (règle 17).

Une modification sans changement réel (mêmes valeurs) est quand même tracée et notifiée : plus simple à prouver, et une tentative est une information pour les Propriétaires.

**Email** (`src/textes/emails.ts`) : sujet fixe « Instructions de paiement modifiées » ; corps : la raison sociale (brique `texteAffichable(100)`), « Les instructions de paiement de votre organisation ont été modifiées. Si vous n'êtes pas à l'origine de ce changement, vérifiez-les sans attendre et changez votre mot de passe. », lien fixe `lienPage(origine, "connexion")` (page déjà admise de `PAGES_LIEN`). **Jamais les nouvelles valeurs** : un email qui les porterait servirait de modèle à un hameçonnage et ferait sortir les coordonnées de l'application. Limites `email.*` existantes ; au-delà de 3 emails par heure vers un même Propriétaire, les suivants sont abandonnés par la porte (comportement de la 0.7) : les trois premiers ont prévenu.

**Affichage** : les instructions enregistrées s'affichent en clair au Propriétaire sur `/parametres` (c'est lui qui les saisit ; aucune autre page ne les montre en 2.2 ; les factures du jalon 5 les reprendront).

### 7. Le formulaire de confirmation (S-14, livré ici, repris par la 2.4)

Composant client générique `ConfirmationIdentite` (`src/components/confirmation/confirmation-identite.tsx`), dans une fenêtre modale (composant shadcn `dialog`, ajouté par son nom ; il repose sur `@base-ui/react`, déjà installé : **aucune dépendance nouvelle**, vérifié au moment de l'ajout ; si l'outil en demande une, arrêt et demande d'accord).

Propriétés : `titre`, `recapitulatif` (liste de textes : un par changement, pour que plusieurs changements se valident ensemble), `libelleAction` (« Enregistrer les instructions »), `codeExige` (booléen, de l'état du second facteur lu par la page), `executer` (l'action à appeler après la preuve).

Déroulé, conforme à `DESIGN-SYSTEM.md` (« Action sensible ») :

1. Le bouton du formulaire (« Enregistrer les instructions ») valide les champs côté client, puis **ouvre la fenêtre** : récapitulatif, champ « Mot de passe », champ « Code de double authentification » si `codeExige` (avec le lien « Utiliser un code de secours », comme la 1.4), bouton principal `libelleAction`, bouton secondaire « Annuler » (bouton par défaut, focus initial sur le mot de passe).
2. Valider : `POST /api/auth/verify-password` (`appel-auth.ts`, chemin ajouté), puis, sur `ok`, l'action.
3. Résultats du point : `mot_de_passe_incorrect` → « Mot de passe incorrect. » sous le champ ; `code_incorrect` → « Code incorrect. » sous le champ du code ; `trop_de_requetes`, `refuse`, `connexion_requise`, `erreur` → bandeau dans la fenêtre (`TEXTES_RESULTATS`).
4. Résultats de l'action : succès → fenêtre fermée, bandeau `succes` « Instructions de paiement enregistrées. Les Propriétaires ont été prévenus par email. » ; `invalide` → fenêtre fermée, messages sous les champs du formulaire (la preuve est rendue, section 4 de la 1.6 : l'utilisateur corrige et confirme de nouveau) ; `nouvelle_authentification_requise` (preuve expirée entre les deux appels) → la fenêtre reste ouverte, « Confirmez votre identité pour continuer. », champs vidés.
5. Les champs de la fenêtre sont vidés à la fermeture ; le mot de passe n'est gardé dans aucun état au-delà de l'appel.

Échap et « Annuler » ferment sans rien envoyer. Le focus revient au bouton qui a ouvert la fenêtre. Sans JavaScript : le formulaire n'est pas utilisable (bandeau « Activez JavaScript », comme les autres formulaires).

### 8. L'écran `/parametres`

Page de `(app)/`, `lirePourPage` avec le droit `organisation.fiche.modifier` : un Comptable, un Commercial, un Lecteur reçoivent « introuvable » (404), comme sans session (S-02). Entrée de navigation « Organisation » (dernière, ordre de la décision 13 de la 0.6), droit `organisation.fiche.modifier`, filtrée par `entreesVisibles`. Aucune métadonnée propre (règle 5).

Lecture (`lireParametres`, dans la transaction de la chaîne) : la ligne `parametres_organisation` sans les octets du logo (seulement `logo_type` et `octet_length(logo)`), `organization.name` filtré sur l'organisation de la transaction (RR-8), les taux triés par valeur, et l'état du second facteur de l'utilisateur (`codeExige`).

Cartes, dans l'ordre, chacune avec son formulaire et son bouton secondaire (un seul bouton principal par écran : « Enregistrer la fiche ») :

1. **Fiche de l'organisation** : raison sociale, adresse, NCC, RCCM (aide : « Facultatif. »), régime d'imposition, mentions légales, validité d'un devis (jours), échéance d'une facture (jours). Bouton principal « Enregistrer la fiche ».
2. **Taux de TVA** : tableau (libellé, taux en `18 %`, état « Actif » ou « Désactivé » écrit), bouton secondaire « Désactiver » ou « Réactiver » par ligne (nom accessible complété par le libellé) ; formulaire « Ajouter un taux » (libellé, taux en %), bouton secondaire « Ajouter le taux ».
3. **Logo** : état (« Aucun logo. » ou la description de la section 5), champ fichier (`accept="image/png,image/jpeg"`, indicatif seulement), boutons secondaires « Enregistrer le logo » et « Retirer le logo ».
4. **Instructions de paiement** : bandeau `attention` « Ces coordonnées figureront sur vos factures. Leur modification demande votre mot de passe et votre code, et prévient tous les Propriétaires par email. » ; champs « Mobile money » et « Coordonnées bancaires » ; bouton secondaire « Enregistrer les instructions », qui ouvre la confirmation (section 7).

Résultats par carte : `invalide` → messages sous les champs (reliés par `aria-describedby`) ; `refuse`, `trop_de_requetes`, `connexion_requise` → bandeau `TEXTES_RESULTATS` ; `erreur` → « Une erreur est survenue. » et l'incident ; succès → bandeau `succes` dans la carte, annoncé (`role="status"`). Cibles de 44 px, focus visible, 360 px : les cartes s'empilent, le tableau des taux défile dans son cadre. Textes dans `src/textes/parametres.ts`.

### 9. L'organisation unique active à la connexion (décision 1)

**Où** : un rappel de base de données de Better Auth, `databaseHooks.session.create.before` (`src/server/auth/config.ts`), lu dans `node_modules/better-auth/dist/db/with-hooks.mjs` : appelé par `createSession` pour **toute** création de session, avant l'écriture ; s'il rend `{ data: { activeOrganizationId } }`, la valeur est fusionnée dans la ligne insérée. Un seul point couvre ainsi toutes les connexions (mot de passe, code de l'application, code de secours, vérification de l'email avec connexion automatique), au lieu des quatre points composés que la 2.1 écartait de modifier. Aucune colonne, aucune migration.

**Règle** : si la session créée n'a pas déjà d'organisation active **et** que l'utilisateur a exactement une adhésion, avec un rôle parmi les quatre, cette organisation devient active. Zéro ou au moins deux adhésions : rien (la liste de `/compte` reste le choix). Requête `adhesionUnique(utilisateurId)` (`src/server/db/sessions.ts`) : `SELECT organization_id, role FROM member WHERE user_id = $1 LIMIT 2` (RR-8 : filtrée sur l'utilisateur de la session créée, jamais sur une valeur de la requête HTTP).

**Panne** : la lecture échoue → ligne fixe `[auth]` au journal technique, la session est créée sans organisation active ; la connexion n'échoue jamais pour cette raison.

**Interaction avec la reprise après le mot de passe (2.1)** : la reprise écrit l'organisation de l'ancienne session après la création de la neuve ; elle garde la priorité. Le rappel ne change rien d'autre.

**Session intermédiaire de la double authentification** : Better Auth crée puis supprime une session à la connexion par mot de passe quand le second facteur est actif ; le rappel s'y applique aussi, sans effet visible (la session est supprimée, `plugins/two-factor/index.mjs` ligne 288).

**Sessions recréées par la double authentification** (activation, désactivation, codes de secours : `createSession(id, false, ancienneSession)`, lignes 119 à 229) : la neuve recopie l'ancienne, organisation active comprise ; la règle « pas déjà d'organisation active » la garde telle quelle.

**Arrivée** : le formulaire de connexion mène à `/compte?depuis=connexion` (au lieu de `/compte`). `/compte`, avec ce paramètre exact, redirige vers `/tableau-de-bord` si la session a une organisation active **et** que le second facteur n'est pas exigé et inactif pour son rôle ; sinon, la page s'affiche comme aujourd'hui. Le paramètre ne choisit aucune adresse : la seule destination est fixe. Sans le paramètre (lien « Changer d'organisation »), `/compte` s'affiche toujours.

### 10. Débit, journal, navigation

| Action | Limite | Journal | Nouvelle authentification |
|---|---|---|---|
| `organisation.fiche.modifier` | `membre.action` | `organisation.parametres_modifies` | non |
| `organisation.taux.ajouter` | `membre.action` | `organisation.parametres_modifies` | non |
| `organisation.taux.changer_etat` | `membre.action` | `organisation.parametres_modifies` | non |
| `organisation.logo.modifier` | `membre.action` | `organisation.parametres_modifies` | non |
| `organisation.logo.retirer` | `membre.action` | `organisation.parametres_modifies` | non |
| `organisation.instructions_paiement.modifier` | `membre.action` | `organisation.instructions_paiement_modifiees` | **oui** |

Les deux actions du journal existent déjà, détails vides (UC-07 étape 5 : « inscrit la modification au journal d'audit ») ; aucune action nouvelle dans la liste fermée. Aucune limite nouvelle : la nouvelle authentification a la sienne (`auth.nouvelle_authentification`, 10 par jour).

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Table séparée pour les instructions de paiement | `DESIGN.md` les met dans `PARAMETRES` ; une requête unique qui seule écrit ces colonnes, vérifiée par un test, donne la même séparation |
| Une action par champ de la fiche | Une trace et une saisie par champ ; la fiche se valide en une fois |
| Instructions de paiement dans l'action de la fiche, avec nouvelle authentification pour tout | Mot de passe et code à chaque correction d'adresse ; S-14 ne vise que les instructions |
| Valeurs saisies dans l'email aux Propriétaires | Modèle d'hameçonnage, coordonnées hors de l'application (section 6) |
| Logo par `FormData` | `declarerAction` ne reçoit qu'un objet validé par un schéma strict ; base64 borné y entre sans exception |
| `img-src 'self' data:` pour l'aperçu du logo | Change la politique de toutes les pages pour un aperçu ; choix restant 1 |
| Route `GET` qui sert le logo | Une route de plus (liste admise, contrôle après déploiement, chaîne de lecture) pour un aperçu |
| Réencoder le logo (sharp) | Dépendance nouvelle native ; la signature, la taille et les dimensions suffisent tant que le logo n'est jamais servi tel quel |
| SVG admis | Peut porter du script (T-60) |
| Liste fermée de régimes d'imposition, format du NCC ou du RIB | Non écrits dans le dépôt : ce serait inventer une règle métier |
| Ouverture de l'organisation unique dans chacun des quatre points de connexion | Quatre modifications au lieu d'un rappel ; le rappel couvre aussi les chemins futurs |
| Dernière organisation ouverte gardée sur `user` | Migration d'une table générée (décision 1 : sans migration) |
| Suppression d'un taux jamais utilisé | Utilisé ou non, le jalon 3 et R-06 imposent de ne rien supprimer ; désactiver suffit |

## Règles de sécurité et permissions

- Exigences : F-011, F-057, S-14 (première action sensible), S-33, S-51, S-53, S-70, S-02, S-50, RR-8.
- Menaces : T-12 (nouvelle authentification, trace, email à tous les Propriétaires), T-60 (type réel, taille, dimensions), T-34 et T-62 (échappement), T-42 (plafonds de lecture et de taux), T-50 (matrice seule source), T-55 (aucun point `/api/auth` nouveau).
- Matrice (inchangée) :

| Droit | Propriétaire | Comptable | Commercial | Lecteur |
|---|---|---|---|---|
| `organisation.fiche.modifier` (page, fiche, taux, délais, logo) | ✔ | ✖ | ✖ | ✖ |
| `organisation.instructions_paiement.modifier` | ✔ | ✖ | ✖ | ✖ |

- Tables créées : `parametres_organisation`, `taux_tva`, `organisation_id NOT NULL`, règle d'isolation activée et forcée, index en tête `organisation_id`, `verifierIsolation` dans leur test d'intégration, inventaire.
- Tables de Better Auth (RR-8) : `organization.name` lu et écrit avec `id` = organisation de la transaction ; Propriétaires lus avec `member.organization_id` = organisation de la transaction ; adhésion unique lue avec `member.user_id` = utilisateur de la session créée. Un test d'attaque par requête, avec deux organisations.
- Aucun point d'entrée nouveau sous `/api/auth` (`/verify-password` existe depuis la 1.6). Aucune route nouvelle. Une page nouvelle : `/parametres` (contrôle après déploiement : identique avec un cookie forgé, comme `/tableau-de-bord`).
- Fermé en production tant que `COMPTES_OUVERTS_EN_PRODUCTION` est faux : aucune session ne peut s'y créer (1.1) ; la page répond « introuvable ».

## Dépendances nouvelles

Aucune. Composant shadcn `dialog` ajouté par son nom (section 7).

## Migration

**En attente de l'accord du développeur.** Schéma Drizzle à ajouter à `src/server/db/schema/parametres.ts` (nouveau fichier, sans `server-only`, règle 13) :

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  bytea,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { colonneOrganisation, regleIsolation } from "./isolation";

// Fiche de l'organisation, réglages, logo et instructions de paiement : une
// ligne par organisation. Les colonnes paiement_* ne s'écrivent que par
// ecrireInstructionsPaiement (S-33). Fiche :
// docs/features/parametres-organisation.md, section 1.
export const parametresOrganisation = pgTable.withRLS(
  "parametres_organisation",
  {
    organisationId: colonneOrganisation().primaryKey(),
    adresse: text("adresse"),
    ncc: text("ncc"),
    rccm: text("rccm"),
    regimeImposition: text("regime_imposition"),
    mentionsLegales: text("mentions_legales"),
    validiteDevisJours: integer("validite_devis_jours").notNull().default(30),
    echeanceFactureJours: integer("echeance_facture_jours").notNull().default(30),
    paiementMobileMoney: text("paiement_mobile_money"),
    paiementBancaire: text("paiement_bancaire"),
    logo: bytea("logo"),
    logoType: text("logo_type"),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    regleIsolation(),
    check("parametres_validite_devis", sql`${table.validiteDevisJours} BETWEEN 1 AND 365`),
    check("parametres_echeance_facture", sql`${table.echeanceFactureJours} BETWEEN 1 AND 365`),
    check("parametres_logo_taille", sql`octet_length(${table.logo}) <= 204800`),
    check(
      "parametres_logo_type",
      sql`(${table.logo} IS NULL AND ${table.logoType} IS NULL) OR (${table.logo} IS NOT NULL AND ${table.logoType} IN ('image/png', 'image/jpeg'))`,
    ),
  ],
);

// Taux de TVA de l'organisation, en centièmes de pour cent (1800 = 18 %).
// Jamais supprimés, seulement désactivés (UC-07 2a).
export const tauxTva = pgTable.withRLS(
  "taux_tva",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: colonneOrganisation(),
    libelle: text("libelle").notNull(),
    tauxCentiemes: integer("taux_centiemes").notNull(),
    actif: boolean("actif").notNull().default(true),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    regleIsolation(),
    uniqueIndex("taux_tva_organisation_taux_idx").on(table.organisationId, table.tauxCentiemes),
    check("taux_tva_borne", sql`${table.tauxCentiemes} BETWEEN 0 AND 10000`),
  ],
);
```

SQL attendu de `npm run db:generate` (à relire après génération ; noms de contraintes de clé étrangère selon la forme de drizzle-kit, comme `journal_audit`) :

```sql
CREATE TABLE "parametres_organisation" (
	"organisation_id" uuid PRIMARY KEY,
	"adresse" text,
	"ncc" text,
	"rccm" text,
	"regime_imposition" text,
	"mentions_legales" text,
	"validite_devis_jours" integer DEFAULT 30 NOT NULL,
	"echeance_facture_jours" integer DEFAULT 30 NOT NULL,
	"paiement_mobile_money" text,
	"paiement_bancaire" text,
	"logo" bytea,
	"logo_type" text,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parametres_validite_devis" CHECK ("parametres_organisation"."validite_devis_jours" BETWEEN 1 AND 365),
	CONSTRAINT "parametres_echeance_facture" CHECK ("parametres_organisation"."echeance_facture_jours" BETWEEN 1 AND 365),
	CONSTRAINT "parametres_logo_taille" CHECK (octet_length("parametres_organisation"."logo") <= 204800),
	CONSTRAINT "parametres_logo_type" CHECK (("parametres_organisation"."logo" IS NULL AND "parametres_organisation"."logo_type" IS NULL) OR ("parametres_organisation"."logo" IS NOT NULL AND "parametres_organisation"."logo_type" IN ('image/png', 'image/jpeg')))
);
--> statement-breakpoint
ALTER TABLE "parametres_organisation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "taux_tva" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organisation_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"taux_centiemes" integer NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taux_tva_borne" CHECK ("taux_tva"."taux_centiemes" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "taux_tva" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "taux_tva_organisation_taux_idx" ON "taux_tva" ("organisation_id","taux_centiemes");--> statement-breakpoint
ALTER TABLE "parametres_organisation" ADD CONSTRAINT "parametres_organisation_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "taux_tva" ADD CONSTRAINT "taux_tva_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "isolation_organisation" ON "parametres_organisation" AS PERMISSIVE FOR ALL TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_organisation" ON "taux_tva" AS PERMISSIVE FOR ALL TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);
```

Puis `npx drizzle-kit generate --custom --name forcer-isolation-parametres` ; lignes à coller par le développeur :

```sql
ALTER TABLE "parametres_organisation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "taux_tva" FORCE ROW LEVEL SECURITY;
```

Puis `npm run db:migrate` sur `dev`, `node scripts/verifier-isolation.mjs`, `node scripts/verifier-tables.mjs`. Aucune table en ajout seul (les paramètres se modifient), donc pas de `retirer-droits`. Les droits de `app_facturation` viennent des privilèges par défaut (`CONFIGURATION.md`). Effet sur les tests : `nettoyer` doit supprimer `parametres_organisation` et `taux_tva` avant `organization` (`ON DELETE RESTRICT`) ; ajouté aux tables de `creerDeuxOrganisations`.

## Critères d'acceptation

- [ ] Une organisation créée a sa ligne de paramètres (délais 30 et 30) et deux taux actifs (18 % et 0 %), dans la transaction de la création.
- [ ] Le Propriétaire enregistre la fiche : raison sociale, adresse, NCC, RCCM, régime, mentions, délais ; une trace `organisation.parametres_modifies`.
- [ ] Fiche invalide (délai 0 ou 366, flottant, NCC avec `<`, caractère de direction, clé en trop, instructions de paiement dans l'entrée) : `invalide`, rien d'écrit.
- [ ] Ajouter un taux « 9,5 » donne 950 ; un doublon et un 21e taux sont refusés ; désactiver puis réactiver ; aucune suppression possible.
- [ ] Un logo PNG ou JPEG de 200 Ko au plus, 2048 px au plus, est enregistré avec son type réel ; HTML renommé, SVG, GIF, fichier tronqué, 200 Ko + 1, 4096 px : refusés, même message.
- [ ] Instructions de paiement sans preuve : `nouvelle_authentification_requise`, rien d'écrit ; avec preuve : écrites, trace, un email par Propriétaire (et seulement eux), sans les valeurs ; seconde modification : nouvelle preuve exigée.
- [ ] Comptable, Commercial, Lecteur : page « introuvable », chaque action `refuse` ; non-membre et organisation d'un tiers (`tauxId` de B) : `refuse`, la même réponse qu'un identifiant inexistant.
- [ ] La fenêtre de confirmation : mot de passe faux, code faux, preuve expirée, annulation, focus rendu.
- [ ] Un utilisateur membre d'une seule organisation arrive sur `/tableau-de-bord` après la connexion (mot de passe seul, puis avec code) ; membre de deux : `/compte` ; panne de la lecture : connexion réussie, sans organisation active.
- [ ] `/compte` sans paramètre s'affiche toujours, même avec une organisation active.
- [ ] Une mention `<script>` s'affiche comme du texte.

## Tests à écrire

### Tests d'attaque, puis unitaires

1. `src/lib/taux.test.ts` : `tauxEnCentiemes` (« 18 », « 18,5 », « 18.50 », « 0 », « 100 » ; refus de « 100,01 », « -1 », « 1e2 », « 18,555 », « », « 18 % », chiffres arabes-indiens) ; formatage `18 %`, `9,5 %`.
2. `src/schemas/parametres.test.ts` : normalisation et bornes de chaque champ de la section 3.2, lignes comptées, `\r\n`, caractères de contrôle et de format, clés en trop (dont `mobileMoney` dans la fiche), entiers seulement.
3. `src/server/parametres/logo.attaque.test.ts` : la liste de la section 5 (fichiers construits dans le test), base64 non strict, chaîne trop longue, type annoncé jamais lu.
4. `src/server/actions/parametres.test.ts` (chaîne factice) : chaque action déclarée avec son droit, sa limite, son journal, `emails` ; seule l'action des instructions a `nouvelleAuthentification: true` ; matrice : refus des trois autres rôles.
5. `src/server/db/requetes/parametres.test.ts` : le SQL de l'écriture de la fiche ne nomme ni `paiement_mobile_money` ni `paiement_bancaire` ; seule `ecrireInstructionsPaiement` les nomme (lecture du source des requêtes).
6. `src/server/email/modeles.test.ts` : le nouveau modèle, sujet fixe, raison sociale échappée sur une ligne, aucun paramètre de valeur de paiement accepté.
7. `src/server/auth/organisation-unique.attaque.test.ts` : rappel `session.create.before` — une adhésion : organisation posée ; zéro, deux, rôle inconnu : rien ; session qui en a déjà une : inchangée ; panne : rien, ligne fixe sans identifiant.
8. `src/server/autorisation/navigation.test.ts` : entrée « Organisation » visible pour le seul Propriétaire.
9. `src/server/actions/inventaire.test.ts`, `registre.ts` : six actions nouvelles ; page `/parametres` qui appelle `lirePourPage`.
10. Composant `ConfirmationIdentite` (`*.test.tsx`, si l'environnement de rendu de composants existe ; sinon en bout en bout seulement).

### Tests d'intégration, avec base (`src/server/db/`)

11. `parametres.integration.test.ts` : `verifierIsolation` sur les deux tables ; création d'organisation avec valeurs par défaut, panne d'une écriture : rien ; fiche écrite pour A, B inchangée (RR-8 sur `organization.name`) ; organisation sans ligne : lecture par défaut, première écriture insère ; taux (ajout, doublon `23505` traduit, plafond, `tauxId` de B → `refuse`, état) ; contraintes `CHECK` violées par une écriture directe (`23514`) ; logo enregistré, retiré.
12. `instructions-paiement.integration.test.ts` (banc de la 1.6, vraies preuves) : sans preuve → `nouvelle_authentification_requise` ; avec → écrit, trace, emails aux seuls Propriétaires de A (un Propriétaire de B, un Comptable de A n'en reçoivent pas) ; preuve consommée ; entrée invalide : preuve rendue.
13. `connexion.integration.test.ts` (existant) : une adhésion → session neuve avec l'organisation active ; deux → aucune ; adhésion dans B d'un autre utilisateur jamais prise.
14. `registre.integration.test.ts` : cas des six actions.

### Tests de bout en bout (`e2e/parametres.spec.ts`, deux projets)

15. Propriétaire (une seule organisation) : connexion → `/tableau-de-bord` directement ; « Organisation » dans la barre latérale ; enregistre la fiche ; ajoute « 9,5 » ; désactive « Exonération » ; envoie un logo PNG, puis un HTML renommé `.png` (refusé) ; modifie les instructions : fenêtre, mot de passe faux (message), bons mot de passe et code → bandeau de succès, email dans le dossier du transport `fichier` sans les valeurs. Captures à 390 et 1280 px.
16. Comptable de la même organisation : pas d'entrée « Organisation », `/parametres` « introuvable ».
17. Membre de deux organisations : connexion → `/compte`.
18. `e2e/controle-deploiement.spec.ts` et `scripts/controle-deploiement.mjs` : `/parametres` identique avec un cookie forgé.

### Vérifications manuelles (développeur)

Aucune avant la fusion : comptes fermés en production, tout est couvert en bout en bout sur la base jetable. À l'ouverture des comptes (#52) : une modification réelle des instructions de paiement depuis la prévisualisation, pour voir l'email arriver dans les deux boîtes de Propriétaires.

## Fichiers concernés

`src/server/db/schema/parametres.ts` ; `src/server/db/requetes/parametres.ts`, `src/server/db/sessions.ts`, `src/server/db/outils-test/organisations.ts` ; `src/server/services/parametres.ts`, `src/server/services/organisations.ts` (valeurs par défaut) ; `src/server/parametres/logo.ts` ; `src/server/actions/parametres.ts`, `registre.ts` ; `src/server/autorisation/navigation.ts` ; `src/server/auth/config.ts` (rappel), `organisation-unique.ts` ; `src/server/email/modeles.ts` ; `src/lib/taux.ts` ; `src/schemas/parametres.ts`, `regles-parametres.ts` ; `src/app/(app)/parametres/page.tsx`, `actions.ts` ; `src/app/(compte)/compte/page.tsx` (arrivée) ; `src/components/parametres/*`, `src/components/confirmation/confirmation-identite.tsx`, `src/components/ui/dialog.tsx` ; `src/components/compte/formulaire-connexion.tsx`, `appel-auth.ts` ; `src/textes/parametres.ts`, `emails.ts`, `navigation.ts` ; `scripts/controle-deploiement.mjs` ; tests ; `docs/PLAN.md`, `docs/DESIGN.md` (colonnes de `PARAMETRES`), `docs/features/organisations.md` (renvoi).

## Reporté

- Visibilité des Commerciaux (F-015, `visibilite_commerciaux` de `DESIGN.md`) : absente de la ligne 2.2 de `PLAN.md` ; à rattacher à une fonctionnalité (2.4 ou jalon 3, avant F-016).
- Aperçu du logo (choix restant 1).
- Obligation du NCC et du RCCM sur une facture : À CONFIRMER, avant l'émission (5.x).

## Décisions par défaut

Recommandations de l'assistant, appliquées :

1. Deux tables, instructions de paiement dans `parametres_organisation` avec une seule requête d'écriture (sections 1 et 6).
2. Valeurs par défaut écrites à la création ; lecture par défaut pour les organisations antérieures (section 2).
3. NCC et RCCM facultatifs, format technique seulement ; régime en texte libre (section 3).
4. Taux en texte décimal converti sans flottant ; désactivation seule ; 20 au plus (section 4).
5. Logo en base64 dans une entrée stricte ; PNG et JPEG, signature, 200 Ko, 2048 px ; pas d'aperçu (section 5).
6. Instructions : nouvelle authentification, trace, email à chaque Propriétaire sans les valeurs (section 6).
7. Formulaire de confirmation générique dans une fenêtre, appel de `/verify-password` puis de l'action (section 7).
8. Organisation unique par le rappel `session.create.before` ; arrivée par `/compte?depuis=connexion` (section 9).

## Choix restants

1. Aperçu du logo sur `/parametres` : `img-src 'self' data:` dans la politique, ou attendre le PDF (4.3), comme retenu.
2. Format du NCC, du RCCM, liste des régimes d'imposition : texte borné retenu ; à fermer quand une source (DGI) sera citée.
3. Email aux Propriétaires sur chaque modification des instructions, même sans changement réel (retenu), ou seulement sur un changement.
