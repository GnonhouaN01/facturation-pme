# Fonctionnalité : tâche quotidienne (première version)

Statut : brouillon. Fiche rédigée le 2026-10-13 par l'assistant ; points ouverts tranchés selon sa recommandation (section « Décisions par défaut »), sauf deux, soumis au développeur (section « Décisions à prendre »).

Fonctionnalité 8.3 de `docs/PLAN.md`, avancée au jalon 1 (`limitation-debit.md`, décision 6). Taille S. Prérequis de la PR 2 de la 1.1 (`inscription.md`, « Contexte » et « Découpage en PR »). Cas d'utilisation : aucun. Exigences : S-54, S-83, S-84, S-85 ; durées de conservation de `THREATS.md` 7.2. Menaces : T-35, T-41 ; nouvelle T-45 (section « Règles de sécurité »).

## Contexte

Deux purges existent et sont testées, mais rien ne les appelle :

| Fonction | Fichier | Livrée par | Supprime |
|---|---|---|---|
| `purgerCompteurs()` | `src/server/debit/debit.ts` (sur `compteur.purger` de `src/server/db/debit.ts`) | 0.5 | Les lignes de `compteur_debit` plus vieilles que la plus longue fenêtre de `LIMITES` (`fenetreMaxSecondes`, 24 h aujourd'hui) |
| `purgerComptesNonVerifies()` | `src/server/db/comptes.ts` | 1.1, PR 1 | Les utilisateurs à l'adresse non vérifiée créés il y a plus de 7 jours ; comptes et sessions suivent par `ON DELETE CASCADE` |

La PR 2 de la 1.1 met en service les premières limites par adresse IP (`auth.*`) : un attaquant qui change d'adresse ajoute une ligne à `compteur_debit` par adresse (`limitation-debit.md`, section 7). Elle ouvre aussi l'inscription, donc la création de comptes non vérifiés, que `THREATS.md` 7.2 ne garde que 7 jours. D'où l'ordre fixé par `PLAN.md` (jalon 1) : la tâche quotidienne est en service avant la PR 2.

État au départ (`main` à `ce27a69`) :

- `src/app/api/` n'existe pas. `src/server/actions/inventaire.test.ts` admet déjà la route `api/taches/quotidienne` (« PLAN.md 8.3 : tâche quotidienne, avec son propre contrôle »). `STRUCTURE.md` prévoit `src/app/api/taches/quotidienne/`.
- Aucun fichier `vercel.json`. Projet Vercel sur l'offre Hobby, fonctions à Francfort.
- `src/server/env.ts` valide trois variables (`validerEnvironnement`) et la configuration d'envoi (`validerConfigurationEmail`) ; une configuration refusée fait échouer chaque requête (`CLAUDE.md`, « Pièges connus »).
- `src/proxy.ts` s'applique à toute adresse hors des fichiers statiques, `/api/` comprise ; `next.config.ts` pose les en-têtes de sécurité sur `/(.*)`.

## Problème

- Sans appel quotidien, `compteur_debit` grossit sans fin dès la première limite par adresse IP, et les comptes non vérifiés restent au-delà de 7 jours, contre `THREATS.md` 7.2.
- Une adresse qui déclenche des suppressions en base ne doit être appelable que par Vercel : sinon, n'importe qui la déclenche en boucle (calcul, connexions à Neon).
- Le secret qui protège l'appel ne doit passer ni par l'assistant, ni par un fichier du poste, ni par le dépôt (règle 1 de `CLAUDE.md`, T-70, T-73).

## Solution retenue

Vue d'ensemble :

| Élément | Fichier | Rôle |
|---|---|---|
| Planification | `vercel.json` | Une seule entrée `crons`, une fois par jour |
| Route | `src/app/api/taches/[tache]/route.ts` | Forme exacte, une ligne : `export const GET = traiterTache;` |
| Contrôle et exécution | `src/server/taches/quotidienne.ts` | Secret comparé en temps constant, liste fermée des tâches, réponses fixes |
| Étapes | `src/server/taches/etapes.ts` | `compteurs_debit` puis `comptes_non_verifies`, chacune isolée, ligne de journal fixe |
| Secret | `src/server/env-schema.ts`, `src/server/env.ts` | `validerSecretTache` : `CRON_SECRET`, obligatoire en production |
| Contrôle après déploiement | `scripts/controle-deploiement.mjs` | Page `tache` : refus identique à une tâche inexistante |

### 1. Le déclenchement par Vercel Cron

#### 1.1 Ce que dit la documentation de Vercel

Consultée le 2026-10-13 (`vercel.com/docs/cron-jobs`, mise à jour du 2026-09-16 ; `.../usage-and-pricing`, du 2026-07-15 ; `.../manage-cron-jobs`, du 2026-08-11) :

| Point | Offre Hobby |
|---|---|
| Nombre de tâches par projet | 100 |
| Fréquence | **Une fois par jour au plus.** Une expression plus fréquente fait **échouer le déploiement** (« Hobby accounts are limited to daily cron jobs ») |
| Précision | À l'heure près : `0 3 * * *` part entre 03:00:00 et 03:59:59 |
| Fuseau | Toujours UTC (Abidjan est en UTC+0, sans heure d'été) |
| Requête | `GET` vers **le déploiement de production seulement**, agent `vercel-cron/1.0`, en-tête `x-vercel-cron-schedule` |
| Authentification | Si `CRON_SECRET` existe dans le projet, Vercel envoie `Authorization: Bearer <CRON_SECRET>` (16 caractères au moins recommandés) |
| Échec | **Aucune nouvelle tentative.** Visible seulement dans les journaux (« View Logs ») |
| Livraison | « Best effort » : un passage peut manquer, ou **arriver deux fois**. Les opérations doivent être idempotentes |
| Redirection | Jamais suivie |
| Durée | Celle des fonctions (`maxDuration`) |
| Retour arrière | « Instant Rollback » remet les tâches du déploiement choisi |

Conséquences : aucune prévisualisation n'est jamais appelée par Vercel ; une tâche manquée n'est rattrapée que le lendemain ; chaque étape doit supporter deux appels, simultanés ou non (section 3.2).

#### 1.2 `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/taches/quotidienne", "schedule": "0 3 * * *" }]
}
```

- **03:00 UTC**, soit entre 3 h et 4 h à Abidjan : hors des heures d'usage d'une petite structure ivoirienne.
- Aucune autre clé dans `vercel.json` : tout autre réglage reste dans `next.config.ts`. Un test le vérifie (« Tests à écrire », 5), ainsi que l'expression quotidienne : une expression plus fréquente ferait échouer le déploiement de production, et le test le dit avant.

### 2. L'authentification de l'appel

#### 2.1 La route, et la réponse « inexistante »

```ts
// src/app/api/taches/[tache]/route.ts — forme exacte, vérifiée par le test d'inventaire
import { traiterTache } from "@/server/taches/quotidienne";
export const GET = traiterTache;
```

`traiterTache(requete, { params })`, dans l'ordre :

1. **Secret.** Comparaison de l'en-tête `Authorization` avec `Bearer <CRON_SECRET>`, **toujours calculée**, que la tâche existe ou non (section 2.2).
2. **Tâche.** `params.tache` cherché dans la liste fermée `TACHES` (`{ quotidienne: executerTacheQuotidienne }`, `Object.hasOwn`).
3. **Refus** (secret faux, absent, non configuré, ou tâche inconnue) : `reponseInexistante()`, construite par une seule fonction : statut 404, corps vide, `Cache-Control: no-store`, aucun autre en-tête propre. Aucune étape n'est lancée, rien n'est lu en base, **aucune ligne au journal** (un appel refusé en boucle ne remplit pas le journal, et ne coûte qu'une empreinte).
4. **Exécution** (section 3), puis réponse fixe : 200 `{"ok":true}` si toutes les étapes ont réussi, 500 `{"ok":false}` sinon ; `Cache-Control: no-store`. Le corps ne dit rien des nombres ni des erreurs : ils sont au journal.

**Pourquoi un segment dynamique `[tache]`.** Une route fixe `api/taches/quotidienne` ne peut pas répondre comme une adresse inexistante : une adresse sans page reçoit la page « introuvable » rendue par le serveur (HTML de quelques Kio, nonce), une route qui refuse reçoit ce que la route renvoie. `notFound()` dans un gestionnaire de route renvoie un 404 (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`), mais rien ne garantit qu'il soit identique à la page rendue pour une adresse sans page ; `controle-deploiement.md` (section 5) a montré qu'une telle égalité, vraie sur `next start`, peut être fausse sur Vercel. Avec `[tache]`, un appel refusé à `/api/taches/quotidienne` et un appel à `/api/taches/<nom inconnu>` passent par le même gestionnaire et reçoivent `reponseInexistante()`, octet pour octet, par construction, en local comme sur Vercel. C'est la portée de S-02 précisée le 2026-10-13 (`THREATS.md` 5.4) : l'indiscernabilité sous une même route. Le nom `/api/taches/quotidienne` est public de toute façon (`vercel.json`, dépôt public). Décision à prendre 2.

- **Seul `GET` est exporté.** Les autres méthodes reçoivent la réponse de Next.js (405 ; `OPTIONS` automatique), identique pour toute tâche, connue ou non (test).
- **Rien d'autre n'est lu** : ni paramètre de requête, ni corps, ni cookie, ni `User-Agent` (falsifiable), ni `x-vercel-cron-schedule`. Un secret placé dans la requête (`?secret=...`) est donc refusé comme un appel sans secret.
- Le proxy pose sa politique, et `next.config.ts` ses en-têtes, comme sur toute réponse : aucun changement.

#### 2.2 La comparaison en temps constant

```ts
// src/server/taches/quotidienne.ts
function secretValide(entete: string | null, secret: string | null): boolean
```

- Les deux valeurs (`entete ?? ""` et `` `Bearer ${secret ?? ""}` ``) passent par `createHash("sha256")` de `node:crypto`, puis `timingSafeEqual` compare les deux empreintes de 32 octets. La durée ne dépend ni de la longueur de l'en-tête reçu, ni de la position du premier caractère différent ; `timingSafeEqual` ne lève jamais, les longueurs étant égales.
- **Secret non configuré** (`null`) : le résultat est `false` **après** le même calcul, quel que soit l'en-tête (`Bearer `, `Bearer null`, `Bearer undefined` compris).
- Comparaison exacte : `bearer` en minuscules, deux espaces, espace final, secret sans `Bearer ` : refusés.
- Aucune dépendance : `node:crypto`.
- Un secret de 32 octets aléatoires ne se devine pas ; aucune limite de débit n'est ajoutée (section « Alternatives écartées »).

#### 2.3 `CRON_SECRET` dans la configuration

Nouvelle fonction pure dans `env-schema.ts`, sur le modèle de `validerConfigurationEmail` (elle ne touche pas aux trois variables de `validerEnvironnement`, que les tests, la CI et `.env.local` fournissent déjà) :

```ts
export function validerSecretTache(source: Source): Readonly<{ secret: string | null }>
// src/server/env.ts
export const secretTache = validerSecretTache(process.env);
```

| Environnement (`VERCEL_ENV`) | `CRON_SECRET` absente | Présente |
|---|---|---|
| `production` | **Configuration refusée** : chaque requête échoue (décision à prendre 1) | Validée |
| `preview`, local, tests | `secret: null` : la route refuse tout appel | Validée |

Validation : 32 à 256 caractères, alphabet `base64url` seul (`A-Z`, `a-z`, `0-9`, `-`, `_`). Une espace, un retour à la ligne (collage d'une ligne entière) ou un guillemet sont refusés au démarrage, plutôt que de rendre la tâche silencieusement inappelable. Message : `- CRON_SECRET : <raison>`, jamais la valeur (S-54), comme les autres variables. Une variable présente mais vide est refusée, comme `EMAIL_*`.

`.env.example` gagne une ligne en commentaire (`# CRON_SECRET=`), avec la mention « Vercel seulement ; en local, la tâche refuse tout appel ». Le développeur n'a rien à ajouter à `.env.local`.

### 3. Le contenu de la première version

#### 3.1 Les étapes

`executerTacheQuotidienne()` lance, **dans cet ordre et chacune quelle que soit l'issue de l'autre** :

| Étape | Appel | Condition de suppression |
|---|---|---|
| `compteurs_debit` | `purgerCompteurs()` | `fenetre_debut < now() - fenetreMaxSecondes` |
| `comptes_non_verifies` | `purgerComptesNonVerifies()` | `email_verified = false` et `created_at < now() - 7 jours` |

- Ni l'une ni l'autre n'ouvre de transaction d'organisation : tables sans `organisation_id` (`compteur_debit`, `user`), par `db`, comme aujourd'hui. `executerDansOrganisation` n'est pas utilisé ; le parcours des organisations une par une (`DESIGN.md`, section 2) viendra avec les étapes qui en ont besoin (relances, 8.3).
- Aucun `verifierDebit` (règle 15 sans objet), aucun email, rien au journal d'audit (aucune organisation, aucune action d'un membre).
- Les deux fonctions sont **injectées** (`creerTraitementTache({ secret, etapes, consigner })`) : les tests unitaires passent des étapes factices ; l'instance liée aux vraies fonctions est la seule exportée sous le nom `traiterTache`.

#### 3.2 Idempotence et appels concurrents

- Chaque étape est un seul `DELETE ... WHERE <âge>` : le rejouer ne supprime rien de plus que ce qui a dépassé la durée entre-temps. Deux passages le même jour : le second supprime 0 ligne (ou quelques-unes devenues trop vieilles entre les deux), sans erreur.
- **Deux passages simultanés** (livraison en double) : PostgreSQL verrouille chaque ligne supprimée ; le second `DELETE` attend puis ignore les lignes déjà supprimées. Aucune erreur, même état final (test d'intégration).
- **Passage manqué** : le suivant rattrape, la condition portant sur l'âge et non sur la date du passage précédent. Effet : un compte non vérifié peut vivre jusqu'à environ 9 jours (7 jours, plus 24 h de passage manqué, plus l'heure d'imprécision), « Limites connues ».
- Aucun verrou distribué (recommandé par Vercel pour les tâches longues ou non idempotentes) : ni l'une ni l'autre de ces deux conditions.

#### 3.3 Le journal, sans données personnelles

Une ligne par étape, par `console.info` pour une réussite et `console.error` pour un échec, préfixe fixe `[tache]`, JSON construit par la fonction depuis des champs choisis :

```
[tache] {"etape":"compteurs_debit","resultat":"ok","lignes":12,"dureeMs":41}
[tache] {"etape":"comptes_non_verifies","resultat":"erreur","classe":"DatabaseError","code":"57P01","dureeMs":5003}
```

- `etape` : valeur de la liste fermée ; `lignes` : entier ; `dureeMs` : entier ; `classe` : nom du constructeur filtré par la même expression que `consigner.ts` ; `code` : `codePostgres` de `src/server/erreurs/code-postgres.ts`.
- **Jamais** le message de l'erreur, sa pile, sa cause, la requête SQL ni ses paramètres, ni l'en-tête `Authorization`, ni une adresse email, une empreinte ou une adresse IP. Une erreur levée avec un message qui contient une adresse et une requête SQL n'en laisse rien passer (test d'attaque).
- La consignation ne lève jamais (même parade que `consignerErreurRequete` : ligne de repli fixe, console défaillante ignorée).
- `lignes` est un nombre de lignes supprimées : ni personne, ni donnée. Conservation : celle des journaux de Vercel (`THREATS.md` 7.2, journaux techniques).

### 4. Poser le secret dans Vercel, par le développeur

L'assistant ne voit jamais la valeur, ne lance aucune de ces commandes, et aucune n'écrit de fichier. Vercel range désormais les variables en **Config** et **Secret** ; une variable « Sensitive » existante est traitée comme Secret (documentation du 2026-08-28) : on choisit **Secret**, valeur illisible après l'enregistrement.

**Quand** : la valeur de production **avant la fusion** de la PR de cette fiche (décision à prendre 1 : sans elle, la production tombe au déploiement de la fusion). Une variable de Vercel ne s'applique qu'au déploiement suivant (`envoi-emails.md`, section 9) : la poser avant la fusion suffit, le déploiement de la fusion la prend.

**Deux valeurs distinctes** (S-83), une pour Production, une pour Preview, chacune tirée à part :

1. Dans Git Bash, sur le poste :
   ```sh
   S=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
   printf %s "$S" | clip.exe
   ```
   43 caractères `base64url`. La valeur reste dans une variable du terminal et dans le presse-papiers ; l'historique du terminal ne garde que la commande.
2. Vercel → projet → **Settings → Environment Variables → Add** : clé `CRON_SECRET`, type **Secret**, environnement **Production** seul, coller la valeur, enregistrer.
3. Vider le presse-papiers (`printf ' ' | clip.exe`) ; si l'historique du presse-papiers de Windows est actif (Win+V), y supprimer l'entrée. `unset S`. La valeur de production n'a plus jamais à être connue : Vercel l'envoie lui-même.
4. Recommencer les étapes 1 à 3 pour **Preview** (toutes les branches), avec une nouvelle valeur. Garder `S` dans le terminal seulement si l'essai de la section 5, point 2, est fait dans la foulée.

**Pourquoi Preview** : Vercel n'y appelle jamais la tâche. La valeur sert à un essai à la main sur la prévisualisation de cette PR (section 5) et donne à la prévisualisation la même configuration que la production. Sans elle, la route y refuserait tout, ce qui est sûr aussi.

**Renouvellement** : même procédure, en remplaçant la valeur (« Edit »), puis un nouveau déploiement de production (« Redeploy ») ; jusque-là, l'ancien déploiement garde l'ancienne valeur, cohérente avec celle que Vercel envoie.

À ne pas faire : coller la valeur dans un fichier (`.env.local` compris), dans une conversation avec l'assistant, dans une commande (elle serait dans l'historique et dans la liste des processus), dans un secret GitHub (la CI n'en a pas besoin).

### 5. Les preuves sur Vercel, par le développeur

Jamais par l'assistant (`CLAUDE.md`).

1. **Avant la fusion** : `CRON_SECRET` posée en Production et en Preview (section 4).
2. **Prévisualisation de la PR**, facultatif : `printf 'Authorization: Bearer %s' "$S" | curl -s -o /dev/null -w '%{http_code}\n' -H @- https://<adresse du déploiement>/api/taches/quotidienne` (l'en-tête est lu sur l'entrée standard, jamais dans la ligne de commande) ; attendu `200`, puis une ligne `[tache]` par étape dans les journaux du déploiement. Puis `unset S`. Si la protection des déploiements de Vercel répond 401, l'essai est sauté : la preuve se fait en production.
3. **Après la fusion** : le workflow `controle-deploiement.yml` passe, contrôles `tache:*` compris (section 6). `/` en 200 prouve que `CRON_SECRET` a été acceptée.
4. **Settings → Cron Jobs** : une seule tâche, `/api/taches/quotidienne`, `0 3 * * *`. Bouton « Run » : la documentation ne dit pas si ce lancement envoie `CRON_SECRET`. Lignes `[tache]` « ok » dans les journaux : il l'envoie ; aucune ligne (404) : il ne l'envoie pas, on attend le passage du lendemain.
5. **Le lendemain** : une exécution entre 03:00 et 03:59 UTC, deux lignes `[tache]` à `resultat: ok`, aucune adresse, aucun en-tête, aucun message d'erreur dans les journaux.

Résultats notés dans « Notes de l'implémentation ». La PR 2 de la 1.1 attend le point 5.

### 6. Le contrôle après déploiement

`scripts/controle-deploiement.mjs` gagne une page `tache`, toujours en `GET` seulement, sans secret :

| Requête | But |
|---|---|
| `/api/taches/quotidienne`, sans `Authorization` | Refus sans secret |
| `/api/taches/quotidienne`, `Authorization: Bearer <32 octets aléatoires>` | Refus d'un secret forgé (tiré au hasard à chaque passage, comme le cookie forgé de `/tableau-de-bord`) |
| `/api/taches/<nom aléatoire de 16 caractères hexadécimaux>` | Référence : tâche inexistante |

| Contrôle | Attendu |
|---|---|
| `tache:statut` | 404 pour les trois |
| `tache:identique` | Même statut, même corps (vide), même `Content-Type` pour les trois |
| `tache:entetes` | Les en-têtes de la section 6 de `socle-interface.md`, comme les autres pages |
| `tache:fuite` | Les motifs du contrôle `fuite`, en-têtes compris |
| `tache:anglais` | Ni « not found » ni « 404 » dans le corps |

- C'est utile : c'est la seule preuve automatique, sur la vraie production, qu'un appel sans le secret ne déclenche rien et ne se distingue pas d'une tâche inexistante. Un 200 sans secret (variable vide acceptée, contrôle retiré par erreur) y échoue aussitôt.
- La politique (`politique`) est vérifiée si le proxy la pose sur cette réponse, ce que la phase rouge constatera en local ; `nonce-scripts`, `gabarit` et `nonce-neuf` ne s'appliquent pas (aucun HTML).
- L'en-tête `Authorization` forgé est la seconde exception à « aucun en-tête d'authentification », après le cookie forgé ; la ligne de `controle-deploiement.md` (section 1) et la règle de `CLAUDE.md` sont mises à jour. La valeur n'est jamais affichée, même avec `--detail`.
- Le contrôle ne prouve pas que la tâche **tourne** : cela demanderait le secret. Preuve par les journaux (section 5) ; surveillance continue reportée à la 8.1.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| GitHub Actions planifié (`schedule:`), qui appelle la route | Un secret de plus dans GitHub, une seconde copie de `CRON_SECRET` ; GitHub retarde ou saute les exécutions planifiées en période de charge ; Vercel Cron est retenu par `STACK.md` |
| Tâche planifiée dans la base (`pg_cron`) | Le calcul de Neon se met en veille sans activité : une tâche interne ne tourne pas quand il dort. La logique sortirait du code testé, et l'extension se poserait hors des migrations admises |
| Route fixe `api/taches/quotidienne` avec `notFound()` | Égalité avec une adresse sans page non garantie, et différente entre `next start` et Vercel (section 2.1) |
| Comparaison directe `entete === attendu` (exemple de la documentation de Vercel) | Durée dépendante de la position du premier caractère différent |
| `timingSafeEqual` sur les valeurs brutes | Lève si les longueurs diffèrent, et la vérification de longueur préalable révèle la longueur du secret |
| Refuser un `User-Agent` autre que `vercel-cron/1.0` | Falsifiable ; n'ajoute rien au secret |
| Limite de débit par adresse IP sur la route | Chaque refus écrirait en base : un appel refusé deviendrait plus coûteux qu'aujourd'hui (une empreinte). Le secret de 256 bits ne se devine pas |
| Réponse 401 au refus (exemple de Vercel) | Dit que la route existe et attend un secret ; contraire à la demande (même réponse qu'une adresse inexistante) |
| Une route par purge | Deux tâches planifiées pour une même fréquence ; l'offre Hobby en permet 100, mais chaque route est une entrée de plus dans la liste admise |
| Arrêter la tâche à la première étape en échec | Une panne de la purge des compteurs empêcherait celle des comptes, sans raison |
| Corps de réponse détaillé (nombres, erreurs) | Rien à dire à l'appelant ; les nombres sont au journal |
| Ligne de journal pour chaque refus | Un appel refusé en boucle remplirait le journal ; Vercel garde déjà la trace des requêtes |
| `CRON_SECRET` ajoutée à `validerEnvironnement` | Obligatoire partout : `.env.local`, la CI et tous les tests devraient la fournir, pour une route qui ne sert qu'en production |

## Règles de sécurité et permissions

- **Nouvelle menace T-45** (section 5.5 de `THREATS.md`, à ajouter par la PR) : « Appeler la tâche quotidienne sans autorisation, pour consommer le calcul et les connexions, ou provoquer des suppressions » ; qui : P1 ; G 1, V 2, Faible. Parades : secret comparé en temps constant, refus identique à une tâche inexistante, étapes idempotentes qui ne suppriment que ce qui a dépassé sa durée de conservation. Test : un appel sans secret, avec un secret forgé ou mal formé reçoit la réponse d'une tâche inexistante, sans aucune étape lancée. Même avec le secret, un appel ne supprime rien qui ne devait pas l'être.
- **S-02** (portée du 2026-10-13) : refus et tâche inexistante, même réponse sous une même route (section 2.1).
- **S-54, S-85, T-35** : journal à champs choisis, aucun message d'erreur ; réponse fixe (section 3.3).
- **S-83, T-70, T-73** : secret dans Vercel seulement, deux valeurs distinctes, jamais par l'assistant, un fichier ou le dépôt (section 4).
- **S-84, T-41** : `compteur_debit` borné par la purge, avant les limites par adresse IP.
- **`THREATS.md` 7.2** : comptes non vérifiés, 7 jours, « Automatique » devient vrai ; compteurs de débit, « Purge quotidienne ».
- **Règle 5 de `CLAUDE.md`** : la route n'est pas une action ; elle a son propre contrôle (le secret tient lieu de session et de rôle ; aucune entrée lue, donc rien à valider ; aucune origine, l'appel venant de Vercel sans `Origin`). Elle figure dans la liste admise du test d'inventaire, qui cite cette fiche, et sa forme exacte est vérifiée.
- **Règle ESLint U**, nouvelle : `src/server/taches/` ne s'importe que dans `src/app/api/taches/[tache]/route.ts` et les tests ; `src/server/db/comptes.ts` et `purgerCompteurs` ne s'importent que dans `src/server/taches/` et les tests. Écrite par la méthode de `CLAUDE.md` (script Python, `chr(92)`) si une expression régulière en a besoin, vérifiée par `regles-import.test.ts`.
- **`STRUCTURE.md` section 7** : `app/` peut importer `server/taches/` (`route.ts` de `api/taches/` seulement) ; `server/taches/` peut importer `server/debit/debit.ts` (`purgerCompteurs`), `server/db/comptes.ts`, `server/env.ts`, `server/erreurs/code-postgres.ts`, `node:crypto`.
- **Les quatre tests d'attaque obligatoires** (`PLAN.md` 4.3) : « sans session » devient « sans secret, secret forgé ou mal formé » ; « autre organisation » et « rôle insuffisant » sont sans objet (aucune organisation, aucun rôle) ; « entrée falsifiée » devient « secret dans la requête, méthode autre que `GET`, nom de tâche inconnu ou encodé ».
- **Matrice des droits** : aucune ligne. **Tables** : aucune créée ni modifiée ; `compteur_debit` et `user` sont dans `TABLES_SANS_ORGANISATION`. Le rôle `app_facturation` a déjà `DELETE` sur les deux (tests d'intégration de la 0.5 et de la 1.1).

## Dépendances nouvelles

Aucune. `node:crypto` est fourni par Node.js 24.

## Migration

Aucune. Le dossier `drizzle/` n'est pas touché.

## Critères d'acceptation

- [ ] `vercel.json` ne contient que `crons`, une entrée, `/api/taches/quotidienne`, une expression quotidienne.
- [ ] Sans `Authorization`, avec un secret forgé, avec `bearer` en minuscules, avec un espace en trop, avec le secret seul ou dans la requête : même statut, mêmes en-têtes propres, même corps qu'une tâche inexistante ; aucune étape lancée ; aucune ligne au journal.
- [ ] Secret non configuré : tout appel est refusé, `Bearer `, `Bearer null` et `Bearer undefined` compris.
- [ ] Comparaison sur deux empreintes SHA-256 par `timingSafeEqual` ; aucune exception pour un en-tête de longueur quelconque.
- [ ] En production, `CRON_SECRET` absente, vide, trop courte ou hors de l'alphabet `base64url` : configuration refusée, message sans la valeur ; hors production, absente : `null`.
- [ ] Appel autorisé : les deux étapes, dans l'ordre, chacune lancée même si l'autre échoue ; 200 `{"ok":true}` ou 500 `{"ok":false}` ; `Cache-Control: no-store`.
- [ ] Journal : une ligne par étape, champs de la section 3.3 seulement ; une erreur dont le message contient une adresse email et une requête SQL n'en laisse rien passer.
- [ ] Deux appels successifs ou simultanés : aucune erreur, même état final.
- [ ] `controle-deploiement.mjs` : les contrôles `tache:*` passent sur le site construit en local et échouent seuls sur le défaut correspondant d'un serveur factice.
- [ ] Route sur la liste admise du test d'inventaire, forme exacte vérifiée ; règle U vérifiée.
- [ ] `npm run verifier` et `npm run test:integration` verts, sorties montrées.
- [ ] Preuves sur Vercel faites et notées (section 5, points 3 à 5).

## Tests à écrire

Dans cet ordre, chacun vu en échec avant le code.

### Tests unitaires et d'attaque, sans base

1. [ ] **Comparaison du secret** — `src/server/taches/secret.test.ts` : `secretValide` vrai pour `Bearer <secret>` exact ; faux pour en-tête absent, vide, `Bearer`, `Bearer `, `bearer <secret>`, `Bearer  <secret>`, `Bearer <secret> `, `<secret>` seul, préfixe du secret, secret suivi d'un caractère, secret de même longueur différent au dernier caractère, en-tête de 64 Kio ; secret `null` : faux pour `Bearer `, `Bearer null`, `Bearer undefined` ; aucune exception. Espion sur `timingSafeEqual` : appelé une fois par comparaison, sur deux tampons de 32 octets, secret `null` compris.
2. [ ] **Refus indiscernable** — `src/server/taches/quotidienne.attaque.test.ts` (étapes factices espionnées, console espionnée) : pour chaque refus du critère 2, plus secret correct sur une tâche inconnue, sur `QUOTIDIENNE`, `quotidienne.`, `__proto__`, `constructor` (liste fermée lue par `Object.hasOwn`) : réponse égale à celle de `/api/taches/<nom aléatoire>` sans secret (statut, en-têtes, corps lu en octets) ; étapes jamais appelées ; aucune écriture sur la console. Témoin : le secret correct sur `quotidienne` lance les étapes (sinon le test ne prouverait rien).
3. [ ] **Configuration** — `src/server/env-schema.test.ts`, ajouts : `validerSecretTache` en production sans variable, vide, de 31 caractères, avec espace, retour à la ligne, guillemet : refus, message `CRON_SECRET : <raison>` sans la valeur ; 32 et 256 caractères valides acceptés, 257 refusé ; hors production, absente : `null` ; `VERCEL_ENV` absent (local) : `null`.
4. [ ] **Exécution** — `src/server/taches/quotidienne.test.ts` : ordre des étapes ; première étape qui lève, la seconde est lancée, 500 `{"ok":false}` ; les deux réussissent : 200 `{"ok":true}` ; `Cache-Control: no-store` sur toutes les réponses ; lignes de journal exactes (champs, types) ; erreur levée avec `message` contenant `awa.kone@exemple.invalid`, `delete from "user"`, `params:` et une pile : aucun de ces textes dans la sortie ; erreur hostile (accesseur `constructor` qui lève, `Proxy`) et console qui lève : la tâche ne lève pas, ligne de repli fixe.
5. [ ] **Planification** — `src/server/taches/vercel-json.test.ts` : `vercel.json` lu et analysé ; seules les clés `$schema` et `crons` ; une entrée ; `path` égal à `/api/taches/quotidienne` ; `schedule` de la forme `<minute> <heure> * * *` avec minute 0 à 59 et heure 0 à 23 (une expression plus fréquente ferait échouer le déploiement Hobby) ; le nom de la tâche figure dans `TACHES`.
6. [ ] **Inventaire** — `src/server/actions/inventaire.test.ts` : `api/taches/[tache]` remplace `api/taches/quotidienne` dans la liste admise, avec cette fiche ; `route.ts` de cette route a exactement la forme de la section 2.1 (seul export `GET`, égal à `traiterTache`).
7. [ ] **Règle U** — `regles-import.test.ts` : `server/taches/` importé depuis `route.ts` de `api/taches/` : accepté ; depuis une page, une action, `server/services/` : refusé ; `db/comptes.ts` et `purgerCompteurs` importés depuis `server/taches/` : acceptés ; ailleurs : refusés ; chargement dynamique compris.

### Tests d'intégration, avec base

8. [ ] `src/server/db/tache-quotidienne.integration.test.ts` (dans `db/`, qui peut importer `db` pour préparer les lignes) : gestionnaire réel avec un secret de test injecté et les vraies étapes. Préparation : une ligne de `compteur_debit` expirée et une en cours, sous des clés propres au test ; un utilisateur non vérifié de 8 jours, un de 6 jours, un vérifié de 8 jours (`test-<uuid>@exemple.test`). Appel autorisé : 200 ; seules la ligne expirée et le non vérifié de 8 jours disparaissent. Second appel : 200, état inchangé. Deux appels simultanés sur une nouvelle préparation : deux 200, même état final. Appel refusé : rien ne disparaît. Nettoyage par `nettoyerMembres` et suppression des clés du test, dans un `finally` ; un seul `Pool`, aucun `Pool` dédié.

### Tests de bout en bout

9. [ ] `e2e/tache-quotidienne.attaque.spec.ts` (`ordinateur-1280`, site construit) : `playwright.config.ts` tire un `CRON_SECRET` aléatoire à chaque exécution (jamais écrit) et le passe au serveur du port 3000 et aux tests. Refus du critère 2 et tâche inconnue : même statut, même corps, mêmes en-têtes hors politique (nonce) ; `POST`, `PUT`, `DELETE` sur `quotidienne` et sur une tâche inconnue : même réponse l'une que l'autre. Appel autorisé : 200 `{"ok":true}`. Le serveur du port 3101 (configuration factice, base injoignable) : appel sans secret, 404 identique ; ce serveur n'a pas de secret, l'appel « autorisé » y est donc impossible.
10. [ ] **Contrôle après déploiement** — `e2e/controle-deploiement.spec.ts`, serveur factice : conforme, les contrôles `tache:*` passent ; défauts, chacun faisant échouer le seul contrôle attendu : `quotidienne` en 200 sans secret, en 401 (réponse de l'exemple de Vercel), corps différent avec le secret forgé, corps différent de la tâche inconnue, `X-Powered-By` sur cette seule réponse, chemin de fichier dans son corps ; l'en-tête `Authorization` n'est envoyé qu'à `/api/taches/quotidienne`, avec une valeur différente à chaque passage, jamais affichée (`--detail` compris). Site construit en local : tout passe.

### Vérifications manuelles (développeur)

- [ ] Secret posé en Production et en Preview, avant la fusion (section 4).
- [ ] Preuves de la section 5, points 2 (facultatif) à 5.

## Fichiers concernés

| Fichier | Changement |
|---|---|
| `vercel.json` | Nouveau : `crons` |
| `src/app/api/taches/[tache]/route.ts` | Nouveau : une ligne |
| `src/server/taches/quotidienne.ts` | Nouveau : `creerTraitementTache`, `traiterTache`, `reponseInexistante`, `TACHES` |
| `src/server/taches/secret.ts` | Nouveau : `secretValide` |
| `src/server/taches/etapes.ts` | Nouveau : les deux étapes, consignation |
| `src/server/env-schema.ts`, `src/server/env.ts` | `validerSecretTache`, `secretTache` |
| `.env.example` | `# CRON_SECRET=`, en commentaire |
| `eslint.config.mjs` | Règle U |
| `src/server/actions/inventaire.test.ts` | Liste admise, forme exacte de la route |
| `playwright.config.ts` | `CRON_SECRET` aléatoire pour le serveur du port 3000 |
| `scripts/controle-deploiement.mjs` | Page `tache` |
| `e2e/tache-quotidienne.attaque.spec.ts`, `e2e/controle-deploiement.spec.ts` | Nouveaux tests |
| `docs/THREATS.md` | T-45 ; 7.2 inchangée (déjà « Automatique ») |
| `docs/STRUCTURE.md` | `api/taches/[tache]/`, `server/taches/`, section 7 |
| `docs/features/chaine-controles.md` section 7, `docs/features/controle-deploiement.md` | Liste admise ; page `tache`, exception `Authorization` |
| `docs/CONFIGURATION.md` | Étape 10 : `CRON_SECRET`, procédure de la section 4 |
| `docs/PLAN.md` | Jalon 1 : tâche quotidienne en service |
| `CLAUDE.md` | Commande et exception du contrôle ; piège « `CRON_SECRET` obligatoire en production, à poser avant la fusion » |

## Reporté

- **8.3, reste** : purge des sessions expirées depuis plus de 30 jours (`THREATS.md` 7.2) ; purge des invitations expirées (2.3) ; signalement des relances (jalon 6), qui demandera le parcours des organisations une par une (`DESIGN.md`, section 2) et un verrou si la durée approche celle d'une fonction.
- **8.1** : alerte si la tâche n'a pas tourné ou a échoué (Vercel ne réessaie pas et ne prévient pas).
- **1.1, PR 2** : rien à ajouter ici ; elle attend que la tâche soit en service (section 5, point 5).

## Limites connues

- **Passage manqué ou en échec** : Vercel ne réessaie pas, et rien ne prévient avant la 8.1. Un compte non vérifié peut vivre environ 9 jours, une ligne de `compteur_debit` environ 49 heures.
- **Imprécision d'une heure** (offre Hobby) : passage entre 03:00 et 03:59 UTC.
- **Le contrôle après déploiement ne prouve pas que la tâche tourne** : seulement qu'elle refuse ce qu'elle doit refuser (section 6).
- **Le nom de la route est observable** : `/api/taches/<nom>` répond 404 au corps vide, une adresse sans page répond la page « introuvable ». Le nom est public (`vercel.json`, dépôt public), comme ceux des pages (`THREATS.md` RR-11).
- **Secret en production obligatoire** (si la décision 1 est retenue) : une suppression accidentelle de la variable fait tomber la production au déploiement suivant. Le contrôle après déploiement le voit aussitôt (`/` en 500).
- **Presse-papiers** : la valeur y passe pendant quelques secondes (section 4).

## Décisions à prendre

Deux vrais choix, chacun avec la recommandation de l'assistant.

1. **`CRON_SECRET` absente en production.**
   - a. **Configuration refusée : tout le site tombe** (comme `GMAIL_*`). Recommandé : un oubli se voit au premier déploiement (contrôle après déploiement en échec, « Instant Rollback ») au lieu de laisser, en silence, la purge ne jamais tourner pendant que les limites par adresse IP remplissent `compteur_debit`. Prix : poser la variable avant la fusion, comme pour Gmail.
   - b. Route seule refusée, site intact. Plus doux, mais la panne ne se voit que dans les journaux de Vercel, que personne ne lit chaque jour.
2. **Forme de la route.**
   - a. **`api/taches/[tache]`, liste fermée des tâches** : un refus est identique, octet pour octet, à une tâche inexistante, en local comme sur Vercel (section 2.1). Recommandé. Change l'entrée de la liste admise (`api/taches/quotidienne` devient `api/taches/[tache]`).
   - b. `api/taches/quotidienne` avec `notFound()` : chemin prévu par `STRUCTURE.md`, mais l'égalité avec une adresse sans page n'est pas garantie et pourrait différer entre `next start` et Vercel, comme en 0.8 ; à constater, sans parade si elle diffère.

## Décisions par défaut

Appliquées par l'assistant le 2026-10-13, selon sa recommandation, sauf avis contraire du relecteur.

1. **Vercel Cron**, une entrée, `0 3 * * *` UTC (section 1.2).
2. **Comparaison** sur empreintes SHA-256 par `timingSafeEqual`, `node:crypto`, toujours calculée (section 2.2).
3. **Refus** : 404, corps vide, `no-store`, aucune ligne au journal ; seul `GET` exporté ; rien d'autre que `Authorization` n'est lu (section 2.1).
4. **Secret** : `validerSecretTache` à part de `validerEnvironnement` ; 32 à 256 caractères `base64url` (section 2.3).
5. **Deux valeurs**, Production et Preview, type Secret, posées par le développeur depuis le presse-papiers, sans fichier (section 4).
6. **Étapes** indépendantes, dans l'ordre compteurs puis comptes ; 500 si l'une échoue (section 3.1).
7. **Aucun verrou, aucune limite de débit** sur la route (sections 3.2 et « Alternatives écartées »).
8. **Journal** à champs choisis, une ligne par étape, rien pour un refus (section 3.3).
9. **Contrôle après déploiement** : page `tache`, `Authorization` forgé en seconde exception (section 6).
10. **Bout en bout** : un `CRON_SECRET` aléatoire par exécution de Playwright ; l'appel autorisé purge la base de test, ce qui est l'effet voulu de la tâche (test 9).
11. **Règle ESLint U** et mise à jour de `STRUCTURE.md` section 7 (« Règles de sécurité »).
12. **Une seule PR**, sans découpage : rien n'est exposé qui ne soit protégé dès la fusion.

## Notes de l'implémentation

Aucune pour l'instant.
