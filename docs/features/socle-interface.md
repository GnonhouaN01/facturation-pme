# Fonctionnalité : socle d'interface

Statut : en cours. PR 1 implémentée le 2026-10-11 (non commitée) ; PR 2 et 3 à faire.

Jalon 0, fonctionnalité 0.6 de `docs/PLAN.md`. Taille L (décision 12), en trois PR.

## Contexte

Cette fonctionnalité sert au développeur, et indirectement à tous les utilisateurs. Elle pose ce dont chaque écran aura besoin à partir du jalon 1 : les gabarits des trois zones, la navigation, les pages « introuvable » et « erreur », les textes, le formatage des montants et des dates, et les en-têtes de sécurité.

État au départ, constaté le 2026-10-11 :

- La 0.5 est livrée (PR #32, CI verte). La chaîne de contrôles (0.4) fournit `etablirContexte`, noyau des lectures par les pages (`chaine-controles.md`, section 3.2, décision 9). L'adaptateur des pages et de `(app)/layout.tsx` est reporté à la 0.6, avec les libellés des codes `connexion_requise`, `refuse`, `invalide`, `erreur` (`chaine-controles.md`, « Reporté ») et `trop_de_requetes` (`limitation-debit.md`, « Reporté »).
- `src/app/` ne contient que `layout.tsx` (polices DM Sans, DM Mono, Space Grotesk par `next/font/google`, `lang="fr"`), `page.tsx` (un bouton « Facturation PME », sans action), `globals.css` (jetons Signal) et `favicon.ico`. `src/components/ui/` ne contient que `button.tsx`. `src/textes/` n'existe pas. `next.config.ts` est vide : aucun en-tête de sécurité n'est envoyé, et `X-Powered-By: Next.js` l'est.
- `e2e/accueil.spec.ts` vérifie le thème Signal sur le bouton de l'accueil. La CI lance Playwright sur le site construit (`npm run start`), dans le job avec base ; en local, Playwright lance aujourd'hui `npm run dev`.
- Aucun écran de connexion n'existe avant le jalon 1, et `testUtils` est interdit dans l'application livrée (`CLAUDE.md`, règle 14).
- Les maquettes de la phase 8 ne sont pas dans le dépôt. La disposition de la zone application a été décrite d'après elles à la validation (décision 13, section 10).

Cas d'utilisation concernés : aucun en propre. Les messages d'erreur de `USECASES.md` (introuvable, erreur générique) s'affichent par les pages livrées ici.

## Problème

- Aucune page de l'application n'a de gabarit, ni de navigation, ni de façon commune de lire le contexte (session, adhésion, rôle). Rien n'oblige une page à passer par `etablirContexte` (`chaine-controles.md`, « Limites connues »).
- Une page inexistante ou une erreur affichent les pages par défaut de Next.js, en anglais.
- Aucun texte n'est regroupé (NF-01), aucun montant ni aucune date n'a de format commun (NF-02).
- Le site n'envoie aucun en-tête de sécurité (S-80) : ni politique de sécurité du contenu, ni interdiction d'affichage dans un cadre, ni HSTS, ni politique de référent.

## Les trois PR

| PR | Contenu | Prouve |
|---|---|---|
| 1. Textes, formatage, règles | `src/textes/` (commun, navigation, erreurs, résultats, simulation) ; `src/lib/format/` (montants, dates) ; règles ESLint O, P, Q, R et leurs cas ; l'accueil et les métadonnées du gabarit racine lisent leurs textes dans `src/textes/` (règle R) | NF-01, NF-02 ; aucun point d'injection de HTML ni de script possible dans le code à venir ; accessibilité vérifiée à l'analyse |
| 2. En-têtes et pages d'erreur | `src/proxy.ts`, `src/lib/securite/entetes.ts`, `next.config.ts`, rendu dynamique (`connection()`), `not-found.tsx`, `error.tsx`, `global-error.tsx`, `onRequestError`, exception de la règle B pour `NODE_ENV` dans `src/proxy.ts`, règle S ; Playwright sur le site construit en local | S-80, S-85, T-34 (politique), T-35 (rendu des pages d'erreur), T-37 |
| 3. Zones et navigation | Gabarits des trois zones, barre latérale, bandeau de simulation, accueil déplacé, `lirePourPage`, navigation, page vide du tableau de bord, inventaire des pages, projets 390 et 1280 ; second serveur Playwright, base injoignable | S-02 à l'affichage, NF-03, NF-04, T-35 de bout en bout ; la réponse au visiteur non connecté |

Après chacune, `main` reste cohérent et la CI verte (décision 12).

## Solution retenue

Exigences couvertes : S-80, S-85, S-02 (affichage), S-51 (en partie), S-54 (en partie), NF-01 à NF-04. NF-06 pour les tests d'attaque de cette fiche. NF-08 est concerné par le rendu dynamique (section 5.2).

### 0. Vérifications avant la phase rouge

Trois incertitudes levées le 2026-10-11 par un essai jetable, supprimé ensuite (`src/proxy.ts` et `src/lib/essai06/entetes.ts` temporaires, `next.config.ts` et `src/app/layout.tsx` modifiés puis restaurés par `git checkout`, `.next` reconstruit ensuite sans l'essai, port 3000 libéré) :

1. **Règles `jsx-a11y` activables par leur nom, sans importer le module.** Par l'API d'ESLint, avec `overrideConfig` : `jsx-a11y/click-events-have-key-events` et `jsx-a11y/no-static-element-interactions` (absentes de la configuration de Next.js) se déclenchent en erreur ; `jsx-a11y/alt-text` (en avertissement chez Next.js) passe en erreur. `react/no-danger`, `react/jsx-no-script-url` et `react/jsx-no-literals` se déclenchent de même. Le module `eslint-plugin-jsx-a11y` 6.10.2 est enregistré par `eslint-config-next` sous le préfixe `jsx-a11y`. Son jeu recommandé compte 34 règles, dont 31 en erreur et 3 désactivées (`anchor-ambiguous-text`, `control-has-associated-label`, `label-has-for`).
2. **`next.config.ts` importe un module de `src/`.** `import { ... } from "./src/lib/essai06/entetes"` : l'en-tête est posé par `next dev` et par le site construit, sur une page et sur une 404.
3. **Politique de développement et rechargement à chaud.** Avec `script-src 'self' 'nonce-<n>' 'strict-dynamic' 'unsafe-eval'`, `style-src 'self' 'unsafe-inline'`, `connect-src 'self'` et le reste de la section 5.3 : aucune violation, page hydratée ; une couleur modifiée dans `globals.css` et un texte modifié dans `page.tsx` s'appliquent sans rechargement de la page. `connect-src 'self'` suffit au canal du rechargement à chaud.

Constaté en plus, sur le site construit :

4. **Sans rendu dynamique, la politique casse la page.** La page d'accueil préconstruite (`○`) ne porte aucun nonce : 9 violations (`script-src-elem`), page non hydratée. Avec `await connection()` dans le gabarit racine, les routes deviennent dynamiques (`ƒ`), les 9 scripts portent le nonce de la réponse, aucune violation, page hydratée. Confirme la section 5.2.
5. Une 404 reçoit la politique, l'en-tête de `next.config.ts`, et `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`. `X-Powered-By: Next.js` est envoyé tant que `poweredByHeader` n'est pas à `false`.
6. Aucune requête hors de l'origine (polices comprises), en développement comme sur le site construit.

Constaté le 2026-10-12, pendant la phase rouge de la PR 2 :

7. **Une configuration refusée dans `register` fait échouer chaque requête.** Section 4.3, niveau 3.
8. **Le test du cadre doit servir l'autre origine par un vrai serveur.** Une page fournie par `route.fulfill` de Playwright est vue par Chromium comme publique : il refuse qu'elle charge `localhost` (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`), même avec la permission `local-network-access` et l'attribut `allow` du cadre. Le test passait alors sans aucun en-tête. Il sert la page parente par `node:http` sur `127.0.0.1`, port éphémère, fermé à la fin du test.

### 1. Les trois zones et leurs gabarits

Selon `docs/STRUCTURE.md`, section 2.

| Zone | Dossier | Gabarit | Lit la session | Contenu en 0.6 |
|---|---|---|---|---|
| Publique (F1) | `src/app/(public)/` | `(public)/layout.tsx` : en-tête avec le nom du produit (`display`, graisse 600), contenu, pied de page | Non | L'accueil, déplacé de `src/app/page.tsx` vers `(public)/page.tsx` : titre et phrase de présentation, sans bouton (aucune action n'existe) |
| Application (F2) | `src/app/(app)/` | `(app)/layout.tsx` : barre latérale, bandeau de simulation, contenu (section 10) | Oui, par l'adaptateur (section 2) | Une page vide `(app)/tableau-de-bord/page.tsx` (titre seul), que la 7.1 remplira. Elle sert de cible aux tests du gabarit (décision 2) |
| Pages par lien (F1, la plus exposée) | `src/app/lien/` | `lien/layout.tsx` : contenu seul, sans navigation, sans lien vers l'application | Jamais | Le gabarit seul. Aucune page avant la 4.5 |

Le gabarit racine `src/app/layout.tsx` garde les polices et `lang="fr"`, et force le rendu dynamique de toutes les pages (section 5.2).

**Pourquoi une page vide dans la zone application.** Un gabarit sans page n'est pas joignable : il ne se teste pas. La page `tableau-de-bord` ne lit rien d'autre que le contexte, et passe par l'adaptateur comme toute page de la zone (section 2.3). Elle n'expose aucune donnée. Une page de démonstration réservée aux tests est écartée, pour la raison de l'option P1 de `chaine-controles.md` (section 9) : elle existerait en production.

**La zone par lien.** Le gabarit ne lit jamais la session : un client final n'a pas de compte, et la page ne doit rien révéler du membre qui l'aurait ouverte par erreur. Sa page « Ce lien n'est plus valable » (`lien/not-found.tsx`) n'est déclenchée que par `notFound()` dans une page de la zone. Une adresse sans page aboutit à la page « introuvable » racine. Elle est donc livrée avec la 4.5, sa première page. En 0.6, la zone reçoit ses en-têtes propres (section 6), vérifiables sur une adresse sans page.

### 2. L'adaptateur des pages et la navigation

#### 2.1 L'adaptateur `lirePourPage`

Dans `src/server/actions/exposer.ts`, à côté d'`exposer`. C'est le seul fichier de `server/actions/` autorisé à importer `next/headers` (règle ESLint, `chaine-controles.md`, section 7) : aucune règle n'est à modifier.

```ts
export async function lirePourPage<T>(
  droit: Droit,
  lire: (ctx: ContexteLecture) => Promise<T>,
): Promise<T>;
```

- Lit `await headers()`, les copie dans un `Headers` ordinaire (comme `exposer`), appelle `etablirContexte({ entetes }, droit, lire)`, puis traduit le résultat par une fonction pure exportée, `traduireLecture(resultat)`, testable sans Next.js.

| Résultat de `etablirContexte` | Traduction pour une page |
|---|---|
| `{ ok: true, donnees }` | Renvoie `donnees` |
| `refuse` | `notFound()` : la page « Cette page est introuvable » (S-02) |
| `connexion_requise` | En 0.6 : `notFound()`, comme `refuse` (décision 1). En 1.2 : redirection vers la connexion |
| `erreur` + `incident` | Lève `ErreurPage`, dont le `digest` vaut l'incident (section 4.2) |
| `trop_de_requetes` | Inatteignable en 0.6 : `etablirContexte` n'a pas d'étape 4 (section 9). Traité comme `erreur`, avec un nouvel incident, jusqu'à la fonctionnalité qui limitera les lectures |

- `redirect()` et `notFound()` levés par `lire` sont relancés tels quels par `etablirContexte` (déjà testé en 0.4).
- `generateMetadata` d'une page de la zone, s'il lit une donnée, passe aussi par `lirePourPage` : Next.js l'exécute à part de la page.

#### 2.2 Ce que voit un visiteur non connecté qui ouvre une page de l'application

Décision 1 (option V1) : la page « Cette page est introuvable », statut 404, identique à celle d'une adresse inexistante. Aucun membre ne peut se connecter avant la 1.2.

Options écartées : une page « Connectez-vous pour accéder à cette page » (à remplacer un jalon plus tard) ; une redirection vers l'accueil (masque l'erreur) ; `unauthorized()` de Next.js (expérimental, `authInterrupts`).

La 1.2 remplace V1, pour `connexion_requise` seulement, par une redirection vers `/connexion` avec l'adresse de retour, limitée à un chemin relatif de l'application (pas de redirection ouverte). Un cookie de session forgé, expiré ou absent donne, en 0.6 comme après, la même réponse que l'absence de cookie.

#### 2.3 Le gabarit ne protège pas : chaque page se protège

Lu dans `node_modules/next/dist/docs/01-app/02-guides/authentication.md` (« Layouts and auth checks ») : un gabarit n'est pas réexécuté à chaque navigation, et il n'empêche pas les segments qu'il contient de s'exécuter ni d'apparaître dans la charge utile RSC. Donc :

- `(app)/layout.tsx` appelle `lirePourPage` pour connaître le rôle et afficher la navigation. C'est de l'affichage.
- **Chaque `page.tsx` de `(app)/` appelle `lirePourPage` elle-même**, même si elle ne lit aucune donnée. C'est ce contrôle qui protège. Il garantit aussi qu'un visiteur non connecté reçoit « introuvable » sur toute page de la zone.
- Le test d'inventaire (`src/server/actions/inventaire.test.ts`) est étendu : chaque `page.tsx` sous `src/app/(app)/` contient un appel à `lirePourPage`. C'est un contrôle textuel, contournable à dessein, comme les règles de la 0.4 (« Limites connues »).
- Une page ne peut obtenir aucune transaction autrement : `executerDansOrganisation` et `executerChaine` lui sont interdits (règles E, I, M). Un service exige un contexte, que seuls la chaîne et `etablirContexte` fournissent.
- Aucun `loading.tsx` dans `(app)/` en 0.6 : avec lui, `notFound()` répond 200 au lieu de 404 (réponse diffusée en flux, `not-found.md`), et la réponse ne serait plus identique à celle d'une adresse inexistante. À reprendre par la fonctionnalité qui en voudra un.

#### 2.4 La navigation dépend des droits, mais masquer un lien n'est pas un contrôle d'accès

- Les entrées de la navigation vivent dans `src/server/autorisation/navigation.ts` : `{ chemin, cle, droit }`, où `cle` désigne un libellé de `src/textes/navigation.ts` et `droit` une clé de la matrice, ou `null` pour une entrée ouverte à tout membre. `entreesVisibles(role, entrees = ENTREES_NAVIGATION)` ne garde que les entrées dont `droit` est `null` ou pour lesquelles `peut(role, droit)` est vrai. Le droit est lu dans la matrice, jamais recopié. `STRUCTURE.md`, section 7, autorise `app/` à importer ce fichier (mis à jour à la validation).
- **Une entrée masquée n'est pas une page protégée.** Un membre qui saisit l'adresse d'une page dont le lien lui est caché reçoit la réponse de la page elle-même, c'est-à-dire de `lirePourPage` avec le droit de cette page. La navigation n'est qu'un confort d'affichage. Le test d'attaque de chaque page (accès par un rôle non autorisé, `PLAN.md` section 4.3) reste dû par la fonctionnalité qui crée la page.
- **Ordre des entrées** (décision 13, d'après la maquette) : Tableau de bord, Clients, Catalogue, Devis, Factures, Paiements, Relances, Organisation. Une entrée n'est ajoutée qu'avec sa page, à sa place dans cet ordre, avec son libellé et son droit, choisis par la fonctionnalité qui crée la page. Aucun lien vers une page qui n'existe pas.
- **En 0.6, une seule entrée apparaît : « Tableau de bord »** (`/tableau-de-bord`, `droit: null`). Clients (3.1), Catalogue (3.3), Devis (4.2), Factures (5.1), Paiements (6.1), Relances (6.3) et Organisation (2.2) apparaîtront avec leur page. Le filtrage est testé avec une liste de test qui couvre chaque type de droit (`oui`, `non`, `portefeuille`, `lecture_portefeuille`) et chaque rôle.
- **Droit lu par le gabarit** (décision 3) : `organisation.membres.voir`, accordé aux quatre rôles. La matrice n'a pas de droit « être membre » ; un commentaire dans le gabarit le dit.

#### 2.5 Ce qu'on construit et prouve de la zone application maintenant

Décision 2 (option Z1) : construire le gabarit, l'adaptateur, la navigation et la page vide. Prouver la traduction des résultats et le filtrage par des tests unitaires, la lecture du rôle avec de vraies sessions par un test d'intégration (`creerMembre`, comme en 0.4), et la réponse au visiteur non connecté par un test de bout en bout. Le parcours connecté dans un navigateur est fait par la 1.2.

Options écartées : une préparation globale de Playwright qui créerait des membres par `outils-test/membres.ts` (fait sortir l'outillage de test de Vitest, demande la base en local, rendue inutile par la 1.2) ; ne rien construire avant le jalon 1 (laisse l'adaptateur sans usage).

Le test d'intégration appelle `etablirContexte` avec la fonction de lecture du gabarit (exportée pour le test) et une vraie session de chaque rôle : il vérifie les entrées obtenues et le libellé de rôle, puis le refus d'un membre dont l'organisation active n'est pas la sienne, et d'un rôle inconnu. La partie Next.js de `lirePourPage` (lecture de `headers()`) n'est éprouvée qu'en bout en bout, sans session.

### 3. La page « introuvable »

`src/app/not-found.tsx`, rendue dans le gabarit racine, sans navigation de zone.

- Titre : « Cette page est introuvable », mot pour mot (`DESIGN-SYSTEM.md`, « Ce que la sécurité impose à l'écran »). Pas de « 404 », ni dans le texte ni dans le titre de l'onglet.
- Une action principale, lien stylé en bouton : « Revenir à l'accueil » (`/`).
- Statut HTTP 404.
- La même page pour : une adresse inexistante, une page de l'application sans session, une ressource refusée ou absente (`refuse`). Aucun texte ne varie selon la cause.
- Mise en page sobre (décision 13) : contenu centré dans la largeur, marges `espace-12` sur ordinateur et `espace-4` sur mobile.

Les tests du thème Signal qui visent aujourd'hui le bouton de l'accueil (`e2e/accueil.spec.ts`) passent sur cette action en PR 2 : couleur, survol, état pressé, focus, hauteur et rayon. Modification d'un test existant, signalée dans la PR.

### 4. La page « erreur »

#### 4.1 Ce qu'elle affiche

`src/app/error.tsx` (composant client, obligatoire pour une frontière d'erreur) et `src/app/global-error.tsx` (erreur dans le gabarit racine ; il porte ses propres `<html lang="fr">`, `<body>`, polices et `globals.css`).

- « Une erreur est survenue. », mot pour mot.
- « Identifiant de l'incident : » suivi de l'identifiant, en `mono`, sélectionnable.
- Une action principale « Recharger la page » (`retry()`), et un lien secondaire « Revenir à l'accueil ».
- Jamais `error.message`, `error.name`, `error.stack` ni `error.cause`. Le composant ne lit que `error.digest`.
- Mise en page sobre, comme la page « introuvable ».

#### 4.2 L'identifiant d'incident

Lu dans `node_modules/next/dist/docs/.../error.md` et `node_modules/next/dist/server/app-render/create-error-handler.js` :

- En production, une erreur levée par un composant serveur arrive au navigateur avec un message générique et un `digest`. Le `digest` est une empreinte numérique du message et de la pile, calculée par Next.js. Si l'erreur porte déjà un `digest`, Next.js le garde (commentaire « respect the original digest », lignes 79 à 81).
- Une erreur levée par un composant client arrive avec son message d'origine et sans `digest`.

| Origine | Identifiant affiché | Consigné où |
|---|---|---|
| `erreur` renvoyé par `etablirContexte` | L'incident de la chaîne (`crypto.randomUUID()`), porté par `ErreurPage.digest` | Journal technique de la chaîne (déjà en 0.4), puis `onRequestError` |
| Toute autre erreur serveur | Le `digest` de Next.js | `onRequestError` (ci-dessous) |
| Erreur d'un composant client | Aucun : la page affiche « Une erreur est survenue. » sans identifiant (décision 6, jusqu'à la 8.1) | Nulle part avant la 8.1 |

`src/instrumentation.ts` exporte `onRequestError`, qui délègue à `consignerErreurRequete` (`src/server/erreurs/consigner.ts`) : une ligne `console.error("[requete]", JSON)` avec seulement `digest`, `classe` (nom du constructeur), `code` (code PostgreSQL de cinq caractères, lu en suivant les `cause`, comme `refus.ts`), `routePath` et `routeType`. Jamais le message, la pile, l'adresse demandée, les en-têtes ni les paramètres :

- `routePath` est le motif de la route (`/lien/devis/[jeton]`), jamais le chemin réel, qui contiendrait le jeton d'un lien public (S-20, S-54).
- Comme en 0.4, ce journal par `console.error` est provisoire jusqu'à la 8.1.

#### 4.3 La preuve qu'aucun message d'exception n'atteint le navigateur

Trois niveaux :

1. **Rendu des composants, sans navigateur.** `error.tsx` et `global-error.tsx` sont rendus en chaîne par `react-dom/server` (déjà installé) dans Vitest, avec une erreur dont le message, le nom, la pile et la cause contiennent des marqueurs (`SELECT`, `postgresql://`, `/home/`, `DATABASE_URL`, une adresse email) : aucun marqueur dans la sortie. Ces tests sont des `.test.tsx` : l'inclusion de Vitest (`src/**/*.test.ts`) est étendue en PR 2.
2. **Traduction.** `traduireLecture` sur `erreur` lève une `ErreurPage` dont le message est fixe, sans `cause`, et dont le `digest` est l'incident.
3. **Bout en bout, sur le site construit, avec une vraie panne (PR 3, décision 17).** Un second serveur Playwright (`next start`, port 3101) est lancé avec une configuration **valide** pour `env-schema.ts` (rôle `app_facturation`) et une base injoignable : `DATABASE_URL` vise un port fermé sur `127.0.0.1`. `register` passe ; le proxy, qui ne dépend pas d'`env.ts` (section 5.5), répond normalement ; la panne est observée sur `/tableau-de-bord`, dont la lecture échoue à la connexion. Le test ouvre `/tableau-de-bord` et vérifie : la page « Une erreur est survenue. » avec un identifiant ; ni dans le HTML ni dans la charge utile RSC les chaînes `DATABASE_URL`, `Variables d'environnement`, `postgres`, `node_modules`, `.next`, `at ` suivi d'un chemin, ni le nom d'une classe d'erreur. Aucun code de test n'existe dans l'application : la panne vient de la configuration du serveur de test.

   **Une configuration refusée ne convient pas** (constaté le 2026-10-12, Next.js 16.3.8, `next start` sur le port 3101, site construit sans la PR 2, `DATABASE_URL` au rôle factice sur `localhost`). Le serveur annonce « Ready », puis `register` (`src/instrumentation.ts`) lève : `Failed to prepare server Error: An error occurred while loading instrumentation hook`, suivi du message d'`env-schema.ts` et de la pile, puis un `unhandledRejection`. Ensuite **chaque requête** échoue, `/` comprise, et non seulement les modules qui importent `env.ts` : statut 500, corps `Internal Server Error` (21 caractères), en-têtes `connection`, `date`, `keep-alive` et `transfer-encoding` seuls. Ni le corps ni les en-têtes ne contiennent le message, la pile, le nom de la variable, une adresse ou un chemin de fichier ; tout cela n'apparaît que dans le journal du serveur. Playwright attend un statut accepté (2xx, 3xx, 400 à 403), ne l'obtient jamais, et arrête toute la suite au bout de 120 s, avant le premier test. `register` n'attrape pas cette erreur : une configuration refusée doit empêcher le service (décision 17).

Le scénario « base injoignable avec une session valide » demande une vraie session dans le navigateur : reporté à la 1.2.

### 5. La politique de sécurité du contenu (S-80, T-34)

#### 5.1 Ce que dit Next.js 16.3.8

Lu dans `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` et `.../file-conventions/proxy.md` :

- Une politique stricte sans `'unsafe-inline'` passe par un **nonce** : un `proxy.ts` (ancien `middleware.ts`, renommé en 16.0, environnement Node.js par défaut) tire un nonce à chaque requête et pose l'en-tête `Content-Security-Policy` sur la requête et sur la réponse. Next.js lit le nonce dans l'en-tête de la requête pendant le rendu et l'ajoute à ses scripts, à ses fichiers de page et à ses styles en ligne.
- **Le nonce exige le rendu dynamique de toutes les pages.** Une page préconstruite n'a pas de nonce : ses scripts seraient bloqués (constaté, section 0, point 4). Le rendu statique, l'ISR et le prérendu partiel (PPR) sont incompatibles.
- En développement, React utilise `eval` : `'unsafe-eval'` est nécessaire, et les styles injectés par le rechargement à chaud demandent `'unsafe-inline'`. Ni l'un ni l'autre en production.
- L'intégrité des sous-ressources (`experimental.sri`) garde le rendu statique, mais elle est expérimentale et ne traite pas les scripts produits à la volée (« Build-time only »).

#### 5.2 Option retenue : nonce, toutes les pages en rendu dynamique

Nonce par `src/proxy.ts`. Les zones application et par lien sont dynamiques de toute façon (session, jeton). Seules les pages publiques perdent le rendu statique : chaque visite devient une exécution de fonction chez Vercel, sans effet notable à ce trafic sur l'offre gratuite (NF-08).

Écartées : `'unsafe-inline'` dans `script-src` (un script injecté s'exécute, la politique n'est plus stricte) ; `experimental.sri` (expérimental) ; empreintes calculées à la main (scripts qui changent à chaque requête) ; politique dans une balise `<meta>` (`frame-ancestors` n'y est pas pris en compte).

Conséquences :

- Le gabarit racine appelle `await connection()` (`next/server`) : toutes les pages, dont la page « introuvable », sont rendues à la requête (constaté, section 0, point 4). Vérifié en bout en bout : deux requêtes successives sur la même page reçoivent deux nonces différents.
- `cacheComponents` et le prérendu partiel restent désactivés. À inscrire dans les « Pièges connus » de `CLAUDE.md` avec la PR 2.
- Aucun script tiers. `next/script` et la balise `<script>` sont interdits dans `src/` (règle O) : l'en-tête `x-nonce` du guide n'est donc pas transmis.

#### 5.3 La politique, directive par directive

Production :

| Directive | Valeur | Raison |
|---|---|---|
| `default-src` | `'none'` | Tout ce qui n'est pas listé est refusé : `frame-src`, `media-src`, `worker-src`, `manifest-src`, `child-src` |
| `script-src` | `'self' 'nonce-<n>' 'strict-dynamic'` | Seuls les scripts portant le nonce, et ceux qu'ils chargent. `'self'` ne sert qu'aux navigateurs sans `'strict-dynamic'` |
| `style-src` | `'self' 'nonce-<n>'` | Les feuilles de Tailwind, compilées en fichiers servis par `/_next/static`, et les styles en ligne de Next.js, qui portent le nonce |
| `img-src` | `'self'` | Aucune image distante. Les icônes Lucide sont du SVG dans le document, pas des images. `data:` et `blob:` ajoutés seulement si une fonctionnalité en a besoin |
| `font-src` | `'self'` | `next/font/google` télécharge les polices à la construction et les sert depuis `/_next/static/media` : aucune requête vers Google à l'affichage (constaté, section 0, point 6) |
| `connect-src` | `'self'` | Actions serveur, navigation et préchargement de Next.js |
| `object-src` | `'none'` | Aucun greffon |
| `base-uri` | `'none'` | Aucune balise `<base>` |
| `form-action` | `'self'` | Les formulaires et actions serveur ne visent que l'application |
| `frame-ancestors` | `'none'` | Aucun affichage dans un cadre, même du même site (S-80) |

Le nonce : 16 octets de `crypto.getRandomValues`, en base64, neuf à chaque requête.

Non retenu dans la politique :

- `upgrade-insecure-requests` : toutes les ressources sont de la même origine, servie en HTTPS avec HSTS. La directive réécrirait aussi les ressources de `http://localhost` lors des tests sur le site construit.
- `require-trusted-types-for 'script'` : reporté à la 8.4 (décision 8).
- `report-to` : aucun service de collecte avant la 8.1.
- `vercel.live` : non ouvert ; la barre d'outils de Vercel est désactivée dans les réglages du projet par le développeur (décision 9).

Développement (`next dev`) : `script-src` reçoit en plus `'unsafe-eval'` ; `style-src` devient `'self' 'unsafe-inline'` (un nonce rendrait `'unsafe-inline'` sans effet). Le reste est identique, `connect-src 'self'` compris (constaté, section 0, point 3). Un test unitaire vérifie que la politique de production ne contient aucun mot-clé `unsafe-`.

**Styles en ligne de Tailwind et de shadcn/ui.** Tailwind 4 compile des classes dans une feuille servie par l'application : rien en ligne. Mais un attribut `style="..."` écrit dans le HTML par le serveur est bloqué par `style-src` sans `'unsafe-inline'` (un attribut ne porte pas de nonce). Base UI, sur lequel reposent les composants shadcn du projet, pose des styles en ligne pour le positionnement de ses fenêtres et menus (constaté dans `node_modules/@base-ui/react/internals/useAnchorPositioning.js`, `navigation-menu`, `scroll-area`). Un style posé par JavaScript après le chargement (`element.style`) n'est pas bloqué ; un attribut rendu par le serveur l'est.

Retenu : aucun attribut `style` permis ; la règle P l'interdit dans `src/` ; le test « aucune violation » de chaque page signale le premier composant qui en rendrait un. La fiche qui l'ajoutera tranchera (`style-src-attr 'unsafe-inline'` ou un autre composant). En 0.6, seul `Button` est utilisé, qui n'en rend aucun.

#### 5.4 Ce que la politique laisse passer

À écrire tel quel, pour ne pas surestimer la protection :

- Tout script qui porte le nonce, et tout ce qu'il charge (`'strict-dynamic'`) : une dépendance compromise du paquet de l'application s'exécute (S-88 traite ce risque).
- Une injection de HTML qui n'exécute pas de script : un faux formulaire qui poste vers l'application (`form-action 'self'`), du balisage pendant qui capture la suite de la page, une balise `<meta http-equiv="refresh">` vers un autre site (la politique ne contrôle pas la navigation). La première défense reste l'échappement de React (S-51) et l'interdiction de `dangerouslySetInnerHTML` (règle O).
- La navigation de la page vers un autre site (`window.location`) par un script autorisé.
- Les liens que l'utilisateur suit.

#### 5.5 Où vit le code, et la lecture du mode développement

- `src/lib/securite/entetes.ts` : fonctions pures, sans dépendance, `politiqueSecurite({ nonce, developpement })` et `ENTETES_SECURITE` (section 6). Dans `lib/` et non dans `server/`, parce que `next.config.ts` les importe (constaté possible, section 0, point 2) : il est chargé hors de Next.js, et `import "server-only"` y échouerait.
- `src/proxy.ts` : tire le nonce, pose la politique sur la requête et la réponse. Sélecteur : toutes les adresses sauf `_next/static`, `_next/image` et `favicon.ico`. Contrairement au guide, les requêtes de préchargement **ne sont pas exclues** : une réponse sans politique ne doit pas exister pour une page, et un en-tête `next-router-prefetch` envoyé par un client ne doit pas faire sauter le proxy (test d'attaque).
- **Mode développement** (décision 11, option M2) : `src/proxy.ts` lit `process.env.NODE_ENV`, et seulement cette propriété. La règle B d'`eslint.config.mjs` reçoit cette exception étroite en PR 2, et la règle 12 de `CLAUDE.md` la mentionne. Un test de règle prouve que toute autre variable lue dans `src/proxy.ts` est refusée, que `process.env` entier y est refusé, et que `process.env.NODE_ENV` reste refusé dans tout autre fichier de `src/`. Le proxy n'importe pas `env.ts` (règle S, section 7) : une variable invalide ne le fait pas échouer.

### 6. Les autres en-têtes

Posés par `next.config.ts` (`async headers()`, source `/(.*)`), qui s'applique à toutes les réponses, fichiers statiques et 404 compris. La politique de sécurité du contenu, qui dépend de la requête, est la seule posée par le proxy.

| En-tête | Valeur | Portée | Raison |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Tout | Impose HTTPS (S-80). Sans `preload` : l'application est servie sous `vercel.app`, domaine qui ne nous appartient pas. Ignoré par le navigateur sur `http://localhost` |
| `X-Content-Type-Options` | `nosniff` | Tout | Aucun fichier interprété hors de son type |
| `X-Frame-Options` | `DENY` | Tout | Doublure de `frame-ancestors 'none'` pour les navigateurs anciens |
| `Referrer-Policy` | `same-origin` | Tout | Aucune adresse envoyée à un autre site, pas même l'origine (S-80, T-37). Voir le piège ci-dessous |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` | Tout | Aucune de ces fonctions n'est utilisée |
| `Cross-Origin-Opener-Policy` | `same-origin` | Tout | Une page ouverte par un autre site ne garde aucune référence à la nôtre |
| `Cross-Origin-Resource-Policy` | `same-origin` | Tout | Nos fichiers ne sont pas chargeables par un autre site |
| `X-Robots-Tag` | `noindex, nofollow` | `/lien/:chemin*` | Un document client n'est jamais indexé |
| `X-Powered-By` | Retiré (`poweredByHeader: false`) | Tout | Ne pas annoncer l'outil |

**Piège : `Referrer-Policy: no-referrer` casserait les actions serveur.** D'après la norme Fetch, une requête `POST` envoyée sous la politique `no-referrer` porte `Origin: null`, même vers la même origine. La chaîne refuse `Origin: null` (`chaine-controles.md`, section 3.3) : toutes les actions seraient refusées. `same-origin` envoie l'origine vers la même origine et rien ailleurs. La 4.5, dont la page par lien enverra une réponse, garde cette valeur. À confirmer par un test dès la première action exposée (1.1). À inscrire dans les « Pièges connus » de `CLAUDE.md` avec la PR 2.

**`Cache-Control`.** Next.js envoie `private, no-cache, no-store, max-age=0, must-revalidate` sur une page dynamique (constaté, section 0, point 5). Vérifié en bout en bout sur les trois zones, sans le reposer.

**Vérification sur le site construit** (décision 14). Les en-têtes de développement diffèrent (section 5.3). Les tests de bout en bout tournent donc sur le site construit, en CI comme en local : la commande du serveur de Playwright devient `npm run start` dans les deux cas, après `npm run build` (inscrit dans `CLAUDE.md`, « Commandes », à la validation ; `playwright.config.ts` modifié en PR 2). En local, le port 3000 est vérifié libre avant (`CLAUDE.md`, « Pièges connus »).

### 7. Règles ESLint

Nouvelles règles, à la suite des règles A à N. Leurs cas vivent dans un nouveau fichier, `src/regles-interface.test.ts`, pour ne pas modifier `src/server/db/regles-import.test.ts`, dont l'aide `refus` ne retient que `no-restricted-imports` et `no-restricted-syntax`. Écriture par script Python pour les expressions régulières d'esquery (`CLAUDE.md`, « Pièges connus », échappement).

- **O. Points d'injection de HTML et de script, dans `src/`.** Refusés : l'attribut `dangerouslySetInnerHTML` (règle `react/no-danger`, chargée par `eslint-config-next`) et toute propriété de ce nom dans un objet (décomposition, `createElement`) ; l'affectation de `innerHTML` et `outerHTML` ; `insertAdjacentHTML`, `document.write`, `document.writeln` ; l'attribut `srcDoc` ; l'élément JSX `<script>` ; l'import de `next/script` ; les URL `javascript:` (`react/jsx-no-script-url`) ; `eval`, `new Function` et `setTimeout` ou `setInterval` avec une chaîne (`no-eval`, `no-new-func`, `no-implied-eval`).
- **P. Attribut `style` interdit dans `src/`** (section 5.3). Un composant shadcn qui en porte un sera signalé dès son ajout.
- **Q. Accessibilité.** Les 31 règles en erreur du jeu recommandé d'`eslint-plugin-jsx-a11y` 6.10.2, activées par leur nom avec les options du jeu recommandé, sans importer le module (constaté possible, section 0, point 1). Les trois règles que le jeu désactive restent désactivées. Portée : les `.tsx` de `src/`.
- **R. Textes dans `src/textes/` (NF-01, décision 10).** Dans `src/app/` et `src/components/` hors `ui/` : `react/jsx-no-literals` refuse toute chaîne écrite en dur entre les balises JSX, sauf une liste fermée de signes (`:`, `·`) ; et une chaîne écrite en dur dans les attributs qui portent un texte lu (`alt`, `title`, `placeholder`, `aria-label`, `aria-description`) est refusée par sélecteur. Les autres attributs (`className`, `href`, `variant`) restent permis. **Si la liste des cas permis s'allonge au-delà de ces signes, le travail s'arrête et la question revient au développeur** (décision 10). Les composants de `src/components/ui/`, générés par shadcn, sont hors de la règle : ils ne portent pas de texte affiché.

- **S. `src/proxy.ts` n'importe pas `server/env.ts`** (PR 2, décision 18). Refusés dans `src/proxy.ts` : l'import de `@/server/env`, par chemin relatif (`./server/env`, `./server/env.ts`), par chargement dynamique et par réexportation. Permis : `next/server`, `@/lib/securite/entetes`. `server/env.ts` reste importable ailleurs dans `src/server/`. **Piège** : un second bloc qui règle `no-restricted-imports` (ou `no-restricted-syntax`) pour `src/proxy.ts` remplace le premier au lieu de s'y ajouter. La règle S, comme l'exception de la règle B, reprend donc les interdictions des règles A à O déjà en vigueur sur ce fichier ; un test prouve qu'elles tiennent toujours (`drizzle-orm`, `pg`, `process`, `db`, outillage de test, `requetes/journal`, `executerDansOrganisation`, `journaliser`, `executerChaine`, `creerChaine`, `compteurDebit`, `db/debit`, `next/script`, chargements dynamiques compris).

Conséquence en PR 1 : `src/app/page.tsx` (« Facturation PME » écrit en dur) et les métadonnées de `src/app/layout.tsx` lisent leurs textes dans `src/textes/commun.ts`.

Le test d'inventaire est étendu en PR 2 et 3 : `src/proxy.ts` est le seul fichier de proxy (aucun `middleware.ts`, aucun autre `proxy.*`) ; chaque `page.tsx` de `(app)/` appelle `lirePourPage` (section 2.3).

### 8. Composants shadcn/ui

| Besoin | Composant | Avis |
|---|---|---|
| Action des pages « introuvable » et « erreur » | `button`, déjà présent | `buttonVariants` appliqué à un `Link` de Next.js pour un lien stylé en bouton |
| Menu sous 768 px | Aucun : `<details>` natif | Pas de script, pas de style en ligne, accessible au clavier. Retenu |
| Séparateurs | Aucun : bordure `border-border` | Signal sépare par des traits |

Aucun composant nouveau en 0.6. Si un composant est ajouté plus tard : `npx shadcn add <nom>` par son nom (règle 10), puis `git diff package.json package-lock.json` doit être vide ; sinon, arrêt, et proposition de la dépendance avec son nom exact, sa raison et une alternative.

### 9. Limiter le débit des lectures de pages (décision 5 de la 0.5)

Retenu : aucune limite en 0.6 ; à trancher par la 3.1, première page qui lit des données métier (liste des clients). Aucune page de données n'existe, et une limite écrirait en base à chaque affichage.

Ce que la 3.1 aura à peser : une étape 4 dans `etablirContexte` coûterait une écriture par lecture, deux par affichage (le gabarit et la page appellent chacun `etablirContexte`), donc un dédoublonnage par requête ; un membre a le droit de lire ce que sa matrice lui ouvre ; le risque est l'aspiration rapide du fichier client avant un départ (T-33, T-31), que la pagination (S-84) ralentit déjà. Le pare-feu de Vercel reste une protection d'hébergeur en plus (RR-5).

### 10. Disposition (décision 13, d'après la maquette)

**Zone application, 768 px et plus :**

- **Barre latérale gauche** de 240 px, fond `surface` (blanc), bordure droite `ligne`. De haut en bas :
  - « Facturation PME », en `display`, graisse 600.
  - Le bloc « Organisation active » (libellé en `libelle`) et le nom de l'organisation. **Absent en 0.6** : le nom se lit dans `organization`, table sans règle d'isolation, avec le filtre explicite exigé par RR-8 ; il arrive avec la 2.1 (changement d'organisation).
  - La navigation, dans l'ordre de la section 2.4. Entrée active : fond `accent-clair` (`bg-accent`), texte `accent` (`text-primary`), et `aria-current="page"`. En 0.6 : « Tableau de bord » seul.
  - En bas : le nom de l'utilisateur et son rôle. **En 0.6, le rôle seul** (« Propriétaire », « Comptable », « Commercial », « Lecteur », lu dans le contexte). Le nom demande une lecture de `user` : 1.2, avec la déconnexion.
- **Contenu à droite**, fond `fond`. En tête de page : titre (`titre-1`) à gauche, actions à droite. Marges `espace-12`.
- **Bandeau de simulation**, `attention` sur `attention-fond`, permanent en haut du contenu : la production utilise le simulateur de certification (`DESIGN.md`, section 4.4). Texte : voir « Écart à trancher » ci-dessous.

**Sous 768 px :** la barre passe au-dessus du contenu, sur toute la largeur. La navigation s'y replie dans un `<details>` natif (« Menu »), cible de 44 px. Marges `espace-4`.

**Pages « introuvable » et « erreur » :** mise en page sobre (sections 3 et 4).

**Zones publique et par lien :** non couvertes par la maquette décrite. Publique : en-tête au nom du produit, contenu, pied de page, marges comme ci-dessus. Par lien : contenu seul ; en-tête au nom de l'organisation émettrice avec la 4.5.

**Texte du bandeau de simulation** (décision 15). Deux textes, deux emplacements, tous deux dans le tableau « Ce que la sécurité impose à l'écran » de `DESIGN-SYSTEM.md` :

- sur un document (page, PDF), ligne « Document produit en mode simulateur » : « Simulation : document non certifié par la DGI, sans valeur fiscale. » (`TEXTES_SIMULATION.bandeau`, utilisé à partir des jalons 4 et 5) ;
- en haut du contenu de chaque page de l'application, ligne « Application en mode simulateur » : « Simulation : les documents ne sont pas certifiés par la DGI et n'ont pas de valeur fiscale. » (`TEXTES_SIMULATION.bandeauApplication`, utilisé par le gabarit en PR 3).

### 11. Les textes et le formatage

#### 11.1 Les textes (NF-01)

`src/textes/`, un fichier par domaine, objets `as const`, sans import du projet (`STRUCTURE.md`, section 7) :

- `commun.ts` : nom du produit, description (métadonnées), lien d'évitement « Aller au contenu », « Menu », « Revenir à l'accueil ».
- `navigation.ts` : nom accessible de la navigation, libellé « Organisation active », libellés des entrées (en 0.6, « Tableau de bord » seul), libellés des quatre rôles.
- `erreurs.ts` : « Cette page est introuvable », « Une erreur est survenue. », « Identifiant de l'incident : », « Recharger la page ».
- `resultats.ts` : libellés des codes de `Resultat`, pour les formulaires du jalon 1.
- `simulation.ts` : les deux bandeaux de simulation, sur un document et dans l'application (section 10).

| Code | Libellé |
|---|---|
| `refuse` | « Cette action n'est pas disponible. » (décision 4, ajouté au tableau de `DESIGN-SYSTEM.md`). Le refus d'une page reste « Cette page est introuvable » |
| `connexion_requise` | « Votre session a expiré. Connectez-vous à nouveau. » |
| `invalide` | « Certains champs sont à corriger. » (les messages par champ viennent des schémas de chaque fonctionnalité) |
| `erreur` | « Une erreur est survenue. » suivi de l'identifiant |
| `trop_de_requetes` | « Trop de tentatives. Patientez un instant, puis réessayez. » (ni délai ni compte, décision 2 de la 0.5) |

Un test vérifie : les messages de sécurité sont identiques, au caractère près, à ceux du tableau « Ce que la sécurité impose à l'écran » de `DESIGN-SYSTEM.md` (le test lit le fichier, comme le test de la matrice lit `THREATS.md`) ; aucun texte ne contient `!`, un emoji, ni « OK » ou « Valider » seuls, ni d'espace en tête, en fin ou doublée ; les clés de `resultats.ts` sont exactement les raisons de `Resultat` (vérifié par le type et à l'exécution) ; les clés des libellés de rôle sont exactement `ROLES`.

#### 11.2 Les montants (NF-02, R-01)

`src/lib/format/montants.ts`, fonctions pures, sans `Intl` :

- `formaterMontant(1180000)` → `1 180 000 F CFA` ; `formaterMontantColonne(1180000)` → `1 180 000`, sans l'unité, rappelée dans l'en-tête de colonne.
- Séparateur de milliers, espace avant « F » et entre « F » et « CFA » : **espace insécable U+00A0**. Ni l'espace fine U+202F que produit `Intl` en `fr-FR` (sa présence dans DM Mono n'est pas vérifiée ; une police de secours décalerait les chiffres d'une colonne), ni une espace ordinaire (un retour à la ligne couperait un montant).
- Pas de décimales. Un argument qui n'est pas un entier sûr (`Number.isSafeInteger`) lève une `RangeError` : un montant à virgule est une erreur de programmation (R-01), pas une valeur à arrondir.
- **Un montant négatif lève une `RangeError`** (décision 5). À reprendre à la 5.5 (avoirs).
- Fonction écrite à la main plutôt qu'`Intl.NumberFormat` : même résultat au caractère près sur le serveur et dans tout navigateur, quelle que soit la version des données de langue (pas d'écart à l'hydratation).
- Taux (`18 %`) : reporté à la 4.1, qui fixe leur stockage.

#### 11.3 Les dates (NF-02)

`src/lib/format/dates.ts` :

- `formaterDate(instant: Date)` → `05/10/2026`, par `Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "2-digit", month: "2-digit", year: "numeric" })`. Une date invalide lève une `RangeError`.
- `formaterJour("2026-10-05")` → `05/10/2026`, pour une date de calendrier (colonne `date` : échéance, date de paiement), par découpage de la chaîne, sans conversion en instant ni fuseau. Une chaîne qui n'est pas `AAAA-MM-JJ`, ou une date qui n'existe pas au calendrier, lève une `RangeError`.
- **Fuseau fixé, `Africa/Abidjan`** (UTC+0 toute l'année, sans heure d'été) : le serveur (Vercel, Francfort), la CI et le navigateur d'un membre en déplacement donnent le même jour.
- Le test simule un poste à UTC+14 (`vi.stubEnv("TZ", "Pacific/Kiritimati")`) : Node applique un changement de `TZ` en cours d'exécution (constaté le 2026-10-11 : le fuseau par défaut d'`Intl` suit). Sans cela, le test ne distinguerait rien en CI, dont le fuseau (UTC) donne déjà le même jour qu'Abidjan. `vi.stubEnv` n'est pas une lecture de configuration : la règle 12 vise la lecture des variables, et la règle B ne le refuse pas.
- Heure (sessions, journal) : reportée à la 1.5, première à en afficher.

### 12. Accessibilité, et affichage à 390 et 1280 pixels (NF-03, NF-04)

- Playwright reçoit deux projets, `mobile-390` (390 × 844) et `ordinateur-1280` (1280 × 800). Les tests des gabarits et des pages d'erreur passent dans les deux.
- Vérifié automatiquement : aucun défilement horizontal de la page à 390 px, et à 360 px (`document.documentElement.scrollWidth <= innerWidth`) ; cibles tactiles d'au moins 44 px pour les liens de navigation et les actions ; lien d'évitement atteint en premier au clavier ; anneau de focus de 2 px en `accent`, décalé de 2 px ; un seul `h1` par page ; `lang="fr"` ; libellé de lien actif annoncé (`aria-current`) ; à 1280 px, barre latérale de 240 px ; sous 768 px, barre au-dessus du contenu.
- Captures à 390 et 1280 px de chaque page livrée, jointes à la PR (consigne du skill `interface`), comparées à la description de la section 10. Pas de comparaison automatique de captures : le rendu des polices diffère entre Windows et la CI sous Linux.
- Pas d'`@axe-core/playwright` en 0.6 (décision 7), à revoir en 1.1 avec les premiers formulaires. Les contrastes reposent sur les jetons de Signal, conformes AA d'après `DESIGN-SYSTEM.md`, et la règle Q vérifie le balisage.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Contrôle de session dans `(app)/layout.tsx` seul | Ne protège pas les pages (section 2.3) |
| Contrôle de session dans `proxy.ts` | Le proxy ne connaît ni le droit de la page ni l'adhésion ; un sélecteur mal écrit retire la protection en silence (avertissement de `proxy.md`). Le proxy ne pose que des en-têtes |
| Politique de sécurité du contenu avec `'unsafe-inline'`, en-tête fixe | Pas stricte (S-80) |
| `experimental.sri`, `global-not-found`, `authInterrupts` | Expérimentaux |
| Proxy qui importe `env.ts` pour le mode développement (M1) | Une variable invalide ferait échouer chaque requête par une page brute de Next.js ; l'import de `server-only` dans un proxy n'est pas vérifié |
| Bibliothèque d'en-têtes de sécurité | Dépendance nouvelle (règle 10) pour une liste de neuf valeurs |
| `Intl.NumberFormat` pour les montants | Séparateur différent selon les données de langue, risque d'écart entre serveur et navigateur |
| Tests de composants en navigateur simulé | Écartés par `STACK.md` ; un rendu en chaîne par `react-dom/server` suffit pour les pages d'erreur |
| `Referrer-Policy: no-referrer` | Rendrait `Origin: null` sur les actions (section 6) |
| Composant `sheet` pour le menu mobile | Dialogue de Base UI à styles en ligne, contraire à la règle P ; `<details>` suffit |

## Règles de sécurité et permissions

- Exigences couvertes :
  - **S-80** : politique de sécurité du contenu stricte par nonce (section 5) ; `frame-ancestors 'none'` et `X-Frame-Options` ; HSTS ; `Referrer-Policy: same-origin`.
  - **S-85** : pages d'erreur génériques avec identifiant d'incident ; consignation sans message (section 4).
  - **S-02** (affichage) : une seule page « introuvable » pour l'absent, le refusé et le non connecté ; un seul message de refus pour une action.
  - **S-51** (en partie) : échappement par React, règle O contre les points d'injection. Le test « un nom contenant du code s'affiche comme du texte » est écrit à la 3.1 (`PLAN.md`, section 4.5).
  - **S-54** (en partie) : `onRequestError` ne consigne ni message, ni chemin réel, ni paramètre.
  - **S-20** : le jeton d'un lien public n'apparaît pas au journal technique (`routePath`, section 4.2).
- Menaces concernées :
  - **T-34** : seconde ligne de défense (politique) prouvée ici par injection dans le DOM ; première ligne (échappement) prouvée à la 3.1.
  - **T-35** : erreur provoquée sur le site construit, sans détail dans la page (section 4.3).
  - **T-37** : `Referrer-Policy: same-origin`.
  - **T-30, S-02** : réponse identique pour une page de l'application sans session et une adresse inexistante.
- Matrice des droits : aucun droit nouveau. Lue par la navigation (`peut`) et par le gabarit (`organisation.membres.voir`, décision 3).
- Tables créées ou modifiées : aucune.

## Limites connues

- Masquer une entrée de navigation ne protège rien (section 2.4). La protection de chaque page est le contrôle de sa propre lecture.
- Le contrôle « chaque page appelle `lirePourPage` » est textuel : une page qui l'appelle sans en utiliser le résultat passe.
- La politique laisse passer ce que liste la section 5.4.
- **Ce que les règles O à R laissent passer**, constaté le 2026-10-11 par l'API d'ESLint sur du code fourni en texte. La revue reste nécessaire :
  - **O** : une clé calculée (`{ ["dangerously" + "SetInnerHTML"]: ... }`) ; `Object.assign(el, { innerHTML })` ; `window.document.write` et `document["write"]` (seul `document.write` est visé) ; `setAttribute("srcdoc", ...)` ; `createContextualFragment`, `DOMParser` et les autres analyseurs de HTML du navigateur ; une URL `javascript:` venue d'une variable (`<a href={x}>`), la règle de React ne voyant que les chaînes écrites ; `setTimeout(x)` avec une variable chaîne. Hors de `src/` (`scripts/`, fichiers de configuration), aucune règle ne s'applique. La politique de sécurité du contenu (PR 2) reste la seconde ligne contre ce qui s'exécuterait.
  - **P** : un attribut `style` passé par décomposition (`<div {...p} />`) ou par `createElement` ; l'élément `<style>`, que la politique bloque de toute façon faute de nonce ; un style posé par JavaScript (`element.style`), que la politique ne bloque pas.
  - **Q** : l'analyse ne voit que le JSX écrit. Un composant (`<Button />` sans nom accessible) n'est pas reconnu comme l'élément natif qu'il rend ; contrastes, ordre du focus et rôles posés à l'exécution ne sont pas vérifiés (décision 7 : `@axe-core/playwright` revu en 1.1).
  - **R** : une chaîne passée par une constante (`const t = "Bonjour"`) ; une chaîne dans un ternaire (`{a ? "Oui" : "Non"}`) ; un texte dans un attribut hors de la liste (`aria-roledescription`) ou dans la propriété d'un composant (`<B libelle="Bonjour" />`, `ignoreProps`). Une concaténation (`{"Total " + a}`) est, elle, refusée.
- **S** : un import indirect (`src/proxy.ts` importe un module qui importe `server/env.ts`) n'est pas vu ; la revue reste nécessaire.
- Erreur d'un composant client : aucun identifiant, aucune consignation avant la 8.1 (décision 6).
- La navigation par rôle n'est éprouvée dans un navigateur qu'à la 1.2.
- Le gabarit et la page appellent chacun `etablirContexte` : deux lectures de session et d'adhésion par affichage. Dédoublonnage par requête (`cache` de React) à étudier quand une page lira des données.

## Dépendances nouvelles

Aucune (règle 10). `react-dom/server`, `next/server` (`connection`), `next/navigation` (`notFound`), `next/font`, `lucide-react`, `@base-ui/react` et les règles `react/*` et `jsx-a11y/*` d'`eslint-config-next` sont déjà présents. `@axe-core/playwright` : non (décision 7).

## Migration

Aucune.

## Critères d'acceptation

### PR 1

- [x] `formaterMontant`, `formaterMontantColonne`, `formaterJour` et `formaterDate` donnent les formats de `DESIGN-SYSTEM.md`, avec U+00A0 ; refusent un montant non entier, non sûr ou négatif, et une date mal formée ou inexistante ; `formaterDate` donne le même jour sur un poste à UTC+14.
- [x] Les messages de sécurité de `src/textes/` sont identiques au tableau de `DESIGN-SYSTEM.md` ; aucun texte ne contient `!`, un emoji, « OK » ou « Valider » seuls ; les clés des résultats et des rôles sont exactes.
- [x] Les règles O, P, Q et R refusent leurs cas et acceptent les cas permis (`src/regles-interface.test.ts`) ; les 31 règles `jsx-a11y` du jeu recommandé sont en erreur pour un `.tsx` de `src/`.
- [x] `npm run lint` passe sur tout `src/` avec les nouvelles règles ; l'accueil et les métadonnées lisent `src/textes/`.
- [x] Sur le poste, le 2026-10-11 : `npm run lint`, `npm run typecheck`, `npm test` (881 tests), `npm run build` et `npm run test:e2e` (7 tests, sur `npm run dev` puis sur le site construit avec `CI=1`) passent. Aucune dépendance ajoutée. En CI : à constater sur la PR.

### PR 2

- [ ] Toute réponse HTML, sur l'accueil, la page « introuvable » et la page « erreur », porte la politique de la section 5.3, avec un nonce de 16 octets, différent à chaque requête.
- [ ] La politique de production ne contient aucun mot-clé `unsafe-`.
- [ ] Un script injecté dans le DOM sans nonce, un gestionnaire `onerror` en ligne, une URL `javascript:` et un script d'une autre origine ne s'exécutent pas ; un événement `securitypolicyviolation` est observé pour chacun.
- [ ] La page ne s'affiche pas dans un cadre d'une autre origine.
- [ ] Une requête portant un en-tête `Content-Security-Policy` ou `next-router-prefetch` forgé reçoit la politique du serveur, avec un nonce qui n'est pas celui fourni.
- [ ] Les en-têtes de la section 6 sont présents avec leurs valeurs exactes, y compris sur un fichier de `/_next/static` et sur une 404 ; `X-Powered-By` est absent ; `X-Robots-Tag` est présent sous `/lien/`.
- [ ] Aucune requête vers `fonts.googleapis.com` ni `fonts.gstatic.com`.
- [ ] `error.tsx` et `global-error.tsx`, rendus avec une erreur chargée de marqueurs, n'en affichent aucun.
- [ ] `consignerErreurRequete` ne consigne que `digest`, `classe`, `code`, `routePath`, `routeType`.
- [ ] La règle B accepte `process.env.NODE_ENV` dans `src/proxy.ts` seulement ; toute autre variable y est refusée ; `NODE_ENV` reste refusé ailleurs.
- [ ] La règle S refuse tout import de `server/env.ts` dans `src/proxy.ts` ; les interdictions des règles A à O y tiennent toujours.
- [ ] Un seul fichier de proxy existe (inventaire).

### PR 3

- [ ] Une adresse inexistante, `/tableau-de-bord` sans cookie et `/tableau-de-bord` avec un cookie de session forgé donnent le même statut (404) et le même texte visible, « Cette page est introuvable ».
- [ ] Les trois zones portent la politique et les en-têtes ; aucune violation sur aucune page, à 390 et 1280 px.
- [ ] `traduireLecture` : `ok` renvoie les données ; `refuse` et `connexion_requise` appellent `notFound()` ; `erreur` lève une `ErreurPage` au `digest` égal à l'incident, sans message variable ni cause.
- [ ] Chaque `page.tsx` de `(app)/` appelle `lirePourPage` (inventaire).
- [ ] `entreesVisibles` suit `peut` pour chaque rôle et chaque entrée de la liste de test ; un rôle inconnu ne voit que les entrées sans droit ; la liste livrée ne contient que « Tableau de bord ».
- [ ] Avec une vraie session de chacun des quatre rôles, la lecture du gabarit renvoie les entrées et le rôle attendus ; un membre dont l'organisation active n'est pas la sienne reçoit `refuse`.
- [ ] Disposition de la section 10 à 1280 px et sous 768 px ; bandeau de simulation présent.
- [ ] À 360, 390 et 1280 px : aucun défilement horizontal ; cibles de 44 px ; lien d'évitement ; focus visible. Captures jointes à la PR.
- [ ] Sur le second serveur (configuration valide, base injoignable), `/tableau-de-bord` affiche « Une erreur est survenue. » et un identifiant, sans aucun des marqueurs de la section 4.3, ni dans le HTML ni dans la charge utile RSC.

### Toutes

- [ ] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` et `npm run test:e2e` passent, sur le poste et en CI.

## Tests à écrire

### Tests unitaires

PR 1 :

- [x] `src/lib/format/montants.test.ts` : 0, 1, 999, 1 000, 1 180 000, un milliard, `Number.MAX_SAFE_INTEGER`, `-0` ; U+00A0 exact, ni U+202F ni espace ordinaire ; `1.5`, `NaN`, `Infinity`, `-Infinity`, `2 ** 53`, `-1` refusés par `RangeError`.
- [x] `src/lib/format/dates.test.ts` : instants autour de minuit, sur un poste simulé à UTC+14 ; date invalide refusée ; `formaterJour` sur des jours valides (dont le 29 février d'une année bissextile) et refus des chaînes mal formées et des jours inexistants.
- [x] `src/textes/textes.test.ts` : messages de sécurité contre `DESIGN-SYSTEM.md` ; style ; clés des résultats et des rôles.
- [x] `src/regles-interface.test.ts` : règles O, P, Q, R.

PR 2 :

- [ ] `src/lib/securite/entetes.test.ts` : politique de production, directive par directive ; nonce inséré dans `script-src` et `style-src` ; politique de développement ; aucun `unsafe-` en production ; liste `ENTETES_SECURITE` exacte.
- [ ] `src/lib/securite/entetes.attaque.test.ts` : un nonce contenant `'`, `;` ou un espace est refusé par `politiqueSecurite`.
- [ ] `src/proxy.test.ts` : sélecteur, par `unstable_doesMiddlewareMatch` (`next/experimental/testing/server`, fourni par `next` ; Next.js 16.3.8 n'exporte pas `unstable_doesProxyMatch`) ; nonce de 16 octets, différent à chaque appel ; politique posée sur la requête et la réponse ; un en-tête de politique reçu est remplacé.
- [ ] `src/server/erreurs/consigner.test.ts` : espion sur `console.error`, contenu inspecté par `util.inspect` : champs permis seuls ; erreur dont le message contient une adresse email et une URL PostgreSQL ; chemin réel `/lien/devis/<jeton>` absent.
- [ ] `src/app/erreurs.test.tsx` : rendu en chaîne de `error.tsx` et `global-error.tsx`, avec et sans `digest`, erreur chargée de marqueurs.
- [ ] `src/server/db/regles-import.test.ts` (complété, modification signalée) : exception de la règle B pour `NODE_ENV` dans `src/proxy.ts` ; règle S ; interdictions des règles A à O toujours en vigueur sur `src/proxy.ts`.
- [ ] `src/server/actions/inventaire.test.ts` (complété, modification signalée) : second fichier de proxy refusé.

PR 3 :

- [ ] `src/server/autorisation/navigation.test.ts` : `entreesVisibles` pour chaque rôle et chaque type de droit ; rôle inconnu ; `__proto__` ; liste livrée.
- [ ] `src/server/actions/exposer.test.ts` (complété, modification signalée) : `traduireLecture` pour chaque raison ; `ErreurPage` sans message variable ni cause.
- [ ] `src/server/actions/inventaire.test.ts` (complété) : page de `(app)/` sans `lirePourPage` refusée.

### Tests d'intégration

- [ ] PR 3, `src/server/db/gabarit.integration.test.ts` : lecture du gabarit par `etablirContexte`, avec une vraie session de chaque rôle (`creerMembre`) ; organisation active étrangère ; rôle inconnu ; sans cookie.

### Tests d'attaque

Les quatre tests obligatoires (`PLAN.md`, section 4.3), appliqués à ce que la 0.6 expose, c'est-à-dire la page vide du tableau de bord (PR 3) :

- [ ] Accès sans session : « introuvable », comme une adresse inexistante (`e2e/zones.attaque.spec.ts`).
- [ ] Accès aux données d'une autre organisation : organisation active étrangère, `refuse` (intégration). Aucune donnée n'est lue en 0.6.
- [ ] Rôle non autorisé : sans objet, la page est ouverte aux quatre rôles ; un rôle inconnu reçoit `refuse` (intégration).
- [ ] Entrée invalide ou falsifiée : cookie de session forgé (`e2e/zones.attaque.spec.ts`).

Propres à cette fiche, PR 2, `e2e/entetes.attaque.spec.ts` et `e2e/erreurs.attaque.spec.ts`, sur le site construit :

- [ ] Script sans nonce ajouté au DOM, gestionnaire `onerror` en ligne, `javascript:`, script d'une autre origine : non exécutés, violation observée.
- [ ] Affichage dans un cadre depuis une autre origine : bloqué.
- [ ] En-têtes `Content-Security-Policy`, `x-nonce` et `next-router-prefetch` forgés par le client : sans effet sur la politique reçue.
- [ ] Nonce différent sur deux requêtes successives de la même page (rendu dynamique).
- [ ] `/lien/devis/<jeton aléatoire>` : 404 « introuvable », `X-Robots-Tag`, `Referrer-Policy: same-origin`, aucun en-tête `Set-Cookie`.

Propres à cette fiche, PR 3, `e2e/erreurs.attaque.spec.ts`, second serveur (section 4.3, niveau 3). Retirés de la PR 2 (décision 17). En PR 3, le second serveur a une configuration **valide** (rôle `app_facturation`) et une base injoignable (port fermé sur `127.0.0.1`) ; la panne est observée sur `/tableau-de-bord` :

- [ ] « le proxy ne dépend pas d'env.ts : l'accueil répond, avec la politique »
- [ ] « la page affiche le texte fixe, un identifiant et les deux actions »
- [ ] « aucun détail dans le HTML »
- [ ] « aucun détail dans la charge utile RSC »
- [ ] « aucun détail dans la page affichée, après hydratation »

### Tests de bout en bout

- [ ] PR 2, `e2e/accueil.spec.ts` (modifié, signalé) : titre, langue, contenu de l'accueil ; les tests du thème Signal passent sur l'action de la page « introuvable ».
- [ ] PR 3, `e2e/affichage.spec.ts` : projets 390 et 1280, plus 360 pour le défilement : pages publique, introuvable, erreur, tableau de bord (sans session : introuvable).

## Fichiers concernés

PR 1 :

- Créés : `src/textes/commun.ts`, `navigation.ts`, `erreurs.ts`, `resultats.ts`, `simulation.ts`, `textes.test.ts` ; `src/lib/format/montants.ts`, `montants.test.ts`, `dates.ts`, `dates.test.ts` ; `src/regles-interface.test.ts`.
- Modifiés : `eslint.config.mjs` (règles O à R ; le bloc de syntaxe général est scindé en trois, écrans hors `ui/`, `ui/` et le reste, à cause de la règle R) ; `src/app/page.tsx` et `src/app/layout.tsx` (textes) ; `docs/DESIGN-SYSTEM.md` (ligne « Application en mode simulateur », décision 15) ; `src/textes/textes.test.ts` (test du bandeau de l'application, ajouté à la demande, vu en échec avant le texte).

PR 2 :

- Créés : `src/proxy.ts`, `src/proxy.test.ts` ; `src/lib/securite/entetes.ts`, `entetes.test.ts`, `entetes.attaque.test.ts` ; `src/app/not-found.tsx`, `error.tsx`, `global-error.tsx`, `erreurs.test.tsx` ; `src/components/erreurs/incident.tsx` ; `src/server/erreurs/consigner.ts`, `consigner.test.ts` ; `e2e/entetes.attaque.spec.ts`, `e2e/erreurs.attaque.spec.ts`.
- Modifiés : `src/app/layout.tsx` (`connection()`) ; `src/instrumentation.ts` (`onRequestError`) ; `next.config.ts` (`headers`, `poweredByHeader`) ; `eslint.config.mjs` (exception de la règle B) ; `src/server/db/regles-import.test.ts`, `src/server/actions/inventaire.test.ts` ; `vitest.config.mts` (inclusion des `.test.tsx`) ; `playwright.config.ts` (site construit en local) ; `e2e/accueil.spec.ts` ; `CLAUDE.md` (règle 12 et son exception ; pièges du rendu dynamique, de `cacheComponents` et de `Referrer-Policy` ; règle O).

PR 3 :

- Créés : `src/app/(public)/layout.tsx`, `(public)/page.tsx` (déplacé de `src/app/page.tsx`) ; `src/app/(app)/layout.tsx`, `(app)/tableau-de-bord/page.tsx` ; `src/app/lien/layout.tsx` ; `src/components/gabarits/` (barre latérale, navigation, bandeau, en-tête de page, lien d'évitement) ; `src/server/autorisation/navigation.ts`, `navigation.test.ts` ; `src/server/db/gabarit.integration.test.ts` ; `e2e/zones.attaque.spec.ts`, `e2e/affichage.spec.ts`.
- Modifiés : `src/server/actions/exposer.ts` (`lirePourPage`, `traduireLecture`, `ErreurPage`), `exposer.test.ts` ; `src/server/actions/inventaire.test.ts` ; `playwright.config.ts` (projets 390 et 1280 ; second serveur, configuration valide et base injoignable) ; `e2e/erreurs.attaque.spec.ts` (tests du second serveur) ; `CLAUDE.md` (règle : chaque page de `(app)/` passe par `lirePourPage`) ; `docs/STRUCTURE.md` (sections 2 et 4) ; `docs/features/chaine-controles.md` et `docs/features/limitation-debit.md` (« Reporté » à la 0.6, soldé).

Faits à la validation : `docs/DESIGN-SYSTEM.md` (ligne « Action refusée dans un formulaire »), `docs/PLAN.md` (taille L, estimations), `CLAUDE.md` (« Commandes » : tests de bout en bout sur le site construit), `docs/STRUCTURE.md` (section 7 : `server/autorisation/navigation.ts`).

Inchangés : `drizzle/`, `scripts/`, `.github/workflows/` (la CI construit déjà le site avant Playwright), `package.json`, `src/server/env.ts`, `src/server/env-schema.ts`.

## Reporté

### Au jalon 1

- 1.1 : confirmer par un test, sur la première action exposée, que `Referrer-Policy: same-origin` laisse passer `Origin` (section 6) ; revoir `@axe-core/playwright` (décision 7).
- 1.2 : `connexion_requise` devient une redirection vers `/connexion`, avec une adresse de retour limitée à un chemin relatif ; nom de l'utilisateur et déconnexion dans la barre latérale ; parcours connecté dans un navigateur, dont la navigation par rôle ; erreur « base injoignable » avec une session valide (section 4.3).
- 1.5 : format de l'heure.

### Au jalon 2

- 2.1 : bloc « Organisation active » avec le nom de l'organisation, et changement d'organisation (lecture de `organization` filtrée, RR-8).
- 2.2 : entrée « Organisation » de la navigation.

### Aux jalons 3 à 6

- 3.1 : limite de débit des lectures de pages (section 9) ; test T-34 de l'échappement ; entrée « Clients ».
- 3.3, 4.2, 5.1, 6.1, 6.3 : entrées « Catalogue », « Devis », « Factures », « Paiements », « Relances ».
- 4.1 : format des taux.
- 4.5 : `lien/not-found.tsx` (« Ce lien n'est plus valable »), en-tête au nom de l'organisation émettrice.
- 5.5 : montants négatifs (décision 5).

### Au jalon 8

- 8.1 : `onRequestError` et le journal technique passent au service de suivi des erreurs ; consignation et identifiant des erreurs client (décision 6) ; `report-to` de la politique.
- 8.4 : Trusted Types (décision 8).

## Décisions

Prises à la validation de la fiche, le 2026-10-11.

1. **Visiteur non connecté.** V1 : la page « introuvable », 404, identique à celle d'une adresse inexistante.
2. **Zone application.** Z1, avec la page vide `tableau-de-bord` comme cible. Parcours connecté en 1.2.
3. **Droit lu par le gabarit.** `organisation.membres.voir`, avec un commentaire.
4. **Refus dans un formulaire.** « Cette action n'est pas disponible. », ajouté au tableau de `DESIGN-SYSTEM.md`.
5. **Montants négatifs.** Refusés par `formaterMontant`. À reprendre à la 5.5.
6. **Erreur d'un composant client.** Sans identifiant, jusqu'à la 8.1.
7. **`@axe-core/playwright`.** Pas en 0.6. À revoir en 1.1.
8. **Trusted Types.** Reporté à la 8.4.
9. **Barre d'outils de Vercel.** Désactivée dans les réglages par le développeur ; la politique n'est pas ouverte à `vercel.live`.
10. **Règle R.** Retenue. Si ses cas permis deviennent trop nombreux, le travail s'arrête.
11. **Mode développement du proxy.** M2 : `process.env.NODE_ENV` dans `src/proxy.ts` uniquement. Un test de règle prouve que toute autre variable y est refusée, et que `NODE_ENV` reste refusé ailleurs.
12. **Découpage.** Trois PR, taille L dans `PLAN.md`. Après chacune, `main` cohérent et CI verte.
13. **Disposition.** Celle de la section 10, d'après la maquette. Les entrées dont la page n'existe pas ne sont pas affichées : en 0.6, « Tableau de bord » seul. Pages d'erreur : mise en page sobre.
14. **Tests de bout en bout sur le site construit**, `npm run build` avant ; inscrit dans `CLAUDE.md`.

Prises pendant la PR 1, le 2026-10-11 :

15. **Bandeau de simulation.** Deux textes, deux emplacements (section 10) : sur un document, le texte inchangé de `DESIGN-SYSTEM.md` ; en haut de l'application, « Simulation : les documents ne sont pas certifiés par la DGI et n'ont pas de valeur fiscale. », ajouté à `DESIGN-SYSTEM.md`.
16. **Choix de la phase rouge validés** : cas des règles O à R dans un fichier nouveau ; messages des sélecteurs citant leur lettre ; `vi.stubEnv("TZ", ...)` pour simuler un poste hors UTC.

Prises pendant la PR 2, le 2026-10-12 :

17. **Second serveur.** Reporté à la PR 3, avec une configuration valide et une base injoignable (section 4.3). `register` n'attrape jamais l'erreur de configuration : `src/instrumentation.ts` n'est pas modifié pour les tests.
18. **Règle S.** Retenue (section 7), écrite à l'implémentation de la PR 2.
19. **Corrections.** `unstable_doesMiddlewareMatch` au lieu d'`unstable_doesProxyMatch` ; `vitest.config.mts`.
