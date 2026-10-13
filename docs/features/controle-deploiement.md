# Fonctionnalité : contrôle après déploiement

Statut : en cours. Fiche rédigée et décisions prises le 2026-10-13, selon les recommandations de l'assistant, au rythme fixé par le développeur (décision 1). Tests et implémentation commités en local, non poussés. Écart S-02 de la 0.6 corrigé dans la même branche (section 5, décision 5), puis portée de S-02 précisée par le relecteur après le premier passage en production (décision 10).

Jalon 0, fonctionnalité 0.8 de `docs/PLAN.md`. Taille S. Menaces : T-53, T-74 ; S-02, S-80, S-85 vérifiés en production.

## Contexte

Cette fonctionnalité sert au développeur. La CI prouve le code sur une base de test et sur le site construit en local ; rien ne prouve ce que sert réellement la production après un déploiement de Vercel : variables de Vercel (qui ne s'appliquent qu'au déploiement suivant, `envoi-emails.md`, section 9), réglages du projet, en-têtes réellement reçus derrière le réseau de Vercel.

État au départ, constaté le 2026-10-13 :

- Production : `https://facturation-pme.vercel.app` (`docs/CONFIGURATION.md`). Vercel déploie `main` et publie le résultat de chaque déploiement à GitHub (événement `deployment_status`).
- `src/instrumentation.ts` charge `src/server/env.ts` dans `register` : une configuration refusée fait échouer **chaque** requête, `/` comprise (statut 500, `CLAUDE.md`, « Pièges connus »). `env-schema.ts` refuse une `DATABASE_URL` dont le rôle n'est pas `app_facturation`.
- Les en-têtes et la page « introuvable » sont vérifiés en local par Playwright sur le site construit (`socle-interface.md`, sections 3, 5 et 6).
- Deux points ont été reportés à la 0.8 par d'autres fiches, qui demandent une lecture de la base de production : les droits du rôle sur `journal_audit` (`journal-audit.md`, « Reporté ») et la lecture de `temoin_isolation` sans organisation active (`acces-donnees.md`).

Cas d'utilisation concernés : aucun.

## Problème

- Un déploiement peut servir une configuration différente de celle de la CI (variable manquante, réglage de Vercel, en-tête retiré ou ajouté par la plateforme) sans que personne ne le voie.
- Une page d'erreur qui afficherait une pile, un chemin de fichier ou un nom de variable ne serait découverte que par un visiteur.

## Solution retenue

Exigences couvertes : S-02, S-80, S-85 (vérification en production), NF-06 (contrôle automatique). Menaces : T-53 et T-74 en partie (section 4).

### 1. Le script : `scripts/controle-deploiement.mjs`

Un module Node.js sans dépendance (`fetch` de Node 24), qui exporte `controlerSite(adresse)` et s'exécute en ligne de commande :

```
node scripts/controle-deploiement.mjs https://facturation-pme.vercel.app [--essais 3] [--pause 20] [--detail]
```

- **Uniquement des requêtes `GET`**, sans cookie (sauf un cookie de session forgé, tiré au hasard, sur une requête de `/tableau-de-bord`, sous les noms `better-auth.session_token` et `__Secure-better-auth.session_token`), sans en-tête d'authentification, sans corps, `redirect: "manual"` (une redirection n'est jamais suivie : elle échoue au contrôle du statut), délai de 15 s par requête.
- **Adresse acceptée** : une origine seule (`https://hôte`, sans chemin, paramètre, fragment ni identifiants). `http:` n'est accepté que pour `localhost` et `127.0.0.1` (tests). Toute autre adresse est refusée avant la première requête (code de sortie 2).
- **Sept requêtes** : `/` deux fois, `/tableau-de-bord` sans cookie puis avec le cookie forgé, une adresse inexistante (`/adresse-inexistante-<8 octets en hexadécimal>`) et deux `/lien/devis/<32 octets en base64url>`, tirées au hasard à chaque passage.
- **Sortie** : une ligne par contrôle (`ok` ou `ÉCHEC`, nom, détail sans valeur reçue sauf le statut), puis le bilan. Code 0 si tout passe, 1 sinon. `--detail` ajoute, sous chaque contrôle `identique` seulement, les deux statuts, la longueur des deux documents servis, la position du premier caractère différent et 120 caractères autour dans chacun : ni en-tête ni cookie. `--essais` relance l'ensemble après `--pause` secondes tant qu'un contrôle échoue (décision 6).
- Aucun secret, aucune variable d'environnement lue, aucune écriture.

### 2. Ce qui est vérifié

Chaque contrôle porte un nom stable `<page>:<contrôle>` (pages `accueil`, `tableau-de-bord`, `inexistante`, `lien`), que les tests citent.

| Contrôle | Pages | Attendu |
|---|---|---|
| `statut` | toutes | `accueil` : 200. `tableau-de-bord`, `inexistante` et `lien` : 404. Une redirection, un 401 (protection de Vercel) ou un 500 échouent |
| `politique` | toutes | `Content-Security-Policy` égale, directive par directive, à la politique de production (`socle-interface.md`, section 5.3) ; un seul nonce, le même dans `script-src` et `style-src`, de 16 octets en base64 ; aucun mot-clé `unsafe-` |
| `nonce-scripts` | toutes | Au moins une balise `<script>`, et chacune porte `nonce="<nonce de l'en-tête>"` : la page est rendue à la requête (« Pièges connus », rendu dynamique) |
| `nonce-neuf` | accueil | Deux requêtes successives reçoivent deux nonces différents |
| `entetes` | toutes | Les sept en-têtes de la section 6 de `socle-interface.md`, valeur exacte (HSTS `max-age=63072000; includeSubDomains` compris) ; aucun `X-Powered-By` |
| `fuite` | toutes, les sept réponses comprises | Ni le corps ni les en-têtes ne contiennent : une ligne de pile (`at … (…:l:c)`), un chemin de fichier (`node_modules`, `.next/`, `webpack-internal`, `file://`, `/home/`, `/var/task/`, `/vercel/path`, `/tmp/`, `/Users/`, `C:\Users`…), un nom de variable d'environnement (`DATABASE_URL`, `BETTER_AUTH_*`, `EMAIL_*`, `GMAIL_*`, `VERCEL_*`, `NODE_ENV`, `process.env`), une adresse PostgreSQL, `app_facturation`, `ECONNREFUSED` |
| `anglais` | tableau-de-bord, inexistante, lien | Le document servi ne contient ni « 404 », ni « not found », ni « could not be found » |
| `gabarit` | tableau-de-bord (les deux réponses), inexistante | Le corps entier, charge utile RSC comprise, ne contient aucun texte du gabarit de l'application (bandeau de simulation, nom de la navigation, « Organisation active », entrées, rôles), recopiés et comparés à `src/textes/` par un test |
| `identique` | tableau-de-bord, lien | `/tableau-de-bord` : même statut et même document servi sans cookie et avec le cookie forgé. `/lien/devis/<jeton>` : même statut et même document servi pour deux jetons aléatoires. Aucune comparaison entre `/tableau-de-bord` et une adresse inexistante (section 5) |

**Document servi** : le HTML de la réponse, contenu des scripts en ligne vidé (leurs attributs gardés) et chaque nonce remplacé par une valeur fixe (`documentServi`, même définition dans le script et dans `e2e/outils.ts`, vérifiée par un test). Les octets bruts ne peuvent pas être comparés : le nonce change à chaque requête, et la charge utile RSC des scripts en ligne contient l'adresse demandée et le segment de route, si bien que deux adresses inexistantes diffèrent déjà entre elles. La recherche de « 404 » porte sur le document servi : le `digest` interne `NEXT_HTTP_ERROR_FALLBACK;404` de Next.js figure dans la charge utile et n'est pas affiché.

### 3. Le workflow : `.github/workflows/controle-deploiement.yml`

- **Déclencheurs** : `deployment_status` (publié par Vercel pour chaque déploiement) et `workflow_dispatch`.
- **Premier job, `evenement`, toujours exécuté** (décision 11) : il affiche seulement `github.event_name`, `github.event.deployment.environment`, `github.event.deployment.production_environment` et `github.event.deployment_status.state`, passés par `env` et jamais interpolés dans la commande. Un job à condition sautée n'exécute aucun pas : ce job séparé dit pourquoi le contrôle a tourné ou non.
- **Filtre** : le job `controler` (qui suit `evenement`) ne tourne que si l'état est `success` et que l'environnement GitHub du déploiement commence par `Production` (Vercel le nomme `Production` ou `Production – <projet>`) ou que le déploiement est marqué `production_environment`, ou sur un lancement à la main depuis `main`. Un déploiement de prévisualisation, ou un état autre que `success` (`pending`, `in_progress`), donne un job « sauté », sans contrôle (décision 4).
- **Adresse** : le domaine de production, écrit dans le workflow (`https://facturation-pme.vercel.app`), et non `environment_url` de l'événement (décision 3).
- **Permissions** : `contents: read` (récupération du code), rien d'autre. Aucun secret, aucun `environment:` GitHub, aucune donnée de l'événement interpolée dans une commande.
- **Étapes** : récupérer le code, installer Node.js 24, lancer le script avec `--essais 3 --pause 20`. Pas de `npm ci` : le script n'a aucune dépendance.
- **Échec** : le script sort en 1, le job échoue ; GitHub envoie l'email d'échec de workflow à l'auteur de l'exécution (réglage par défaut des notifications « Actions »).
- **Coût** : dépôt public ou offre gratuite de GitHub Actions, moins d'une minute par déploiement.

### 4. Ce que le contrôle prouve des menaces T-53 et T-74

- **Rôle restreint (ligne 0.8 de `PLAN.md`)**, preuve indirecte : `/` en 200 prouve que `register` a accepté la configuration, donc que la `DATABASE_URL` de production nomme le rôle `app_facturation` (`env-schema.ts`). Le contrôle ne prouve pas les droits réels de ce rôle en base.
- **T-74** (base distincte pour les prévisualisations) : non vérifiable par une requête publique sans secret. Non couvert ici (« Reporté »).
- **T-53** : non vérifiable sans lecture de la base. Les deux contrôles avec base reportés à la 0.8 par les fiches de la 0.2 et de la 0.3 sont reportés à nouveau (décision 2).

### 5. Écart S-02 constaté à la rédaction, et sa correction

**Constat** (2026-10-13, site construit en local, `main` à `592a34e`) : `/tableau-de-bord` sans session répond bien 404, mais son HTML est le **document d'erreur de Next.js** (`<html id="__next_error__">`, corps vide), sans la page « introuvable », qui n'apparaît qu'après hydratation. Une adresse inexistante portait la page dans son HTML. Un client sans JavaScript distinguait donc une page existante de l'application d'une adresse inexistante : écart à S-02, venu de la 0.6. Les tests de la 0.6 comparaient le rendu après hydratation et ne le voyaient pas.

**Cause** (lue dans `node_modules/next/dist/server/app-render/`, Next.js 16.4.0). `lirePourPage` (`src/server/actions/exposer.ts`) appelle `notFound()` sur `refuse` et `connexion_requise`, depuis `(app)/layout.tsx` et chaque page. La frontière qui affiche `not-found.tsx` (`HTTPAccessFallbackBoundary`, posée par `create-component-tree.js`) est un composant client : React ne l'exécute pas pendant le rendu serveur. L'erreur remonte jusqu'au squelette, et la reprise d'erreur d'`app-render.js` pose le 404 et envoie le document `__next_error__` (`getErrorRSCPayload`) ; la page « introuvable » est rendue dans le navigateur. Une adresse inexistante prenait un autre chemin : le routage choisit directement l'arbre de `/_not-found`, rendu sur le serveur. Next.js ne rend la page « introuvable » sur le serveur après un `notFound()` que pour une action serveur (`createNotFoundLoaderTree`), jamais pour l'affichage d'une page.

**Correction (option A, retenue par le développeur le 2026-10-13)** : toute page introuvable passe par `notFound()`. Une route attrape-tout, `src/app/[...introuvable]/page.tsx`, appelle `notFound()` pour toute adresse sans page. Une adresse inexistante, `/tableau-de-bord` sans session ou avec un cookie forgé, et une adresse sous `/lien/` reçoivent alors le même statut et le même document au nonce près (constaté, et vérifié par les tests). `lirePourPage` et la protection des pages ne changent pas. Les routes plus précises passent avant la route attrape-tout : l'accueil, les pages, les fichiers de `/_next/` et `favicon.ico`, et une future `route.ts` sous `/api/auth` (ordre de `getSortedRoutes`, vérifié par un test). Les en-têtes de `/lien/` (`X-Robots-Tag`) et la politique restent posés.

Options écartées : réécriture dans le proxy des adresses de `(app)/` sans cookie (un cookie forgé resterait distinguable, valider la session dans le proxy est interdit par la règle S) ; gabarit qui afficherait lui-même la page « introuvable » sans lever (aucun moyen de poser le 404, protection des pages changée) ; accepter l'écart (non surveillé).

**Portée de S-02 précisée (décision 10, relecteur, 2026-10-13).** Premier passage en production : 18 contrôles sur 19, seul `tableau-de-bord:identique` échoue. Diagnostic par `--detail` : `/tableau-de-bord` sans session reçoit le document d'erreur (404, 1 144 caractères servis), une adresse inexistante la page « introuvable » rendue par le serveur (404, 2 966 caractères). Sur Vercel, la route attrape-tout ne sert donc pas les adresses sans page ; la cause exacte (règles de routage de `@vercel/next`, phase `error` qui réécrit vers `/_not-found`) n'a pas pu être tranchée sans accès à la production. Le relecteur précise S-02 : l'indiscernabilité porte sur les **ressources** (identifiants, jetons), qui passent toujours par une même route, et non sur les noms de pages, déjà publics dans les fichiers JavaScript envoyés au navigateur. En conséquence :

- la route attrape-tout `src/app/[...introuvable]/` est supprimée, avec la règle de `CLAUDE.md` qui l'imposait et les tests de non-capture : `next start` répond désormais comme Vercel (adresse sans page : page rendue par le serveur ; page refusée : document d'erreur) ;
- le contrôle et les tests comparent `/tableau-de-bord` sans cookie et avec un cookie forgé, et deux `/lien/devis/<jeton>` aléatoires (même statut, même document au nonce près). Ils vérifient toujours, pour `/tableau-de-bord` et une adresse inexistante : 404, aucun texte du gabarit, aucune fuite, aucun anglais ;
- limite connue datée : le nom d'une page de l'application est observable, jamais son contenu (« Limites connues », `THREATS.md` RR-11) ;
- les fonctionnalités qui ajoutent des ressources (3.x et suivantes) écrivent le test : identifiant inexistant et identifiant d'une autre organisation donnent la même réponse (`PLAN.md`, jalon 3 et section 4.3).

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Service de surveillance externe (UptimeRobot, Checkly) | Compte tiers, contrôle hors du dépôt ; les en-têtes et la comparaison des pages « introuvable » demandent un script de toute façon |
| Playwright dans le workflow | `npm ci` et l'installation de Chromium à chaque déploiement, pour un contrôle qui ne lit que des réponses HTTP. Le rendu dans un navigateur reste vérifié en CI, en local |
| Écrire le script en TypeScript (`.mts`, lancé par `tsx`) | Demanderait `npm ci` dans le workflow. Un `.mjs` tourne sur le Node.js de l'exécuteur, sans installation |
| Importer les valeurs attendues depuis `src/lib/securite/entetes.ts` | Le contrôle comparerait la production à l'implémentation au lieu d'une référence indépendante. Les valeurs sont recopiées, et un test vérifie qu'elles égalent celles des tests de bout en bout (`e2e/outils.ts`) |
| Contrôler `environment_url` du déploiement | Adresse propre au déploiement, protégée par l'authentification de Vercel (401) selon les réglages ; et une donnée d'événement à valider. Le domaine de production est ce que voient les visiteurs |
| Événement `repository_dispatch` de Vercel (`vercel.deployment.success`) | Plus récent, propre à Vercel ; `deployment_status` est l'événement standard de GitHub, déjà publié par l'intégration installée |
| Point d'entrée de santé (`/api/sante`) qui interroge la base | Nouvelle route (règle 11), et lecture de la base à chaque passage ; exclu par les contraintes de la fiche (lecture publique seule) |
| Comparer les octets des deux réponses 404 | Impossible même entre deux adresses inexistantes (section 2) |
| Comparer le texte de la page « introuvable » dans le HTML brut | Impossible après la correction : toute page introuvable a un corps vide sans JavaScript (section 5). Le contrôle compare le statut et le document |

## Règles de sécurité et permissions

- Exigences vérifiées en production : S-02 (même réponse qu'une adresse inexistante), S-80 (politique et en-têtes), S-85 (aucun détail technique dans une page).
- Menaces : T-53 et T-74 en partie (section 4) ; T-34, T-35, T-37 vérifiées sur la production.
- Le contrôle n'a aucun droit : requêtes `GET` publiques, sans session, sans secret ; il ne peut ni écrire en base, ni envoyer d'email, ni modifier le déploiement. Il ne lance aucune action serveur (pas de `POST`).
- Le workflow n'a que `contents: read` et n'interpole aucune donnée de l'événement dans une commande (injection par un nom de branche ou d'environnement).
- Matrice des droits : aucune ligne concernée. Tables : aucune.
- Le script ne s'exécute jamais depuis le poste de l'assistant contre la production ni contre une prévisualisation : seulement contre `localhost` et un serveur factice.

## Dépendances nouvelles

Aucune.

## Migration

Aucune.

## Critères d'acceptation

- [x] `scripts/controle-deploiement.mjs` n'émet que des `GET`, sans cookie (sauf le cookie de session forgé de `/tableau-de-bord`) ni en-tête d'authentification, ne suit aucune redirection, et refuse une adresse autre qu'une origine HTTPS (ou `http://localhost`, `http://127.0.0.1`) sans émettre de requête.
- [x] Chaque contrôle de la section 2 échoue seul quand le défaut correspondant est présent sur un serveur factice, et tout passe sur un serveur factice conforme.
- [x] Sur le site construit en local, tous les contrôles passent.
- [x] `/tableau-de-bord` sans cookie et avec un cookie forgé : même statut 404, même document au nonce près. Deux `/lien/devis/<jeton>` aléatoires : idem. `/tableau-de-bord` et une adresse inexistante : 404, aucun texte du gabarit, aucune fuite, aucun anglais (section 5, décision 10).
- [x] Les valeurs attendues du script égalent celles des tests de bout en bout et le texte de `src/textes/erreurs.ts`.
- [x] Code de sortie 0 si tout passe, 1 si un contrôle échoue, 2 pour une adresse refusée.
- [x] `.github/workflows/controle-deploiement.yml` : déclenché par `deployment_status` réussi de production et par `workflow_dispatch` sur `main`, `contents: read` seul, aucun secret.
- [ ] Premier passage réel sur GitHub (développeur, après la fusion) : exécution déclenchée par le déploiement de production ; entièrement vert.

## Tests à écrire

Dans `e2e/controle-deploiement.spec.ts`, projet `ordinateur-1280` : le serveur factice et le site construit sont tous deux à disposition dans Playwright, qui lance déjà ce dernier.

### Tests unitaires (serveur factice `node:http` sur `127.0.0.1`)

- [x] Serveur conforme : tous les contrôles passent ; le serveur n'a reçu que des `GET`, sans `Authorization`, sur `/`, `/tableau-de-bord`, une adresse inexistante et deux `/lien/devis/<jeton>` différents à chaque passage ; un seul `Cookie` par passage, la session forgée sur `/tableau-de-bord`, différente d'un passage à l'autre.
- [x] Défauts, un par cas, chacun faisant échouer exactement le contrôle attendu : `X-Powered-By` présent ; HSTS absent ; HSTS sans `includeSubDomains` ; politique avec `'unsafe-inline'` ; politique sans nonce ; nonces différents entre `script-src` et `style-src` ; directive manquante ; même nonce à chaque requête ; balise `<script>` sans nonce ; `/` en 500 ; `/` redirigée ; `/tableau-de-bord` en 200 ; page introuvable en anglais ; document de `/tableau-de-bord` différent avec le cookie forgé ; document de `/lien/devis/<jeton>` différent d'un jeton à l'autre ; texte du gabarit dans la charge utile de `/tableau-de-bord` ; pile dans le corps ; chemin de fichier dans le corps ; `DATABASE_URL` dans le corps ; nom de variable dans un en-tête.
- [x] Serveur injoignable : échec par page, sans exception.
- [x] Ligne de commande : code 0 (conforme), 1 (défaut), 2 et aucune requête pour `http://exemple.test`, une adresse avec chemin, avec identifiants, ou absente.
- [x] Cohérence : politique et en-têtes attendus égaux à `POLITIQUE_PRODUCTION` et `ENTETES_SECTION_6` d'`e2e/outils.ts` ; `documentServi` du script égal à celui d'`e2e/outils.ts`.

### Tests d'attaque

- [x] Redirection vers un autre hôte : non suivie (le serveur factice de destination ne reçoit rien).
- [x] Une fuite dans n'importe laquelle des sept réponses, en-têtes compris, est signalée.
- [x] `--detail` : statuts, longueurs, position et extraits sous les seuls contrôles `identique` ; aucun en-tête, aucun cookie, aucun nonce, aucun contenu de script dans la sortie. Sans `--detail`, la sortie ne change pas.

### Tests de bout en bout

- [x] Site construit en local (`http://localhost:3000`) : tous les contrôles passent.
- [x] `e2e/zones.attaque.spec.ts` : HTML brut, même statut et même document pour `/tableau-de-bord` sans cookie, avec un cookie forgé, aléatoire ou vide ; aucun texte anglais dans le document (`/tableau-de-bord`, inexistante, `/lien/`) ; aucun texte du gabarit dans le HTML ni la charge utile RSC (`/tableau-de-bord`, inexistante) ; `/api/auth` non exposé.
- [x] `e2e/entetes.attaque.spec.ts` : `/lien/devis/<jeton>` garde `X-Robots-Tag`, la politique et les en-têtes ; deux jetons aléatoires reçoivent le même document.
- [x] Rendu après hydratation (navigateur) : « Cette page est introuvable » pour `/tableau-de-bord`, identique avec ou sans cookie forgé, et pour une adresse inexistante.

## Fichiers concernés

- `docs/features/controle-deploiement.md` (cette fiche)
- `scripts/controle-deploiement.mjs`
- `e2e/controle-deploiement.spec.ts`
- `.github/workflows/controle-deploiement.yml`
- `src/app/[...introuvable]/page.tsx` : route attrape-tout (section 5), supprimée (décision 10)
- `e2e/outils.ts` (`documentServi`), `e2e/zones.attaque.spec.ts`, `e2e/erreurs.attaque.spec.ts`, `e2e/entetes.attaque.spec.ts` : tests de la correction, puis de la décision 10
- `CLAUDE.md` : règle 5 (portée de S-02, aucune route attrape-tout), commande du contrôle
- `docs/THREATS.md` (portée de S-02, T-30, RR-11), `docs/PLAN.md` (test dû par les fonctionnalités à ressources), `docs/features/socle-interface.md` (décision 37), `docs/STRUCTURE.md` (phrase sur la page « introuvable »)
- `src/server/env.test.ts` : délai du test « témoin : configuration valide » (hors fonctionnalité, demandé par le développeur, décision 7)

## Reporté

### Contrôles avec lecture de la base de production (fonctionnalité à placer au jalon 8)

- Droits réels du rôle `app_facturation` en production : ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur `journal_audit` (`journal-audit.md`) ; lecture de `temoin_isolation` sans organisation active : 0 ligne (`acces-donnees.md`, T-53).
- Base des prévisualisations distincte de celle de la production (T-74).
- Ces contrôles demandent un secret de connexion dans GitHub (environnement protégé, comme `migrations.yml`) et sortent des contraintes de cette fiche.

### Au jalon 1

- Quand `/api/auth` sera exposé (1.1), ajouter au contrôle les points d'entrée natifs fermés du module organisation (`/api/auth/organization/*` : réponse d'adresse inexistante, T-55), en `GET` seulement.

## Limites connues

- Le contrôle vise le domaine de production. Si Vercel n'a pas encore attaché le domaine au nouveau déploiement au moment de l'événement, c'est l'ancien qui est contrôlé ; les trois essais espacés de 20 s réduisent ce cas sans l'exclure.
- Le nom d'environnement publié par Vercel (`Production`, ou `Production – <projet>`) n'est pas vérifiable avant le premier déploiement : si le premier déploiement de production donne une exécution « sautée », le filtre est à corriger (lancement à la main en attendant).
- Le contrôle de fuite est une liste de motifs : un détail technique sous une autre forme passerait.
- Une exécution « sautée » apparaît dans l'onglet « Actions » pour chaque déploiement de prévisualisation.
- L'email d'échec de GitHub part vers l'auteur de l'exécution, selon ses réglages de notification ; il n'est pas configurable depuis le dépôt.
- **Sans JavaScript, une page refusée est blanche** (section 5) : `/tableau-de-bord` sans session ou avec un cookie forgé reçoit le document d'erreur de Next.js, au corps vide ; « Cette page est introuvable » et « Revenir à l'accueil » ne s'affichent qu'après hydratation. Une adresse sans page reçoit la page rendue par le serveur.
- **Le nom d'une page de l'application est observable, jamais son contenu** (2026-10-13, décision 10, `THREATS.md` RR-11) : sans session, `/tableau-de-bord` (document d'erreur, 1 144 caractères servis en production) se distingue d'une adresse inexistante (page rendue, 2 966 caractères). Les noms de pages sont déjà publics dans les fichiers JavaScript. Aucun texte du gabarit ni de la page n'est envoyé (contrôle `gabarit`).
- **La charge utile RSC nomme l'adresse et le segment de route** : sous une même route, deux réponses ne diffèrent que par elle ; le document servi, lui, est identique (contrôles `identique`).

## Décisions

Prises le 2026-10-13 par l'assistant, selon ses recommandations, sur instruction du développeur (« pour chaque question ouverte, applique ta recommandation »), sauf la 5, tranchée par le développeur.

1. **Périmètre.** Requêtes `GET` publiques seules, sans secret, sans base, sans email (contraintes du développeur). La ligne « rôle restreint » de `PLAN.md` est couverte indirectement (section 4).
2. **Contrôles avec base** (`journal_audit`, `temoin_isolation`, T-74) : reportés à une fonctionnalité du jalon 8, avec secret dans un environnement GitHub protégé.
3. **Adresse contrôlée** : le domaine de production, écrit dans le workflow ; pas d'entrée d'adresse au lancement à la main (le contrôle ne vise jamais autre chose que la production depuis GitHub).
4. **Déclencheur** : `deployment_status` filtré sur `success` et un environnement commençant par `Production`, plus `workflow_dispatch` limité à `main`.
5. **Écart S-02 de `/tableau-de-bord`** (section 5) : corrigé dans cette PR, avant la fusion, par l'option A (toute page introuvable passe par `notFound()`, route attrape-tout). Le contrôle compare le statut et le document servi, et passe entièrement sur le site construit en local. Choix du relecteur, le 2026-10-13 : on ne fusionne pas un contrôle rouge.
6. **Essais** : trois, espacés de 20 s, dans le workflow ; un seul par défaut en ligne de commande et dans les tests.
7. **`src/server/env.test.ts`** : délai de 30 s sur le test « témoin : configuration valide », demandé par le développeur avec la 0.8 ; le premier chargement réel des modules, juste après `lint` et `typecheck` dans `npm run verifier`, dépasse parfois les 5 s par défaut.
8. **Tests** : dans Playwright (`e2e/`), qui lance déjà le site construit ; pas d'extension de l'inclusion de Vitest à `scripts/`.
9. **Valeurs attendues recopiées** dans le script, avec un test de cohérence (alternatives écartées).
10. **Portée de S-02 précisée** (relecteur, 2026-10-13, après le premier passage en production) : l'indiscernabilité porte sur les ressources, sous une même route, pas sur les noms de pages. Route attrape-tout supprimée ; comparaisons `tableau-de-bord:identique` (sans cookie, cookie forgé) et `lien:identique` (deux jetons) ; contrôle `gabarit` ajouté ; option `--detail` (section 5). Remplace la décision 5 pour ce qui est comparé.
11. **Diagnostic du déclenchement** (relecteur, 2026-10-13) : l'exécution n° 3, attendue pour le déploiement de production, a été sautée. Un job `evenement` toujours exécuté affiche les quatre champs qui décident du filtre ; le filtre accepte aussi `production_environment == true`. Hypothèse retenue en attendant la prochaine exécution : Vercel publie plusieurs états par déploiement (`pending` à la création, puis `success`), chacun déclenchant une exécution ; l'exécution n° 3 serait celle d'un état autre que `success`.

## Notes de l'implémentation

### Implémentation, le 2026-10-13

- Phase rouge (`019efb0`) : la spec échoue au chargement, `scripts/controle-deploiement.mjs` n'existant pas.
- Playwright charge les modules importés par une spec en CommonJS (le dépôt n'a pas `"type": "module"`) : `import.meta` et l'`await` de premier niveau y lèvent `SyntaxError`. Le lancement direct se reconnaît donc au nom du script (`process.argv[1]`), et la ligne de commande n'utilise pas d'`await` de premier niveau.
- Après l'implémentation : les 25 tests de `e2e/controle-deploiement.spec.ts` passent, dont le site construit en local avec exactement les deux échecs de la section 5. Chaque défaut du serveur factice fait échouer le seul contrôle attendu, ce qui sert de contre-épreuve à chaque contrôle.

### Correction de l'écart S-02, le 2026-10-13

- Phase rouge (`53a92ae`) : le test du HTML brut échouait, corps vide pour `/tableau-de-bord`, page « introuvable » pour une adresse inexistante. Réécrit avec l'option A pour comparer statut et document au lieu du texte (accord du développeur).
- Après la route attrape-tout : documents identiques au nonce près pour une adresse inexistante, une seconde adresse inexistante, `/tableau-de-bord` sans cookie et avec cookie, `/lien/xyz` et `/api/auth/session` (constaté sur le site construit, port 3200, avant les tests).
- Tests de la 0.6 modifiés : dans `e2e/zones.attaque.spec.ts`, « rien du gabarit dans le HTML ni dans la charge utile RSC » attendait le texte de la page « introuvable » dans le HTML brut (il ne l'y trouvait que dans la charge utile) ; il attend désormais le document d'erreur. Dans `e2e/entetes.attaque.spec.ts`, « /lien/devis/<jeton aléatoire> : introuvable, non indexé, sans cookie » lisait le texte dans le HTML brut ; il compare désormais le document à celui d'une adresse inexistante. Les tests dans le navigateur ne changent pas.

### Portée de S-02 précisée, le 2026-10-13

- Premier passage à la main en production : 18 contrôles sur 19, seul `tableau-de-bord:identique` en échec ; diagnostic par `--detail` (section 5). Le même contrôle passait sur `next start` : un test local qui ne reproduit pas la plateforme ne prouve rien.
- Après la suppression de la route attrape-tout, sur le site construit en local : une adresse inexistante reçoit `<html lang="fr" …>` avec « Cette page est introuvable » dans le HTML, `/tableau-de-bord` le document `__next_error__`, comme en production. Le script passe entièrement (28 contrôles ; `--detail` : 1 084 caractères servis avec et sans cookie forgé, 2 885 pour les deux jetons).
- Tests modifiés : `e2e/zones.attaque.spec.ts` (comparaisons avec et sans cookie, gabarit vérifié aussi pour une adresse inexistante, tests de non-capture supprimés), `e2e/erreurs.attaque.spec.ts` (navigateur : sans session et cookie forgé), `e2e/entetes.attaque.spec.ts` (deux jetons de `/lien/devis/`), `e2e/controle-deploiement.spec.ts` (serveur factice : cookie, `/lien/`, défauts `cookie-distingue`, `lien-distingue`, `gabarit-dans-la-charge`).
