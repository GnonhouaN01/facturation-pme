# Fonctionnalité : paramètres de l'organisation (2.2)

Statut : validée le 2026-10-28 (recommandations de l'assistant appliquées, puis accord conditionnel du développeur sur la migration, avec six corrections, section « Décisions du développeur ») ; implémentée le 2026-10-28 (« Notes de l'implémentation »). **Migration personnalisée à compléter par le développeur** avant toute application (section « Migration »).

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

## Problème

- Une organisation n'a ni adresse, ni NCC, ni taux de TVA, ni délais : rien de ce qu'il faut pour un devis (jalon 4).
- Aucune table ne porte ces valeurs (`DESIGN.md`, section 2.1, `PARAMETRES` et `TAUX_TVA`, non créées).
- L'étape 8 de la chaîne (1.6) sait exiger une preuve de nouvelle authentification, mais aucun écran ne la demande.
- À chaque connexion, un utilisateur qui n'a qu'une organisation doit l'ouvrir à la main depuis `/compte`.

## Solution retenue

### 1. Tables (migration)

Deux tables métier **sans suppression** (correction 1 et 2 du développeur), chacune avec `organisation_id NOT NULL`, isolation activée et forcée, un index qui commence par `organisation_id` (règle 3) :

- **trois règles, une par commande admise**, sur la condition du modèle (`organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid`) : `isolation_lecture` (`SELECT`, `USING`), `isolation_insertion` (`INSERT`, `WITH CHECK`), `isolation_modification` (`UPDATE`, `USING` et `WITH CHECK`) ; **aucune règle pour `DELETE`**. PostgreSQL refuse `WITH CHECK` sur une règle `SELECT` et `USING` sur une règle `INSERT` : chaque règle porte les clauses que sa commande admet (`reglesSansSuppression()`, `schema/isolation.ts`) ;
- **droits du rôle de l'application** : `SELECT`, `INSERT`, `UPDATE` ; jamais `DELETE` ni `TRUNCATE` (`REVOKE` de la migration personnalisée) ;
- **bornes en base** (correction 3) : un `CHECK (char_length(<colonne>) BETWEEN 1 AND <max>)` par colonne de texte, aux bornes de l'application (`REGLES_TEXTE`, `src/schemas/regles-parametres.ts`, seule source, lue aussi par le schéma Drizzle). `char_length` compte les points de code, comme l'application (`[...texte].length`). Un texte vide est enregistré `NULL` (non renseigné) : la borne basse à 1 l'impose.

**`parametres_organisation`** : une ligne par organisation, clé primaire `organisation_id`.

| Colonne | Type | Contrainte |
|---|---|---|
| `organisation_id` | `uuid` PK, FK `organization` `ON DELETE RESTRICT` | |
| `adresse` | `text` NULL | 1 à 300 |
| `ncc` | `text` NULL | 1 à 30 |
| `rccm` | `text` NULL | 1 à 50 |
| `regime_imposition` | `text` NULL | 1 à 100 |
| `mentions_legales` | `text` NULL | 1 à 1000 |
| `validite_devis_jours` | `integer NOT NULL DEFAULT 30` | 1 à 365 |
| `echeance_facture_jours` | `integer NOT NULL DEFAULT 30` | 1 à 365 |
| `paiement_mobile_money` | `text` NULL | 1 à 200 ; écrite par une seule requête (section 6) |
| `paiement_bancaire` | `text` NULL | 1 à 500 ; idem |
| `logo` | `bytea` NULL | 1 à 204 800 octets ; lue par une seule requête (section 5) |
| `logo_type` | `text` NULL | `image/png` ou `image/jpeg` ; NULL si et seulement si `logo` est NULL |
| `modifie_le` | `timestamptz NOT NULL DEFAULT now()` | |

**`taux_tva`** : `id` (`uuid` PK), `organisation_id`, `libelle` (1 à 50), `taux_centiemes` (0 à 10 000, 1800 = 18 %, `DESIGN.md`), `actif` (`DEFAULT true`), `cree_le` ; index unique `(organisation_id, taux_centiemes)`.

Les instructions de paiement restent dans `parametres_organisation`, comme le veut `DESIGN.md` : la requête de la fiche ne nomme jamais leurs colonnes, vérifié par un test sur le source des requêtes.

**Effet de l'absence de suppression** : une organisation qui a une ligne dans l'une de ces tables ne se supprime plus (`ON DELETE RESTRICT`, et le rôle ne peut pas supprimer ses paramètres). Sur `dev`, les tests qui en écrivent y laissent leurs organisations, comme le journal (accepté ; environ six par exécution). La suppression différée (2.5) devra en tenir compte : la fiche de la 2.5 tranchera (suppression par un rôle propriétaire, ou anonymisation).

### 2. Valeurs par défaut (UC-06 étape 2, report de la 2.1)

La création d'une organisation (`organisation.creer`, 2.1) écrit en plus, dans sa transaction : la ligne de paramètres (délais 30 et 30, le reste NULL) et deux taux actifs, « TVA 18 % » (1800) et « Exonération » (0), selon F-051. Une panne annule la création entière.

Organisations créées avant la 2.2 (seulement sur `dev` et les bases jetables ; aucune en production) : la lecture rend les valeurs par défaut quand la ligne manque, et la première écriture l'insère (`INSERT ... ON CONFLICT (organisation_id) DO UPDATE`). Aucun taux ne leur est créé.

### 3. La fiche (F-011, UC-07 étape 1)

#### 3.1 RCCM et NCC sur une facture : **À CONFIRMER**

Recherche dans le dépôt (`SPEC.md`, `USECASES.md`, `DESIGN.md`, `THREATS.md`, `PLAN.md`, fiches) : le NCC est cité par F-011, F-020 et UC-07 comme un champ de la fiche, **sans dire s'il est obligatoire sur une facture** ; le RCCM n'était cité nulle part. **À CONFIRMER** (par le développeur, auprès de la DGI ou d'un comptable, avant le jalon 5) : l'obligation de faire figurer le NCC et le RCCM sur une facture en Côte d'Ivoire. En attendant, **les deux champs sont facultatifs, en texte libre borné** (correction 6) ; s'ils deviennent obligatoires, c'est l'émission (5.x) qui l'exigera.

#### 3.2 Champs

Schéma `schemaFiche` (`src/schemas/parametres.ts`, `z.strictObject`), règles sans Zod dans `src/schemas/regles-parametres.ts`, partagées avec le formulaire et le schéma de la base. Tout texte : NFC, `\r\n` ramené à `\n`, dans chaque ligne suites d'espaces réduites et espaces de bord retirés, lignes vides de bord retirées ; saisie brute bornée à quatre fois la longueur maximale ; vide : `NULL`. Partout : aucun caractère de contrôle (sauf `\n` dans les champs sur plusieurs lignes), de format (`\p{Cf}`) ni séparateur de ligne ou de paragraphe.

| Champ | Règle |
|---|---|
| Raison sociale | Règle de la 2.1 (2 à 100, obligatoire), écrite dans `organization.name` |
| Adresse | 0 à 300, au plus 5 lignes |
| NCC | 0 à 30 : lettres, chiffres, espace, `-`, `/`, `.` (borne technique, format À CONFIRMER) |
| RCCM | 0 à 50, mêmes caractères |
| Régime d'imposition | 0 à 100, une ligne, texte libre (aucune liste fermée inventée) |
| Mentions légales | 0 à 1000, au plus 15 lignes |
| Validité d'un devis, échéance d'une facture | Entiers de 1 à 365 jours (`z.int()`) |

Une seule action pour toute la fiche (`parametres.fiche`), une validation, une trace. Les textes sont stockés tels que saisis et échappés à l'affichage par React (S-51, T-34, T-62).

### 4. Taux de TVA (UC-07 étape 2)

Droit `organisation.fiche.modifier`. Actions `parametres.taux.ajouter` (`{ libelle, taux }`) et `parametres.taux.etat` (`{ tauxId, actif }`).

- `taux` : texte décimal en pour cent, virgule ou point, deux décimales au plus, de 0 à 100 ; converti en centièmes par lecture des chiffres (`tauxEnCentiemes`), sans nombre à virgule (règle 8).
- Doublon (même valeur, actif ou non) et plafond de 20 taux (T-42) : signalés par le formulaire à partir de la liste affichée (« Ce taux existe déjà. », « Vous avez atteint le nombre maximal de taux. ») ; un appel qui passerait outre reçoit `refuse`.
- Aucune suppression : un taux se désactive et se réactive (UC-07 2a, R-06).
- `tauxId` d'une autre organisation ou inexistant : `refuse`, la même réponse (S-02).

### 5. Logo (S-53, T-60, UC-07 1a)

Action `parametres.logo.enregistrer`, entrée `{ contenu }` (le fichier en base64, lu dans le navigateur) ; action `parametres.logo.retirer`, entrée `{}`. Contrôles sur les **octets décodés** (`analyserLogo`, `src/lib/image/logo.ts`, fonction pure, utilisée par le schéma du serveur et par le formulaire) : base64 strict, 1 à 204 800 octets, signature PNG (bloc `IHDR` en tête, `IEND` en fin) ou JPEG (`FF D8 FF`, segment `SOFn`, fin `FF D9`), dimensions de 1 à 2048 pixels. Ni SVG, ni GIF, ni WebP. Type enregistré : celui de la signature. Refus : `invalide`, « Choisissez une image PNG ou JPEG de 200 Ko au plus. »

**Aperçu par notre route** (correction 4) : `GET /parametres/logo` (`src/app/(app)/parametres/logo/route.ts`, forme exacte vérifiée par l'inventaire), `servirLogo` (`src/server/actions/exposer.ts`) : chaîne de lecture (`etablirContexte`) avec le droit du gabarit, accordé aux quatre rôles, donc **réservée aux membres de l'organisation active**. Réponse : les octets, `Content-Type` exact (le type stocké), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Length`. Sans session, refus et absence de logo : la même réponse, `404` au corps vide, mêmes en-têtes (S-02) ; panne : `500` au corps vide. **Aucune autre requête des paramètres ne lit la colonne `logo`** : la page lit `logo_type` seul (vérifié sur le source des requêtes). La politique de sécurité du contenu est inchangée (`img-src 'self'`, sans `data:`).

### 6. Instructions de paiement (F-057, S-14, S-33, T-12, UC-07 étapes 3 à 5)

Action `parametres.instructions_paiement`, droit `organisation.instructions_paiement.modifier` (Propriétaire seul), `nouvelleAuthentification: true`, journal `organisation.instructions_paiement_modifiees` (déjà dans la liste fermée), modèle `organisation.instructions_paiement_modifiees`.

Entrée `{ mobileMoney (0 à 200, 3 lignes), bancaire (0 à 500, 6 lignes) }`, les deux dans une seule validation, donc une seule nouvelle authentification. Texte libre borné : ni liste d'opérateurs ni format de RIB inventés.

Service, dans la transaction : lecture des instructions actuelles `FOR UPDATE` ; si elles changent, écriture par `ecrireInstructionsPaiement`, **seule requête qui écrit ces deux colonnes** ; trace à chaque validation (détails vides, aucune valeur) ; **email à chaque Propriétaire seulement quand les instructions changent réellement** (correction 5) : `member` joint à `user`, filtré sur l'organisation de la transaction et `role = 'proprietaire'` (RR-8), au plus 20. Le corps de l'email : la raison sociale (texte affichable, une ligne), « Les instructions de paiement de votre organisation, qui figurent sur ses factures, viennent d'être modifiées par un Propriétaire. », la consigne de vérifier et de changer de mot de passe, le lien fixe vers `/connexion`. **Jamais les valeurs** (modèle d'hameçonnage, coordonnées hors de l'application). Réponse : `{ modifiees }`.

### 7. La fenêtre de confirmation (S-14, livrée ici, reprise par la 2.4)

`ConfirmationIdentite` (`src/components/confirmation/confirmation-identite.tsx`), dans le composant shadcn `dialog` (ajouté par son nom ; il repose sur `@base-ui/react`, déjà installé : aucune dépendance nouvelle). Propriétés : `introduction`, `recapitulatif` (une ligne par changement : plusieurs changements, une seule saisie), `libelleAction`, `codeExige`, `declencheur` (focus rendu), `executer`.

1. Le bouton du formulaire vérifie les champs, puis ouvre la fenêtre : titre « Confirmez votre identité », récapitulatif, mot de passe (focus initial), code de l'application ou « Utiliser un code de secours », « Annuler » et le bouton d'action.
2. Valider : `POST /api/auth/verify-password` (chemin ajouté à `appel-auth.ts`), puis l'action.
3. `mot_de_passe_incorrect`, `code_incorrect` : message sous le champ ; `invalide`, `refuse`, `trop_de_requetes`, `connexion_requise` : bandeau dans la fenêtre ; `erreur` : « Une erreur est survenue. » et l'incident.
4. L'action reçoit `nouvelle_authentification_requise` (preuve expirée entre les deux appels) : la fenêtre reste ouverte, champs vidés, « Confirmez votre identité pour continuer. » ; tout autre résultat ferme la fenêtre.
5. Échap et « Annuler » ferment sans rien envoyer ; le focus revient au bouton déclencheur ; les champs sont vidés.

Le Propriétaire a toujours son second facteur (étape 7) : sur `/parametres`, le code est exigé.

### 8. L'écran `/parametres`

Page de `(app)/`, `lirePourPage("organisation.fiche.modifier", ...)` : Comptable, Commercial, Lecteur, sans session : « introuvable » (S-02). Entrée de navigation « Organisation », droit `organisation.fiche.modifier`, filtrée par `entreesVisibles`. Aucune métadonnée propre.

Quatre cartes : **Fiche** (seul bouton principal de l'écran, « Enregistrer la fiche »), **Taux de TVA** (tableau défilant dans son cadre, état écrit « Actif » ou « Désactivé », « Désactiver » ou « Réactiver » au nom accessible complété du libellé, formulaire « Ajouter un taux »), **Logo** (type enregistré, aperçu par la route, champ fichier, « Enregistrer le logo », « Retirer le logo »), **Instructions de paiement** (bandeau `attention`, deux zones de texte, « Enregistrer les instructions », qui ouvre la confirmation). Messages sous les champs (`aria-describedby`), bandeaux de succès `role="status"`, cibles de 44 px, focus visible, 360 px. Textes : `src/textes/parametres.ts`, `src/textes/confirmation.ts`.

### 9. L'organisation unique active à la connexion (décision 1)

Rappel `databaseHooks.session.create.before` de Better Auth (`src/server/auth/organisation-unique.ts`, branché dans `config.ts`), appelé par `createSession` pour **toute** session (mot de passe, code, code de secours, vérification de l'adresse avec connexion automatique) : un seul point au lieu des quatre points de connexion. Aucune migration.

- Si la session créée n'a pas déjà d'organisation active **et** que l'utilisateur a exactement une adhésion, à un rôle parmi les quatre et un identifiant UUID : cette organisation devient active. Zéro ou au moins deux : rien.
- Lecture : `adhesionsPourSession(utilisateurId)` (`src/server/db/sessions.ts`), `LIMIT 2`, filtrée sur l'utilisateur de la session créée (RR-8).
- Panne : ligne fixe `[auth]` (étape, classe, incident ; jamais un identifiant ni le message), session créée sans organisation ; la connexion n'échoue jamais pour cette raison.
- Sessions recréées par la double authentification (activation, désactivation, codes de secours : `createSession(id, false, ancienneSession)`, `plugins/two-factor/index.mjs`, lignes 119 à 229) : la neuve recopie l'organisation de l'ancienne, gardée. Session intermédiaire de la connexion à deux facteurs (supprimée, ligne 288) : sans effet. Reprise après le changement de mot de passe (2.1) : inchangée, elle écrit après.

**Arrivée** : le formulaire de connexion mène à `/compte?depuis=connexion`. Avec ce paramètre exact, `/compte` redirige vers `/tableau-de-bord` si l'organisation active de la session est dans la liste du compte et que le second facteur n'y manque pas (`destinationApresConnexion`), sinon vers `/compte` sans le paramètre. Deux destinations fixes, aucune lue de la requête. Sans le paramètre (lien « Changer d'organisation »), `/compte` s'affiche toujours.

### 10. Débit, journal, navigation

| Action | Limite | Journal | Nouvelle authentification | Emails |
|---|---|---|---|---|
| `parametres.fiche` | `membre.action` | `organisation.parametres_modifies` | non | aucun |
| `parametres.taux.ajouter` | idem | idem | non | aucun |
| `parametres.taux.etat` | idem | idem | non | aucun |
| `parametres.logo.enregistrer` | idem | idem | non | aucun |
| `parametres.logo.retirer` | idem | idem | non | aucun |
| `parametres.instructions_paiement` | idem | `organisation.instructions_paiement_modifiees` | **oui** | Propriétaires, sur changement réel |

Aucune action nouvelle dans la liste fermée du journal, aucune limite nouvelle.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Une règle `FOR ALL` comme les autres tables | Corrigé par le développeur : règles par commande, aucune pour `DELETE` |
| Table séparée pour les instructions de paiement | `DESIGN.md` les met dans `PARAMETRES` ; une requête unique, vérifiée par un test, donne la séparation |
| Instructions de paiement dans l'action de la fiche | Mot de passe et code à chaque correction d'adresse ; S-14 ne vise que les instructions |
| Valeurs saisies dans l'email aux Propriétaires | Modèle d'hameçonnage, coordonnées hors de l'application |
| Email à chaque validation, même sans changement | Corrigé par le développeur (correction 5) |
| `img-src 'self' data:` pour l'aperçu | Corrigé par le développeur (correction 4) : notre route |
| Logo par `FormData` | `declarerAction` n'accepte qu'un `z.strictObject` ; base64 borné y entre sans exception |
| Réencoder le logo (sharp) | Dépendance native ; signature, taille et dimensions suffisent, le logo n'est servi qu'avec son type exact et `nosniff` |
| SVG admis | Peut porter du script (T-60) |
| Listes fermées (régimes, opérateurs), formats (NCC, RCCM, RIB) | Non écrits dans le dépôt : ce serait inventer une règle métier |
| Ouverture de l'organisation unique dans les quatre points de connexion | Quatre modifications au lieu d'un rappel |
| Dernière organisation gardée sur `user` | Migration d'une table générée (décision 1 : sans migration) |

## Règles de sécurité et permissions

- Exigences : F-011, F-057, S-14, S-33, S-51, S-53, S-70, S-02, S-50, RR-8.
- Menaces : T-12, T-60, T-34, T-62, T-42, T-50, T-55.
- Matrice inchangée : `organisation.fiche.modifier` et `organisation.instructions_paiement.modifier`, Propriétaire seul ; la route du logo, droit du gabarit (quatre rôles).
- Tables créées : section 1. Tables de Better Auth (RR-8) : `organization.name` lu et écrit avec `id` = organisation de la transaction ; Propriétaires lus avec `member.organization_id` = organisation de la transaction ; adhésions lues avec `member.user_id` = utilisateur de la session créée.
- Aucun point nouveau sous `/api/auth`. Une route nouvelle (`/parametres/logo`, liste admise de l'inventaire) et une page (`/parametres`, au contrôle après déploiement).
- Fermé en production tant que `COMPTES_OUVERTS_EN_PRODUCTION` est faux : aucune session ne peut s'y créer (1.1) ; la page et la route répondent « introuvable ».

## Dépendances nouvelles

Aucune. Composant shadcn `dialog` ajouté par son nom (`npx shadcn@4.4.0 add dialog`, `button.tsx` gardé) ; `package.json` inchangé.

## Migration

Deux fichiers dans `drizzle/`, à garder hors des commits tant que le second n'est pas complété :

1. `drizzle/20261028062115_freezing_bloodaxe/migration.sql`, produit par `npm run db:generate` depuis `src/server/db/schema/parametres.ts` (tables, contraintes, index, clés, six règles).
2. `drizzle/20261028063932_forcer-isolation-parametres/migration.sql`, créé vide par `npx drizzle-kit generate --custom --name forcer-isolation-parametres`. **L'écriture dans `drizzle/` est refusée à l'assistant par le poste** : le développeur y colle, sous le commentaire, ces quatre lignes :

```sql
ALTER TABLE "parametres_organisation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "taux_tva" FORCE ROW LEVEL SECURITY;
REVOKE DELETE, TRUNCATE ON TABLE "parametres_organisation" FROM "app_facturation";
REVOKE DELETE, TRUNCATE ON TABLE "taux_tva" FROM "app_facturation";
```

C'est une troisième forme de migration personnalisée (forçage et retrait de `DELETE`, sans retrait d'`UPDATE`), autorisée par le développeur pour cette fonctionnalité ; `CLAUDE.md` ne cite que les deux premières. Puis `npm run db:migrate` sur `dev`, `node scripts/verifier-isolation.mjs`, `node scripts/verifier-tables.mjs`, `npm run test:integration`.

## Critères d'acceptation

- [x] Une organisation créée a sa ligne de paramètres (30 et 30) et deux taux actifs (18 % et 0 %), dans la transaction de la création. *(intégration, à lancer après la migration)*
- [x] Le Propriétaire enregistre la fiche ; une trace `organisation.parametres_modifies`.
- [x] Fiche invalide (délai 0 ou 366, flottant, NCC avec `<`, caractère de direction, clé en trop, instructions de paiement dans l'entrée) : `invalide`, rien d'écrit.
- [x] « 9,5 » donne 950 ; doublon et 21e taux refusés ; désactiver, réactiver ; aucune suppression.
- [x] Logo PNG ou JPEG de 200 Ko et 2048 px au plus, type réel ; HTML renommé, SVG, GIF, WebP, tronqué, 200 Ko + 1, 4096 px : refusés.
- [x] Logo servi aux membres de l'organisation seulement, type exact, `nosniff`, `private, no-store` ; refus, sans session, sans logo : même réponse.
- [x] Instructions sans preuve : `nouvelle_authentification_requise` ; avec preuve : écrites, trace, email à chaque Propriétaire de l'organisation seulement, sans les valeurs ; mêmes valeurs : trace, aucun email ; preuve consommée.
- [x] Comptable, Commercial, Lecteur : page « introuvable », actions `refuse` (registre).
- [x] Fenêtre de confirmation : mot de passe faux, code de secours, annulation, focus rendu.
- [x] Membre d'une seule organisation : tableau de bord dès la connexion ; de deux : `/compte`.
- [x] Une mention `<script>` reste du texte.

## Tests écrits

- Unitaires et attaque : `src/schemas/regles-parametres.test.ts`, `src/schemas/parametres.test.ts`, `src/lib/image/logo.attaque.test.ts`, `src/server/actions/parametres.test.ts`, `src/server/db/requetes/parametres.test.ts` (source des requêtes), `src/server/auth/organisation-unique.attaque.test.ts`, `src/server/auth/config.test.ts` (rappel branché), `src/server/actions/exposer.test.ts` (`destinationApresConnexion`, `reponseLogo`), `src/server/email/modeles.test.ts`, `src/server/autorisation/navigation.test.ts`, `src/server/actions/inventaire.test.ts` (route du logo).
- Intégration (`dev`) : `src/server/db/parametres.integration.test.ts` (isolation des deux tables, option `sansSuppression` de `verifierIsolation` ; `CHECK` ; valeurs par défaut ; chaîne réelle ; preuve réelle ; route du logo), `src/server/db/organisation-unique.integration.test.ts`, `src/server/db/schema-isolation.integration.test.ts` (`TABLES_SANS_SUPPRESSION` : trois règles, droits), `src/server/actions/registre.integration.test.ts` (six cas).
- Bout en bout : `e2e/parametres.spec.ts` (rangs 37 et 38, deux largeurs) ; `e2e/controle-deploiement.spec.ts` et `scripts/controle-deploiement.mjs` (`/parametres`, sans cookie et avec un cookie forgé).

## Fichiers concernés

`src/server/db/schema/parametres.ts`, `schema/isolation.ts` ; `src/server/db/requetes/parametres.ts`, `src/server/db/sessions.ts`, `src/server/db/outils-test/isolation.ts` ; `src/server/services/parametres.ts`, `services/organisations.ts` ; `src/server/actions/parametres.ts`, `registre.ts`, `exposer.ts` ; `src/server/auth/organisation-unique.ts`, `config.ts` ; `src/server/autorisation/navigation.ts` ; `src/server/email/modeles.ts` ; `src/lib/image/logo.ts` ; `src/schemas/parametres.ts`, `regles-parametres.ts` ; `src/app/(app)/parametres/page.tsx`, `actions.ts`, `logo/route.ts` ; `src/app/(compte)/compte/page.tsx` ; `src/components/parametres/*`, `src/components/confirmation/confirmation-identite.tsx`, `src/components/ui/dialog.tsx`, `src/components/compte/formulaire-connexion.tsx`, `appel-auth.ts` ; `src/textes/parametres.ts`, `confirmation.ts`, `emails.ts`, `navigation.ts` ; `scripts/controle-deploiement.mjs` ; tests ; `drizzle/` (deux migrations).

## Décisions du développeur

Reçues avec la consigne (2026-10-28) :

1. Organisation unique active à la connexion, sans migration (section 9).
2. RCCM ajouté ; obligation sur une facture vérifiée dans le dépôt : non établie, À CONFIRMER (section 3.1).
3. Aucun plafond total d'organisations par compte.

Accord conditionnel sur la migration (2026-10-28), corrections appliquées :

1. Règles explicites par commande (`SELECT`, `INSERT`, `UPDATE`), aucune pour `DELETE` (section 1 ; `USING` seul pour `SELECT`, `WITH CHECK` seul pour `INSERT`, contrainte de PostgreSQL).
2. Droits `SELECT`, `INSERT`, `UPDATE`, jamais `DELETE` ; tables ajoutées aux tests des droits et de l'isolation.
3. `CHECK` de longueur (`char_length`) sur chaque colonne de texte, aux bornes de l'application.
4. Colonne `logo` lue par la seule requête qui le sert ; aperçu par notre route, sans `data:` dans la politique.
5. Email aux Propriétaires seulement sur un changement réel.
6. NCC et RCCM facultatifs, texte libre borné, À CONFIRMER.

## Notes de l'implémentation

- **Phase rouge** (commit `test(2.2)`) : 87 échecs unitaires dans 11 fichiers (modules absents) ; `e2e/parametres.spec.ts` ne se chargeait pas (textes absents) ; intégration non lancée sur `dev`, la migration n'y étant pas appliquée.
- `declarerAction` exige un `z.strictObject` à la racine : les transformations du taux et du logo sont au niveau des champs. Écart signalé : les sorties sont `{ libelle, taux: <centièmes> }` et `{ contenu: { octets, type } }`, et deux attentes de `src/schemas/parametres.test.ts` ont été adaptées à cette forme après la phase rouge.
- Doublon et plafond des taux : `refuse` du serveur (le service ne peut rendre `invalide`), messages précis par le formulaire, qui connaît la liste.
- Deux invariants anciens élargis : les paramètres d'email admis (`jeton`, et `organisation`, texte affichable) ; la liste des libellés de navigation.
- L'aperçu du logo est une balise `<img>` : `next/image` poserait un attribut `style`, refusé par la politique ; le lint en garde un avertissement (`@next/next/no-img-element`), non bloquant.
- Le dialogue shadcn porte un bouton de fermeture en anglais : non utilisé (`showCloseButton={false}`), la fenêtre a son « Annuler ».

## Reporté

- Visibilité des Commerciaux (F-015, `visibilite_commerciaux` de `DESIGN.md`) : absente de la ligne 2.2 de `PLAN.md` ; à rattacher (2.4 ou jalon 3, avant F-016).
- Obligation du NCC et du RCCM sur une facture : À CONFIRMER, avant l'émission (5.x).
- Suppression d'une organisation qui a des paramètres : à trancher par la 2.5.

## Décisions du développeur (2026-10-30)

1. Trace au journal de chaque validation des instructions de paiement, même sans changement ; email aux Propriétaires sur un changement réel seulement (inchangé, section 6).
2. Troisième forme de migration personnalisée (forçage, retrait de `DELETE` et `TRUNCATE`, `UPDATE` gardé) écrite dans `CLAUDE.md`, « Méthode de travail ».

## Défaut constaté après la migration (2026-10-30)

`parametres_logo_type` accepte un logo sans type : avec `logo` non nul et `logo_type` nul, `logo_type IN (...)` vaut `NULL`, la clause entière vaut `NULL`, et PostgreSQL admet un `CHECK` à `NULL`. Le test d'intégration « logo sans type : refusé » le montre. L'application écrit toujours les deux colonnes ensemble (`ecrireLogo`, `retirerLogo`) : seule la défense en base manque. Correctif proposé, en attente d'accord (nouvelle migration) : `(logo IS NULL AND logo_type IS NULL) OR (logo IS NOT NULL AND logo_type IS NOT NULL AND logo_type IN ('image/png', 'image/jpeg'))`.

## Choix restants

1. Format du NCC, du RCCM, liste des régimes d'imposition : texte borné retenu ; à fermer quand une source (DGI) sera citée.
