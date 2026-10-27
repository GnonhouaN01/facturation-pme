# Fonctionnalité : page publique « Données personnelles »

Statut : en cours

## Contexte

Condition d'ouverture des comptes en production (décision D de la 1.3, `PLAN.md`, jalon 1) : les personnes qui créent un compte doivent être informées du traitement de leurs données, au sens de la loi ivoirienne n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel. `THREATS.md`, section 7, fait l'inventaire du point de vue de la sécurité ; il n'existe aucune page publique qui le dise aux personnes.

Personnes concernées : tout visiteur, avant de créer un compte (page d'inscription) ou de se connecter, et tout utilisateur.

## Problème

Aucune page ne dit qui traite les données, lesquelles, pourquoi, combien de temps, à qui elles sont transmises, ni comment exercer ses droits. La PR 2 de la 1.3 (#52) ne peut pas être fusionnée sans elle.

## Solution retenue

### 1. Règle de contenu

Chaque affirmation de la page vient du code, de la configuration ou des documents du dépôt, ou d'une donnée fournie par le développeur (responsable, adresse de contact, site de l'ARTCI). Rien n'est inventé. Ce qui ne peut pas être établi s'écrit « À COMPLÉTER : <quoi> » (ou « À COMPLÉTER (<quoi>) » pour la ligne des formalités ARTCI, écrite telle que demandée), par la constante `A_COMPLETER` de `src/textes/donnees-personnelles.ts`.

**Verrou d'ouverture** : un test unitaire (`src/textes/donnees-personnelles.test.ts`) échoue si un texte de la page porte encore « À COMPLÉTER » alors que les comptes sont ouverts en production. « Ouverts » se lit dans le source de `src/server/auth/points-entree.ts` : tant que la ligne `export const COMPTES_OUVERTS_EN_PRODUCTION = false;` y figure, les comptes sont fermés ; constante passée à `true` **ou retirée** (ce que fait #52), ils sont ouverts. Le test lit le source au lieu d'importer la constante : son retrait par #52 déclenche le verrou au lieu de casser la compilation.

### 2. Sources de chaque affirmation

| Affirmation de la page | Source |
|---|---|
| Responsable : Ngolo Gnonhoua, Abidjan, Côte d'Ivoire ; contact `facturation.pme.civ@gmail.com` ; site de l'ARTCI `www.autoritedeprotection.ci` | Développeur (demande du 2026-10-27) |
| Deux rôles : responsable pour les comptes, sous-traitant pour les données saisies par une entreprise ; le client d'une entreprise s'adresse à elle | Développeur ; `THREATS.md` 7.1 et 7.4 |
| Compte : nom, email, mot de passe sous forme d'empreinte (scrypt, Better Auth 1.7.7, `node_modules/better-auth/dist/crypto/password.mjs`), adresse confirmée ou non | `src/server/db/schema/auth.ts` (tables `user`, `account`) |
| Mots de passe divulgués refusés, 12 caractères au moins ; seuls 5 caractères d'une empreinte partent vers Have I Been Pwned | `src/server/auth/config.ts` (`haveIBeenPwned`, `minPasswordLength`) ; `THREATS.md` 7.5 |
| Compte non confirmé supprimé après 7 jours | `src/server/db/comptes.ts` (`purgerComptesNonVerifies`), tâche quotidienne |
| Second facteur : clé chiffrée, codes de secours sous empreinte, attente du code 5 minutes, tout supprimé à la désactivation | `src/server/auth/codes-secours.ts` (`OPTIONS_DOUBLE_AUTH`, `twoFactorCookieMaxAge`) ; extension `twoFactor` (`symmetricEncrypt`) ; `double-authentification.md` section 2 |
| Sessions : adresse IP et navigateur (en-têtes `x-forwarded-for`, `user-agent`), dates ; 7 jours, jamais prolongée ; effacées à la déconnexion et chaque jour une fois expirées | `schema/auth.ts` (`ip_address`, `user_agent`) ; `points-entree.ts` (`entetesInternes`) ; `config.ts` (`expiresIn`, `disableSessionRefresh`) ; `purgerSessionsExpirees` |
| Changer le mot de passe ferme les autres sessions ; le réinitialiser les ferme toutes | `TEXTES_COMPTE.profil.motDePasseAide` ; `config.ts` (`revokeSessionsOnPasswordReset`) |
| Lien de réinitialisation : empreinte, 30 minutes, usage unique | `config.ts` (`resetPasswordTokenExpiresIn`, `storeIdentifier`) ; `reinitialisation.ts` |
| Lien de confirmation de l'adresse : 1 heure, rien en base | `config.ts` (`emailVerification.expiresIn`) ; commentaire de `verification` (JWT) |
| Confirmation du mot de passe avant une action sensible : 5 minutes | `src/server/db/nouvelle-authentification.ts` |
| Jetons expirés effacés chaque jour | `purgerJetonsExpires`, tâche quotidienne |
| Compteurs de tentatives : empreinte, jamais la valeur en clair, 24 heures au plus, effacés chaque jour | `src/server/debit/limites.ts` ; `CLAUDE.md` règle 15 ; `purgerCompteurs` |
| Journal d'audit : identifiant de l'auteur, action, élément, date, aucun texte libre ; jamais modifié ni supprimé par l'application | `schema/technique.ts` (`journal_audit`) ; `src/server/journal/actions.ts` ; migration `retirer-droits-journal-audit` |
| Données de facturation à venir ; un document émis n'est jamais modifié | `PLAN.md` (jalons 3 et suivants) ; `CLAUDE.md` règle 9 |
| Journaux du serveur sans adresse email ni jeton | `src/server/auth/journal.ts` ; `CLAUDE.md` règle 17 ; T-39 |
| Aucune mesure d'audience, aucun script ni ressource d'un autre site, aucun cookie tiers | Politique `default-src 'none'`, `connect-src 'self'`, `img-src 'self'`, `font-src 'self'` (`src/lib/securite/entetes.ts`) ; `CLAUDE.md` règle 16 ; aucune dépendance de mesure (`package.json`, recherche dans `src/`) |
| Cookies : `__Secure-better-auth.session_token` (7 jours) et `__Secure-better-auth.two_factor` (5 minutes), illisibles par les scripts, envoyés en HTTPS seulement ; aucun cookie pour un visiteur | `node_modules/better-auth/dist/cookies/index.mjs` (préfixe `__Secure-` sur une origine `https`, `httpOnly`, `secure`, `maxAge` = `expiresIn`) ; `points-entree.ts` (`COOKIE_SESSION`, `COOKIE_ATTENTE` : seuls cookies transmis) ; `src/proxy.ts` ne pose aucun cookie ; test de bout en bout de cette fiche |
| Vercel, fonctions à Francfort (`fra1`), pages distribuées par un réseau mondial | `CONFIGURATION.md` (« État final », étape Vercel) ; `STACK.md` ; `THREATS.md` 7.5. Aucun `regions` dans `vercel.json` : réglage du projet Vercel |
| Neon, région AWS Europe Central 1 (Francfort) | `CONFIGURATION.md` (« État final ») ; `THREATS.md` 7.5 |
| Google (Gmail) : adresse du destinataire et texte ; copie dans « Messages envoyés », vidée chaque mois | `THREATS.md` 7.5, RR-9 ; `envoi-emails.md`, décision 9 |
| Sécurité : HTTPS imposé, connexion chiffrée et vérifiée vers la base, séparation des entreprises par la base elle-même | `entetes.ts` (`Strict-Transport-Security`) ; `env-schema.ts` (`sslmode=verify-full`) ; `CLAUDE.md` règle 3 |
| Droits exercés dans le compte : nom, mot de passe, sessions, double authentification | Pages `/compte/profil`, `/compte/sessions`, `/compte/double-authentification` |

### 3. Marques « À COMPLÉTER » à la livraison

1. Base légale de chacun des sept traitements (compte, second facteur, sessions, liens, compteurs, journal d'audit, données de facturation) : aucun document du dépôt ne la fixe.
2. Durée de conservation du journal d'audit : aucune suppression n'existe (table en ajout seul) ; `THREATS.md` 7.2 dit « durée de vie de l'organisation », sans mécanisme.
3. Durée de conservation des données de facturation.
4. Délai d'effacement après une demande de suppression de compte : la suppression n'existe pas encore dans l'application.
5. Durée de conservation des journaux du serveur : `THREATS.md` 7.2 dit 30 jours, `mot-de-passe.md` section 12.3 « de l'ordre d'une heure, à vérifier » sur l'offre Hobby. Contradiction non tranchée.
6. Pays de traitement des emails par Google : « à confirmer » dans `THREATS.md` 7.5.
7. Formalités ARTCI : déclaration préalable et demande d'autorisation de transfert, numéro de récépissé.
8. Façon de prouver son identité pour exercer un droit.
9. Délai de réponse à une demande.

### 4. Page

`/donnees-personnelles`, dans la zone publique (`src/app/(public)/`) : gabarit public, pied de page compris. Ne lit jamais la session ; n'appelle pas `redirigerSiConnecte` (un utilisateur connecté doit pouvoir la lire). Contenu fixe : aucune donnée, aucune requête. Rendue à chaque requête comme toute page (gabarit racine, `connection()`, nonce de la politique), sans incidence.

Tous les textes dans `src/textes/donnees-personnelles.ts` (NF-01), sous forme de blocs (paragraphe, liste, fiche de traitement, lien) rendus par la page. Un titre `h1`, une section `h2` par sujet, un `h3` par traitement, en liste de définitions (lisible à 360 px, sans tableau large). Liens en cibles de 44 px (`min-h-11`), comme ceux de `/connexion`.

Liens vers la page :

- pied de page de la zone publique (`(public)/layout.tsx`) : toutes les pages publiques ;
- `/inscription`, sous le formulaire : « Comment nous traitons vos données » ;
- `/connexion`, avec les autres liens.

Date de mise à jour affichée : 27/10/2026.

### 5. Contrôle après déploiement

`GET /donnees-personnelles` ajouté à `scripts/controle-deploiement.mjs`, contrôlée comme `/connexion` : statut 200, politique, nonce des scripts, en-têtes, fuite. 51 requêtes par passage au lieu de 50. Le serveur factice d'`e2e/controle-deploiement.spec.ts` la sert ; un défaut `donnees-personnelles-500` fait échouer le seul `donnees-personnelles:statut`.

Le contrôle ne cherche pas « À COMPLÉTER » en production : le verrou est le test unitaire, qui bloque la fusion de #52.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Texte écrit dans `page.tsx` | NF-01 : textes dans `src/textes/` ; le verrou lit un seul module |
| Tableaux pour les traitements | Défilement horizontal à 360 px ; une liste de définitions par traitement se lit sans |
| Verrou par import de `COMPTES_OUVERTS_EN_PRODUCTION` | #52 retire la constante : le test cesserait de compiler au lieu de rappeler les marques |
| Bandeau de consentement aux cookies | Aucun cookie autre que ceux du compte, posés à la connexion |
| Recherche de « À COMPLÉTER » par le contrôle après déploiement | Échouerait à chaque déploiement tant que les formalités ne sont pas faites ; le verrou suffit à la fusion de #52 |

## Règles de sécurité et permissions

- Page publique, sans session, sans donnée : aucune ligne de la matrice des droits.
- Aucune ressource externe (S-80) : le lien vers le site de l'ARTCI et l'adresse `mailto:` sont de simples liens, rien n'est chargé. Vérifié par le test de bout en bout (toute requête sur la même origine).
- Section « Sécurité » sans détail exploitable : ni algorithme, ni limite chiffrée, ni nom de table.
- Aucune table, aucune migration, aucune dépendance, aucune route.

## Critères d'acceptation

- [ ] `GET /donnees-personnelles` sans cookie : 200, titre « Données personnelles », aucun cookie posé, aucune requête vers une autre origine.
- [ ] Lien vers la page dans le pied de page de la zone publique, sur `/inscription` et sur `/connexion`.
- [ ] Chaque affirmation tracée dans la section 2 ; marques de la section 3, chacune de la forme « À COMPLÉTER : <quoi> ».
- [ ] Verrou : avec les comptes ouverts (constante à `true` ou absente), le test échoue tant qu'une marque reste.
- [ ] Affichage à 360, 390 et 1280 px : un seul `h1`, aucun défilement horizontal, cibles de 44 px, aucune violation de la politique.
- [ ] Contrôle après déploiement : page contrôlée, défaut `donnees-personnelles-500` détecté.
- [ ] Liste de contrôle de #52 (`mot-de-passe.md`, section 12) : case « page `/donnees-personnelles` sans À COMPLÉTER ».

## Tests à écrire

### Tests unitaires

- [ ] `src/textes/donnees-personnelles.test.ts` : verrou (comptes ouverts et marques présentes : échec ; démonstrations : constante à `false`, à `true`, absente) ; chaque marque de la forme « À COMPLÉTER : <quoi> » ; contact et site de l'ARTCI exacts ; `page.tsx` sans texte en dur « À COMPLÉTER ».

### Tests d'attaque

- Accès sans session : la page est publique, c'est le comportement attendu (test de bout en bout). Autre organisation, rôle, entrée falsifiée : sans objet (aucune donnée, aucune entrée).

### Tests de bout en bout

- [ ] `e2e/donnees-personnelles.spec.ts` (deux largeurs) : 200 sans session, titre, aucun cookie, même origine ; liens du pied de page, de `/inscription`, de `/connexion`.
- [ ] `e2e/pages-livrees.ts` : la page rejoint les tests d'affichage (360, 390, 1280 px).
- [ ] `e2e/controle-deploiement.spec.ts` : comptes de requêtes, défaut `donnees-personnelles-500`.

## Fichiers concernés

- `docs/features/donnees-personnelles.md`, `docs/PLAN.md`, `docs/features/mot-de-passe.md` (section 12), `docs/features/controle-deploiement.md`, `CLAUDE.md`
- `src/textes/donnees-personnelles.ts`, `src/textes/donnees-personnelles.test.ts`
- `src/app/(public)/donnees-personnelles/page.tsx`, `src/app/(public)/layout.tsx`, `src/app/(public)/inscription/page.tsx`, `src/app/(public)/connexion/page.tsx`
- `e2e/donnees-personnelles.spec.ts`, `e2e/pages-livrees.ts`, `e2e/controle-deploiement.spec.ts`, `playwright.config.ts`
- `scripts/controle-deploiement.mjs`

## Limites connues

- `THREATS.md` 7.2 annonce des sessions de « 30 jours sans activité » : le code les borne à 7 jours, sans prolongation (décision 3 de la 1.2). La page suit le code ; `THREATS.md` est à corriger à part.
- Le contenu juridique (bases légales, délais) n'est pas établi par le dépôt : il revient au développeur, avant #52.
