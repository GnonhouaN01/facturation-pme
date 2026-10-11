# Fonctionnalité : limitation de débit

Statut : livrée (PR #32, fusionnée le 2026-10-11, CI verte)

Jalon 0, fonctionnalité 0.5 de `docs/PLAN.md`. Taille S, à sa limite haute ; une seule PR (décision 9).

## Contexte

Cette fonctionnalité sert au développeur. Elle fournit le mécanisme que les fonctionnalités suivantes utiliseront pour limiter le nombre de tentatives : connexion et réinitialisation (jalon 1, S-11), pages publiques (jalon 4, S-22), envoi d'emails (0.7 et suivantes, S-55), opérations coûteuses (S-84).

Aujourd'hui :

- La 0.4 est livrée : ses trois PR (#29, #30, #31) sont fusionnées et la CI est verte. La chaîne de contrôles réserve l'étape 4 à la limitation de débit (`chaine-controles.md`, sections 5 et 11 ; `DESIGN.md` section 3.2). Dans le code, l'étape 4 est un commentaire de `src/server/actions/action.ts`, placé **après** la lecture de la session (étape 2) et le contrôle de l'organisation active (étape 3), et **avant** l'ouverture de la transaction (étape 5).
- La table `compteur_debit` existe sur `dev`, `preview` et `production` depuis la première migration (`drizzle/20261003092117_bumpy_darkstar`). Elle n'a jamais été utilisée. Elle n'a pas de colonne `organisation_id` ni de règle d'isolation (`DESIGN.md` section 2.3 : « la seule table sans `organisation_id`, car elle compte aussi des visiteurs anonymes »).
- `docs/STACK.md` : « Extension de Better Auth pour les connexions, table de compteurs dans PostgreSQL pour le reste ». Aucun service extérieur.
- Le registre des actions est vide. Aucune action réelle, aucune route exposée.

Cas d'utilisation concernés : aucun directement. Abus repris de `USECASES.md` : créer des comptes en masse, inonder la boîte de quelqu'un, envoyer du courrier indésirable par l'application, deviner des liens publics, harceler un client par des relances. Ils seront parés par les fonctionnalités qui les portent, avec le mécanisme livré ici.

## Problème

- Rien ne compte les tentatives. Un membre connecté peut enchaîner une action autant qu'il veut (T-41, T-42).
- Les fonctionnalités à venir ont toutes besoin du même compteur. Écrit dans chacune, il serait écrit plusieurs fois, avec autant de façons de se tromper : incrément perdu sous la concurrence, compteur annulé avec l'action, clé en clair.
- Les limites n'existent nulle part. Rien ne garantit qu'une valeur se lise et se relise à un seul endroit.

## Solution retenue

Trois éléments :

| Élément | Fichier | Rôle |
|---|---|---|
| Les limites | `src/server/debit/limites.ts` | Source unique : nom, maximum, fenêtre, ce que la clé désigne |
| La fonction réutilisable | `src/server/debit/debit.ts`, `src/server/debit/cle.ts`, `src/server/db/debit.ts` | Compte une tentative pour une clé et une fenêtre, dit si la limite est atteinte |
| Le branchement | `src/server/actions/action.ts`, `refus.ts` | Étape 4 de la chaîne ; champ `debit` de la déclaration |

### 1. Les limites, dans un seul fichier

```ts
// src/server/debit/limites.ts
export const LIMITES = {
  "membre.action": { maximum: 60, fenetreSecondes: 60, par: "utilisateur" },
} as const satisfies Record<string, Limite>;

export type NomLimite = keyof typeof LIMITES;
```

- Un nom est une chaîne de `[a-z_.]` ; il apparaît en clair dans la clé (section 3). Il ne contient jamais `:`.
- `par` dit ce que la clé désigne. En 0.5, une seule valeur : `"utilisateur"`. Les autres (`"organisation"`, `"adresse_ip"`, `"email"`) arriveront avec leur premier usage (section 9).
- Une seule limite en 0.5, pour les actions des membres. Valeur : 60 tentatives par minute et par utilisateur (décision 4). Chaque fonctionnalité qui en ajoute une le fait dans ce fichier, dans sa PR.
- `FENETRE_MAX_SECONDES` est calculé depuis `LIMITES` : il sert à la purge (section 7).
- Test sans base : chaque limite a un maximum et une fenêtre entiers et positifs, un nom au bon format, et la fenêtre la plus longue ne dépasse pas 24 heures.

### 2. La fonction réutilisable

Deux couches, pour que la requête reste dans `src/server/db/` (règle 4 de `CLAUDE.md`) :

```ts
// src/server/debit/debit.ts
verifierDebit(nom: NomLimite, valeur: string): Promise<boolean>; // vrai : sous la limite
```

1. `cleCompteur(nom, valeur)` (`cle.ts`, fonction pure) calcule la clé (section 3).
2. `consommer(cle, { maximum, fenetreSecondes })` (`src/server/db/debit.ts`) exécute **une seule instruction** SQL (section 4) et renvoie le compte après l'incrément.
3. `verifierDebit` renvoie `compte <= maximum`.

`src/server/db/debit.ts` suit le modèle de `creerAcces` : une fabrique `creerCompteur(base)` pour les tests (un `Pool` de plusieurs dizaines de connexions pour la concurrence), et une instance liée à `db`.

Tout le temps vient de la base (`now()`), jamais de l'horloge de l'application : les fonctions de Vercel ne partagent pas d'horloge, et un écart entre deux instances fausserait les fenêtres.

#### 2.1 Incrémenter même quand l'action échoue

L'action s'exécute dans la transaction de l'étape 5. Une erreur l'annule : tout ce qui y est écrit disparaît. Un compteur écrit dans cette transaction serait donc remis à zéro par chaque échec, et un attaquant qui provoque des échecs ne serait jamais compté.

| Option | Avis |
|---|---|
| **C1. Compter à l'étape 4, avant l'ouverture de la transaction, par une instruction propre validée aussitôt** | L'étape 4 est déjà hors de la transaction. L'instruction s'exécute sur `db`, en validation automatique : elle est acquise avant que l'action commence, quoi qu'il arrive ensuite. N'utilise ni `executerDansOrganisation` (règle I : la table n'a pas de règle d'isolation, aucune organisation à fixer) ni le réglage `app.organisation_id` (règle K). `db` reste dans `src/server/db/`. **Recommandé** |
| C2. Compter dans la transaction de l'action | Annulé avec elle. Écarté |
| C3. Compter dans la transaction, par une seconde connexion | Tient deux connexions par action. Le `Pool` de `client.ts` a 10 connexions et attend sans délai (`connectionTimeoutMillis` par défaut à 0) : dix actions simultanées qui tiennent chacune leur transaction et attendent une seconde connexion se bloquent mutuellement. Écarté |
| C4. Transaction autonome (`dblink`, fonction en `SECURITY DEFINER`) | PostgreSQL n'a pas de transaction autonome native. `dblink` est une extension et un second canal ; une fonction `SECURITY DEFINER` contourne les droits du rôle. Écarté |
| C5. Compter après coup, seulement en cas d'échec | Ne compte pas les réussites : une action réussie répétée n'est jamais limitée (T-41). Utile pour la connexion (`DESIGN.md` section 3.1), qui relève de Better Auth (section 8). Écarté pour la chaîne |

Conséquences de C1 :

- Toute tentative qui passe l'étape 3 est comptée : celle refusée ensuite par l'adhésion ou le rôle (étape 6), l'entrée invalide (étape 9), l'action dont le service échoue. C'est voulu : on compte les tentatives, pas les réussites.
- Une requête sans session ou sans organisation active n'est pas comptée : elle est refusée avant, sans écriture. Elle coûte une lecture de session (`connexion_requise`). Un déluge anonyme relève des protections de l'hébergeur (RR-5 de `THREATS.md`).
- **Règle d'emploi** : `verifierDebit` ne s'appelle jamais pendant une transaction ouverte (raison de C3). La chaîne l'appelle à l'étape 4, avant l'étape 5. Un service, qui s'exécute dans la transaction, ne l'appelle pas en 0.5 (section 9, S-55).

### 3. La clé : une empreinte, jamais la valeur en clair

La clé désigne celui qu'on compte : un utilisateur aujourd'hui, demain une adresse IP ou un email. Ces deux derniers sont des données personnelles ; l'identifiant d'un utilisateur l'est aussi, sous forme de pseudonyme.

| Option | Avis |
|---|---|
| K1. En clair (`membre.action:<uuid>`, `page_publique:203.0.113.7`) | Lisible pour le diagnostic. Mais la table devient un registre des adresses IP et des emails, sans finalité au-delà de la fenêtre. À ajouter à l'inventaire de `THREATS.md` section 7.2. Écarté |
| K2. Empreinte SHA-256 sans secret | Réversible en pratique : l'espace des adresses IPv4 (2³² valeurs) se parcourt en quelques minutes, et un email se devine par dictionnaire. Écarté |
| **K3. HMAC-SHA-256 avec une clé secrète** | Irréversible sans la clé. Longueur fixe, quelle que soit la valeur reçue. Aucune collision par séparateur : la valeur n'est jamais concaténée en clair. **Recommandé** |

Forme : `<nom de la limite>:<HMAC-SHA-256(clé, nom + "\0" + valeur), en hexadécimal>`, soit le nom suivi de 64 caractères. Le nom reste en clair : il ne désigne personne, et il permet de purger ou d'observer par limite. Le nom entre aussi dans l'empreinte : une même valeur donne des clés sans rapport d'une limite à l'autre.

Toute l'empreinte est calculée par `cleCompteur`, avec `node:crypto` (`createHmac`), sans dépendance. Les valeurs sont normalisées avant l'empreinte par la fonctionnalité qui les fournit (section 9) : adresse IPv6 ramenée à son préfixe /64, adresse IPv4 dans IPv6 ramenée à IPv4, email sans espaces et en minuscules.

**Quelle clé secrète.**

| Option | Avis |
|---|---|
| **S1. Dérivée de `BETTER_AUTH_SECRET` par HKDF** (`hkdfSync("sha256", secret, "", "facturation-pme/compteur-debit/v1", 32)`, `node:crypto`), une fois au chargement du module | Aucune variable nouvelle. La dérivation sépare les usages : connaître la clé dérivée ne révèle rien du secret de Better Auth. Un secret différent par environnement (S-83), donc des empreintes différentes. **Recommandé** |
| S2. Variable nouvelle, `DEBIT_SECRET` | Renouvelable seule. Mais une variable de plus dans `env-schema.ts`, sur Vercel pour deux environnements, dans la CI et dans `.env.local`, pour un gain faible |
| S3. `BETTER_AUTH_SECRET` utilisé tel quel | Un même secret pour deux usages. Écarté |

**Si le secret change** (renouvellement de `BETTER_AUTH_SECRET`, S-83) : toutes les empreintes changent. Chaque compteur repart de zéro une fois ; les anciennes lignes ne sont plus jamais lues et disparaissent à la purge (section 7). Effet : un attaquant gagne au plus une fenêtre neuve, au moment du renouvellement, qu'il ne choisit pas. Accepté. Le renouvellement de `BETTER_AUTH_SECRET` ferme déjà toutes les sessions, effet bien plus visible. Le suffixe `v1` de l'étiquette permet de changer de dérivation sans toucher au secret.

### 4. Un incrément atomique

Une seule instruction, paramètres liés (S-86), écrite avec le constructeur de requêtes de Drizzle (`insert ... onConflictDoUpdate ... returning`) :

```sql
INSERT INTO "compteur_debit" AS c ("cle", "compte", "fenetre_debut")
VALUES ($1, 1, now())
ON CONFLICT ("cle") DO UPDATE SET
  "compte" = CASE
    WHEN c."fenetre_debut" <= now() - make_interval(secs => $2) THEN 1
    ELSE LEAST(c."compte" + 1, $3 + 1)
  END,
  "fenetre_debut" = CASE
    WHEN c."fenetre_debut" <= now() - make_interval(secs => $2) THEN now()
    ELSE c."fenetre_debut"
  END
RETURNING "compte";
-- $1 : clé ; $2 : fenêtre en secondes ; $3 : maximum. Autorisé si compte <= $3.
```

- `INSERT ... ON CONFLICT DO UPDATE` est garanti atomique par PostgreSQL : deux requêtes simultanées sur une clé neuve donnent une insertion et une mise à jour, jamais deux insertions ni une erreur. Sur une clé existante, la mise à jour verrouille la ligne : les requêtes suivantes attendent et lisent le compte déjà incrémenté. Cent requêtes simultanées comptent pour cent.
- Dans `SET`, les deux `CASE` lisent l'ancienne ligne (`c.`) : la remise à zéro et le nouveau début de fenêtre sont décidés sur la même valeur.
- `LEAST(..., maximum + 1)` plafonne le compte : un attaquant qui insiste ne fait pas déborder l'`integer`, et le compte ne dit rien de son insistance.
- Écarté : lire puis écrire (`SELECT` puis `UPDATE`), même dans une transaction en `READ COMMITTED` : deux requêtes lisent la même valeur et en perdent une. Le test de concurrence le prouve (section « Tests d'intégration »).
- Une clé très demandée sérialise ses requêtes sur le verrou de la ligne. L'instruction est courte (une ligne, par sa clé primaire) : accepté. C'est d'ailleurs l'effet recherché pour un attaquant.

### 5. Fenêtre fixe, ancrée sur la première tentative

| Option | Avis |
|---|---|
| **F1. Fenêtre fixe, qui commence à la première tentative après expiration** (forme de la table actuelle : `compte`, `fenetre_debut`) | Une ligne par clé, une instruction. Défaut connu : jusqu'à deux fois le maximum autour de la fin d'une fenêtre (le maximum à la fin de l'une, le maximum au début de la suivante). Se compense en fixant le maximum en conséquence. C'est aussi la forme de Better Auth (section 8). **Recommandé** |
| F2. Journal glissant : une ligne par tentative | Exact, mais une ligne par requête : un attaquant remplit la table au rythme de ses requêtes. Écarté |
| F3. Fenêtre glissante approchée (deux compteurs pondérés) | Plus juste aux bords, mais une colonne de plus (migration) et une instruction plus complexe. Écarté en 0.5, possible plus tard sans changer l'interface de `verifierDebit` |

### 6. Si la base ne répond pas

| Option | Avis |
|---|---|
| **P1. Refuser (fermé par défaut), partout** : une erreur de `consommer` remonte et devient `erreur` avec un incident (`chaine-controles.md` section 6.3) | Dans la chaîne, la question est presque théorique : l'étape 2 vient de lire la session en base, et l'étape 5 en a besoin. Si la base ne répond pas, l'action échoue de toute façon. Pour l'envoi d'emails (S-55, T-40), laisser passer ouvrirait la porte que la limite ferme. **Recommandé** |
| P2. Laisser passer, réglable par limite (`siIndisponible: "laisser"`) | Se défend pour une lecture sans coût, quand seul le compteur est en difficulté (verrou très disputé). Aucun cas en 0.5. Le champ s'ajoute le jour où une fonctionnalité en a besoin, avec sa justification dans sa fiche |

Une erreur du compteur n'est pas confondue avec un refus de débit : elle donne `erreur` et un incident, pas `trop_de_requetes`.

### 7. Une table sans `organisation_id`, et sa protection

**Pourquoi c'est correct.** Le compteur ne contient aucune donnée d'une organisation : il compte des tentatives. Une même clé traverse les organisations (un utilisateur membre de deux organisations a un seul compteur « membre.action ») ou n'en a aucune (visiteur d'une page publique, inscription). `organisation_id NOT NULL` y serait faux. La règle 3 de `CLAUDE.md` vise les tables métier ; celle-ci est technique, comme les tables de Better Auth.

**Ce qui la protège à la place.**

| Protection | État |
|---|---|
| Contenu sans donnée personnelle : nom de limite, empreinte, nombre, date (section 3) | Livré par la 0.5 |
| Droits du rôle `app_facturation` : `SELECT, INSERT, UPDATE, DELETE` par les droits par défaut ; pas de `TRUNCATE`, vérifié pour toute table par le test d'inventaire existant (`schema-isolation.integration.test.ts`) | Existant. Vérifié par le développeur le 2026-10-11 sur `dev`, `preview` et `production` : `SELECT`, `INSERT`, `UPDATE`, `DELETE` accordés sur les trois (décision 10). L'absence de `TRUNCATE` est vérifiée par le test d'inventaire |
| Un seul fichier touche la table : `compteurDebit` ne s'importe que dans `src/server/db/debit.ts` et les tests, et `src/server/db/debit.ts` ne s'importe que dans `src/server/debit/` et les tests. Nouvelle règle ESLint N, vérifiée par `regles-import.test.ts` | Livré par la 0.5 |
| Aucune remise à zéro par le code : seules deux instructions existent, l'incrément (section 4) et la purge des lignes expirées. Aucune fonction ne supprime ni ne modifie une clé donnée | Livré par la 0.5 |
| Inventaire des tables sans `organisation_id` : la liste est exactement les huit tables de Better Auth (`user`, `session`, `account`, `verification`, `two_factor`, `organization`, `member`, `invitation`) et `compteur_debit` (`TABLES_SANS_ORGANISATION`). Aujourd'hui, le test d'inventaire ne voit que les tables qui portent `organisation_id` : une table métier qui l'oublierait lui échapperait | Livré par la 0.5 (ajout au test d'inventaire) |

Écarté : activer la règle de sécurité au niveau des lignes sans politique. Le rôle de l'application, qui n'est pas propriétaire, ne verrait plus aucune ligne ; il faudrait une politique `USING (true)`, qui ne protège rien.

**Purge.** Sans purge, chaque clé laisse une ligne pour toujours. Avec des clés par utilisateur, la table reste petite (utilisateurs × limites, environ 100 octets par ligne). Avec des clés par adresse IP ou par email (jalon 1, limitation des connexions), un attaquant qui change d'adresse ajoute une ligne par adresse.

- La 0.5 livre `purgerCompteurs()` dans `src/server/db/debit.ts` : `DELETE FROM "compteur_debit" WHERE "fenetre_debut" < now() - make_interval(secs => $1)`, avec `$1` = `FENETRE_MAX_SECONDES`. Une ligne plus vieille que la plus longue fenêtre ne peut plus servir. Testée, appelée par personne en 0.5.
- La tâche quotidienne l'appelle une fois par jour.
- Le premier compteur par adresse IP ou par email arrive au jalon 1, avec la limitation des connexions. La tâche quotidienne, prévue en 8.3, est donc avancée au jalon 1, avant la mise en service de cette limitation (décision 6, inscrite dans `PLAN.md`).
- Pas d'index sur `fenetre_debut` : une purge quotidienne parcourt une petite table.

### 8. Better Auth 1.7.7 et sa propre limitation de débit

Lu dans `node_modules/better-auth/dist/api/rate-limiter/index.mjs`, `api/index.mjs`, `context/create-context.mjs`, `plugins/two-factor/index.mjs`, et `node_modules/@better-auth/core/dist/utils/ip.mjs`, `env/env-impl.mjs`, `types/init-options.d.mts` :

- **Où elle s'applique.** Dans le routeur de Better Auth, au début de chaque requête HTTP vers sa route (`api/index.mjs` ligne 172, `onRequestRateLimit`). Pas sur les appels serveur `auth.api.*` : la lecture de la session par la chaîne (`getSession`) n'est jamais limitée par elle. Aujourd'hui `/api/auth` n'est pas exposée : elle ne s'applique à rien.
- **Quand.** Activée par défaut seulement si `NODE_ENV === "production"` (`create-context.mjs` ligne 172 ; `env-impl.mjs` ligne 32). Désactivée en local et en test.
- **Limites par défaut.** 100 requêtes par 10 secondes (`create-context.mjs` lignes 173 et 174). Règles spéciales (`rate-limiter/index.mjs` lignes 305 à 318) : `/sign-in`, `/sign-up`, `/change-password`, `/change-email` à 3 par 10 secondes ; `/request-password-reset`, `/send-verification-email`, `/forget-password` à 3 par 60 secondes. L'extension `twoFactor` ajoute `/two-factor/*` à 3 par 10 secondes (`plugins/two-factor/index.mjs` lignes 338 à 344).
- **Clé.** `<adresse IP>|<chemin>` en clair (`ip.mjs` ligne 229). Compte toutes les requêtes, réussies ou non.
- **Stockage.** Par défaut `"memory"` (`create-context.mjs` ligne 175) : une `Map` du processus (`rate-limiter/index.mjs` ligne 6). Sur Vercel, chaque instance de fonction a la sienne, perdue au démarrage à froid : la limite n'est pas tenue. `"database"` ajoute une table `rateLimit` au schéma de Better Auth (`@better-auth/core/dist/db/get-tables.mjs` ligne 33), avec la clé en clair. `customStorage` accepte tout objet qui fournit `consume(key, { window, max })` et renvoie `{ allowed, retryAfter }`, en une étape atomique (`init-options.d.mts` lignes 142 à 166).
- **Adresse IP.** Lue dans `x-forwarded-for` par défaut (`ip.mjs` ligne 196), réglable par `advanced.ipAddress.ipAddressHeaders`. Sans `trustedProxies`, seule une valeur unique est acceptée ; une liste est refusée (`ip.mjs` lignes 190 à 193). Adresse introuvable : `127.0.0.1` en développement et en test, `null` en production (`ip.mjs` lignes 217 et 218). **En production sans adresse, tous les visiteurs partagent un seul compteur par chemin** (`no-trusted-ip`, `rate-limiter/index.mjs` lignes 236 à 248) : trois tentatives de connexion par 10 secondes pour toute l'application.
- **Refus.** Code 429, message `Too many requests`, en-tête `X-Retry-After` (lignes 64 à 73).

**Coexistence au jalon 1.**

| Option | Avis |
|---|---|
| B1. Stockage par défaut (`"memory"`) | Inefficace sur Vercel. Écarté |
| B2. `storage: "database"` | Une seconde table de compteurs, adresses IP en clair, seconde purge. Le schéma `auth.ts` serait à régénérer. Écarté |
| **B3. `customStorage` branché sur `consommer` de la 0.5** | Une seule table, des empreintes, une seule purge. Better Auth garde ses règles par chemin et son point d'entrée ; seule la mémoire change. **Retenu** (validé avec la fiche), mis en œuvre par la 1.1 |

La fiche 1.1 tranche aussi : activer explicitement (`rateLimit.enabled: true`), pour ne pas dépendre de `NODE_ENV` ; régler `ipAddressHeaders` sur la même source d'adresse que la nôtre (ci-dessous) ; l'écart avec `DESIGN.md` section 3.1, qui n'incrémente le compteur de connexion qu'en cas d'échec alors que Better Auth compte toutes les tentatives ; la réponse 429 et son `X-Retry-After`, qui révèlent la limite (section 10).

**Ce que la 0.5 garantit pour B3** : `consommer` est atomique, prend la fenêtre en secondes et le maximum, et peut renvoyer ce que demande `consume`. Le calcul de `retryAfter` (fin de fenêtre moins `now()`) et l'empreinte de la clé de Better Auth sont ajoutés par la 1.1.

### 9. L'adresse IP : d'où elle vient, ce que vaut un en-tête

Aucun usage en 0.5 : la chaîne compte par utilisateur. La règle est fixée ici pour le jalon 1 et le jalon 4.

Lu dans `node_modules` :

- **Next.js 16.3.8 ne fournit plus l'adresse.** `request.ip` a été retiré (`next/dist/docs/01-app/02-guides/upgrading/version-15.md` ligne 603 : « these values are provided by your hosting provider »). La documentation renvoie à `ipAddress` de `@vercel/functions` (ligne 605). Ce paquet n'est pas installé : ce serait une dépendance nouvelle (règle 10), pour lire un en-tête. Écarté.
- **Le serveur de Next.js n'écrase pas l'en-tête.** `next/dist/server/base-server.js` ligne 612 : `req.headers['x-forwarded-for'] ??= socket.remoteAddress`. L'adresse de la connexion n'est posée que si l'en-tête est absent. Avec `next dev` ou `next start` sans mandataire devant, **la valeur écrite par le visiteur passe telle quelle**.
- **Sur Vercel** : non documenté dans `node_modules`. La documentation publique de Vercel indique que la plateforme réécrit `X-Forwarded-For` avec l'adresse du client, pour empêcher sa falsification, et pose aussi `x-real-ip`. **À vérifier, pas à croire** : par un essai sur `preview`, à la 1.1, avec un en-tête `X-Forwarded-For` forgé, en lisant ce que reçoit le serveur.

Ce que vaut un en-tête écrit par le visiteur : **rien**, sauf s'il traverse un mandataire qui le réécrit. Règle retenue, à coder avec le premier usage :

- Un seul en-tête lu, fixé dans le code (celui que l'essai sur `preview` aura validé), jamais choisi par la requête.
- Une valeur unique, adresse IPv4 ou IPv6 valide. Une liste ou une valeur invalide est refusée : jamais « la première de la liste », que le visiteur choisit.
- Adresse refusée ou absente : compteur partagé `inconnue`, donc plus strict, jamais « pas de limite ».
- Normalisation avant l'empreinte (section 3).
- En local, l'en-tête est falsifiable : accepté, aucun vrai utilisateur.

La fonction qui l'applique est livrée par la 1.1, avec l'essai sur `preview` (décision 7).

### 10. Le branchement dans la chaîne, et ce que le refus révèle

**Déclaration.** Champ obligatoire, sans défaut, comme `journal` :

```ts
export const modifierRoleMembre = declarerAction({
  nom: "membre.modifier_role",
  droit: "organisation.membres.gerer",
  entree: schemaModifierRole,
  journal: "membre.role_modifie",
  nouvelleAuthentification: true,
  debit: "membre.action",      // NomLimite ou null : champ obligatoire, sans défaut
  executer: async (ctx, entree) => { ... },
});
```

- Le type `NomLimite` refuse un nom inconnu à la compilation ; `declarerAction` le vérifie aussi à l'exécution (`Object.hasOwn(LIMITES, debit)`), comme le droit et l'action du journal.
- `null` est un choix explicite, visible en revue. Il n'est pas un défaut.
- En 0.5, seule une limite `par: "utilisateur"` est acceptée par la chaîne. La valeur comptée est `session.utilisateurId`, lue dans la session vérifiée, jamais dans l'entrée.

**Pourquoi pas l'organisation à l'étape 4.** À l'étape 4, l'organisation active n'est pas encore vérifiée : l'adhésion est relue à l'étape 6. Un membre retiré garde l'organisation active dans sa session jusqu'à la 2.4 (`chaine-controles.md`, section 11). Il serait refusé à l'étape 6, mais compté sur le compteur de l'organisation à l'étape 4 : il pourrait épuiser la limite de toute l'organisation. Compter après l'étape 6 oblige à compter dans la transaction (annulé avec elle) ou par une seconde connexion (blocage du `Pool`, section 2.1). Reporté à la fonctionnalité qui en a besoin (section « Reporté », S-55).

**Dépendance de la chaîne.** `DependancesChaine` reçoit `verifierDebit(nom, valeur)`. Les tests unitaires en passent une factice ; les tests d'intégration la vraie, avec un fichier de limites de test (`limites` passé à `creerChaine`), pour ne pas ajouter de limite de démonstration à `limites.ts`.

**Étape 4** : si la déclaration a un `debit`, `verifierDebit` est appelée ; sous la limite, la chaîne continue à l'étape 5 ; au-delà, elle répond `trop_de_requetes`, sans ouvrir de transaction. `etablirContexte` (lectures des pages) n'a pas d'étape 4 en 0.5 (décision 5, à revoir en 0.6).

**Ce que le refus révèle.**

| Option | Avis |
|---|---|
| R1. `refuse` | L'interface afficherait « introuvable » à un membre qui a simplement trop agi : incompréhensible, et sans effet sur la sécurité, puisque la limite ne protège aucune ressource |
| **R2. `{ ok: false, raison: "trop_de_requetes" }`, sans délai ni compte** | Le membre sait qu'il doit attendre. La réponse est décidée avant toute lecture de l'entrée et de la ressource (étape 4) : elle ne dit rien sur une ressource, ni sur son existence, ni sur son organisation (S-02). Elle ne dit ni la limite, ni la fenêtre, ni le compte, ni le nom de la limite. **Recommandé** |
| R3. R2 avec le délai d'attente (`retryAfter`) | Aide un script à se caler exactement sous la limite. Écarté |

- Le refus est le même pour une action autorisée ou non au membre : un membre au-delà de sa limite reçoit `trop_de_requetes` avant le contrôle du rôle. Il n'apprend pas plus que ce que la matrice rend déjà public.
- Rien n'est écrit au journal d'audit (pas de transaction, pas d'organisation vérifiée), rien au journal technique en 0.5. Le signalement des limites atteintes est reporté à la 8.1.
- `Resultat<T>` (`refus.ts`) gagne la variante `trop_de_requetes` ; le libellé français est la 0.6. Les pages publiques garderont, elles, la réponse unique de `DESIGN.md` section 3.4 (« Ce lien n'est plus valable ») : ce n'est pas la chaîne.

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Service extérieur (Redis, Upstash) | Un service, un compte et un secret de plus (`STACK.md`) |
| Limitation de débit du pare-feu de Vercel | Réglage hors du dépôt, non testable par la CI, offre gratuite limitée. Reste une protection d'hébergeur en plus (RR-5) |
| Compteur en mémoire du processus | Une mémoire par instance de fonction sur Vercel, perdue au démarrage à froid |
| La limitation de Better Auth pour tout | Ne voit que les requêtes vers `/api/auth` |
| Compteur dans la transaction de l'action | Annulé avec elle (section 2.1, C2) |
| Bibliothèque de limitation de débit | Dépendance nouvelle (règle 10) pour une instruction SQL |

## Règles de sécurité et permissions

- Exigences couvertes :
  - **S-84** (opérations coûteuses limitées en débit) : mécanisme livré, et appliqué à toute action de membre qui le déclare, par la chaîne.
  - **S-11, S-22, S-55** : mécanisme livré (fonction, limites, clé en empreinte) ; l'application est faite par les fonctionnalités qui portent ces exigences (section « Reporté »).
  - **S-54** : aucune donnée personnelle dans la table ; rien au journal technique.
  - **S-83** : clé secrète dérivée, différente par environnement, renouvelable avec `BETTER_AUTH_SECRET`.
  - **S-86** : une instruction paramétrée, aucune concaténation.
- Menaces concernées :
  - **T-41** (épuisement des quotas par des requêtes en masse) : limite par utilisateur sur les actions ; comptée même quand l'action échoue.
  - **T-42** (saturation par des requêtes) : en partie. La taille des entrées et la pagination relèvent d'autres fonctionnalités.
  - **T-40** (envoi d'emails en masse) : mécanisme livré. Le plafond d'envoi et son test sont livrés par la 0.7 (`PLAN.md` section 4.5 : test de T-40 au jalon 0).
- Matrice des droits : inchangée. La limitation de débit n'est pas un droit.
- Tables : `compteur_debit`, utilisée, inchangée. Sans `organisation_id` ni règle d'isolation, par conception (section 7). Inscrite dans la liste fermée des tables sans `organisation_id` du test d'inventaire.

## Critères d'acceptation

- [x] `LIMITES` est la seule source des limites ; `verifierDebit` ne prend qu'un `NomLimite` ; aucun maximum ni fenêtre n'est écrit ailleurs dans `src/` hors des tests.
- [x] La clé d'une tentative est `<nom>:<64 caractères hexadécimaux>` ; elle ne contient jamais la valeur comptée ; deux limites donnent deux clés différentes pour une même valeur ; deux secrets différents donnent deux clés différentes.
- [x] Cent appels réellement simultanés sur une clé neuve, maximum 1 000 : compte final 100. Maximum 10 : exactement 10 appels autorisés.
- [x] Une fenêtre expirée repart à 1, avec un nouveau début de fenêtre ; une fenêtre en cours garde son début.
- [x] Le compte ne dépasse jamais `maximum + 1`.
- [x] Une action dont le service lève une erreur, ou refusée à l'étape 6 ou 9, a bien incrémenté le compteur.
- [x] Au-delà de la limite : `trop_de_requetes`, aucune transaction ouverte, aucun service exécuté, aucune trace écrite. La réponse ne contient ni délai, ni compte, ni nom de limite.
- [x] Une erreur du compteur donne `erreur` avec incident, jamais une action exécutée.
- [x] `declarerAction` sans `debit` ne compile pas ; avec un nom inconnu, ne compile pas et lève une exception à l'exécution.
- [x] `purgerCompteurs` supprime les lignes plus vieilles que la plus longue fenêtre de `LIMITES` (`fenetreMaxSecondes`) et seulement elles.
- [x] La règle ESLint N refuse un import de `compteurDebit` hors de `src/server/db/debit.ts`, et de `src/server/db/debit.ts` hors de `src/server/debit/` ; elle accepte les cas permis (`regles-import.test.ts`).
- [x] Le test d'inventaire échoue sur une table sans `organisation_id` hors de `TABLES_SANS_ORGANISATION` (prouvé en retirant temporairement `compteur_debit` de la liste, « Notes de l'implémentation »).
- [x] Le rôle `app_facturation` a `SELECT`, `INSERT`, `UPDATE`, `DELETE` et pas `TRUNCATE` sur `compteur_debit`, sur `dev`, `preview` et `production`. Sur `dev` : prouvé par le test d'inventaire. Sur `preview` et `production` : vérifié par le développeur, `SELECT` à `DELETE` à vrai (décision 10) et `TRUNCATE` à faux (2026-10-11).
- [x] Tout nouveau fichier de `src/server/` commence par `import "server-only";`.
- [x] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` (sur `dev` et en CI) passent. Sur `dev`, constaté le 2026-10-11 ; en CI, constaté sur la PR #32, fusionnée (commit `bf585df`).

## Tests à écrire

Tous écrits avant le code et vus en échec.

### Tests unitaires

`src/server/debit/limites.test.ts` :

- [x] Chaque limite : maximum et fenêtre entiers et positifs, nom au format `[a-z_.]+`, `par` dans la liste admise ; `fenetreMaxSecondes(LIMITES)` égal à la plus longue fenêtre, au plus 24 heures.

`src/server/debit/cle.test.ts` :

- [x] Forme `<nom>:<64 hexadécimaux>` ; valeur absente de la clé ; même entrée, même clé ; autre nom, autre clé ; autre secret, autre clé ; aucune collision par séparateur (`("a", "b:c")` et `("a:b", "c")`) ; valeur très longue : clé de longueur fixe.

`src/server/actions/action.test.ts` (dépendances factices, ajouts) :

- [x] Étape 4 après les étapes 2 et 3, avant l'étape 5 ; refus à l'étape 2 ou 3 : `verifierDebit` non appelée.
- [x] `verifierDebit` appelée avec le nom de la déclaration et l'utilisateur de la session ; jamais avec une valeur de l'entrée.
- [x] Limite atteinte : `trop_de_requetes`, `executerDansOrganisation` non appelée, résultat strictement égal à `{ ok: false, raison: "trop_de_requetes" }`.
- [x] `debit: null` : `verifierDebit` non appelée.
- [x] `verifierDebit` qui lève une erreur : `erreur` avec incident, aucune étape suivante.
- [x] `@ts-expect-error` : déclaration sans `debit`, avec un nom inconnu ; exception à l'exécution pour un nom inconnu passé par transtypage.

`src/server/db/regles-import.test.ts` : règle N.

### Tests d'intégration

`src/server/db/debit.integration.test.ts` (vraie base, `creerCompteur` sur un `Pool` de 50 connexions) :

- [x] **Concurrence** : 100 appels `Promise.all` sur une clé neuve, maximum 1 000 : compte 100. Maximum 10 : exactement 10 réponses autorisées, compte 11.
- [x] Preuve que le test attrape la faute : une version lire-puis-écrire de `consommer`, mise en place temporairement, fait échouer le test (constat noté dans « Notes de l'implémentation », modification annulée).
- [x] Fenêtre expirée (début reculé en base par `UPDATE` dans le test) : compte 1, nouveau début ; fenêtre en cours : début inchangé.
- [x] Plafond : compte jamais au-delà de `maximum + 1` après 50 appels avec un maximum de 3.
- [x] Purge : une ligne expirée et une ligne en cours ; seule l'expirée disparaît.

`src/server/db/chaine.integration.test.ts` (ajouts, sessions réelles, limites de test passées à `creerChaine`) :

- [x] Sous la limite, une action réussit et le compte vaut 1 ; au-delà, `trop_de_requetes`.
- [x] Une action dont le service lève une erreur : transaction annulée (aucune ligne témoin), compteur incrémenté.

### Tests d'attaque

`src/server/db/chaine.attaque.integration.test.ts` (ajouts) :

- [x] **Sans session** : aucune ligne de compteur créée, `connexion_requise`.
- [x] **Autre organisation** : membre de B avec l'organisation active A forcée : `refuse`, et seul le compteur de ce membre est incrémenté ; le compteur d'aucun membre de A ne bouge.
- [x] **Rôle insuffisant** : chaque refus d'étape 6 est compté ; au-delà de la limite, `trop_de_requetes` aussi pour un rôle non autorisé.
- [x] **Entrée falsifiée** : une entrée qui contient `debit`, `cle`, `utilisateurId` ou `compte` : `invalide`, et la clé incrémentée est celle de l'utilisateur de la session.
- [x] **T-41, échecs répétés** : 2 × maximum appels d'une action qui échoue toujours : les appels au-delà du maximum reçoivent `trop_de_requetes`, sans exécuter le service.
- [x] **T-41, contournement par une autre organisation** : un membre de A et de B, organisation active changée entre deux séries : un seul compteur, la limite tient.
- [x] **Isolation des compteurs** : un utilisateur au-delà de sa limite n'affecte pas un autre membre de la même organisation.
- [x] **Données personnelles** : après les appels, aucune ligne de `compteur_debit` ne contient l'identifiant de l'utilisateur.

`src/server/db/schema-isolation.integration.test.ts` (ajout) :

- [x] Les tables sans `organisation_id` sont exactement `TABLES_SANS_ORGANISATION` ; `compteur_debit` a `SELECT`, `INSERT`, `UPDATE`, `DELETE`, et pas `TRUNCATE`.

### Tests de bout en bout

- [ ] Aucun. Aucune page, aucune action exposée.

### Lignes laissées sur `dev` par les tests

- Les tests de `debit.integration.test.ts` utilisent des noms de limite propres à l'exécution (`essai_<uuid sans tirets>`, hors de `LIMITES`) et suppriment leurs clés exactes dans `onTestFinished`. Le rôle de l'application a `DELETE` sur la table.
- Les tests de la chaîne suppriment la clé de chaque membre créé, avant `nettoyerMembres`, dans le `finally` existant.
- Un test interrompu laisse quelques lignes : des empreintes d'identifiants aléatoires, sans donnée personnelle, qui expirent avec leur fenêtre et disparaissent à la première purge (tâche quotidienne, jalon 1). Accepté. En CI, la base est neuve à chaque exécution.

## Limites connues

État à l'implémentation sur `dev`, le 2026-10-11. Ce qui permet encore de contourner ou de saturer la limitation.

**Contourner la limite**

- **Plusieurs comptes.** La limite est par utilisateur : un attaquant qui dispose de N comptes membres a N fois la limite. La création de comptes en masse n'est limitée qu'au jalon 1 (S-11).
- **Aucune limite par organisation.** Une organisation de N membres peut faire N × 60 actions par minute. Reporté à la 0.7 (S-55, section 10).
- **Bord de fenêtre.** En fenêtre fixe, jusqu'à 2 × 60 tentatives en un peu plus d'une minute (section 5).
- **`debit: null`.** Une action déclarée sans limite n'est pas limitée. Le choix est visible en revue, mais rien ne vérifie qu'il est le bon (comme `journal: null`).
- **Lectures des pages.** `etablirContexte` n'a pas d'étape 4 (décision 5, à revoir en 0.6).
- **Points d'entrée de Better Auth.** Hors de la chaîne. Sa propre limitation, en mémoire par défaut, est sans effet réel sur Vercel ; le branchement sur notre compteur est la 1.1. Aujourd'hui `/api/auth` n'est pas exposée.
- **Renouvellement de `BETTER_AUTH_SECRET`.** Toutes les clés changent : chaque compteur repart de zéro une fois (section 3).
- **Remise à zéro par du code.** Le rôle de l'application a `DELETE` et `UPDATE` sur `compteur_debit`. La règle N empêche d'importer la table hors de `db/debit.ts`, mais pas une requête SQL brute écrite dans un autre fichier de `db/` (`sql` avec le nom de la table) : seule la revue l'attrape. Même limite pour un chargement dynamique dont le chemin est construit par concaténation.

**Saturer**

- **Une tentative refusée coûte encore.** Chaque requête qui passe l'étape 3 fait une lecture de session et une écriture au compteur, même au-delà de la limite : la limite protège le service et la base métier, pas la base elle-même. Un déluge consomme des heures de calcul de Neon (`PLAN.md` section 7).
- **Requêtes sans session.** Jamais comptées : chacune coûte une lecture de session. Rien ne les limite dans l'application ; elles relèvent des protections de l'hébergeur (RR-5).
- **Une clé très demandée.** Les requêtes d'un même utilisateur se sérialisent sur le verrou de sa ligne ; chacune tient une connexion du `Pool` (10) pendant l'attente. Un utilisateur qui envoie beaucoup de requêtes simultanées peut occuper le `Pool` et ralentir les autres.
- **Compteur indisponible.** Fermé par défaut : si l'instruction du compteur échoue, toutes les actions limitées échouent (`erreur`). Disponibilité échangée contre sécurité (section 6).
- **Lignes non purgées.** `purgerCompteurs` n'est appelée par rien avant la tâche quotidienne du jalon 1. D'ici là, une ligne par utilisateur et par limite reste en base ; volume borné par le nombre de comptes.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/debit/limites.ts`, `limites.test.ts`
- `src/server/debit/cle.ts`, `cle.test.ts`
- `src/server/debit/debit.ts` (`creerVerificateur`, `verifierDebit`, `purgerCompteurs`)
- `src/server/db/debit.ts` (`creerCompteur`, qui fournit `consommer` et `purger`)
- `src/server/db/debit.integration.test.ts`
- `src/server/actions/action-debit.test.ts` : tests unitaires de l'étape 4
- `src/server/db/chaine-debit.integration.test.ts`, `chaine-debit.attaque.integration.test.ts` : étape 4 avec la vraie base

Modifiés :

- `src/server/actions/action.ts` : champ `debit`, étape 4, dépendance `verifierDebit`, limites passées à `creerChaine`
- `src/server/actions/refus.ts` : variante `trop_de_requetes`
- `src/server/actions/action.test.ts`, `exposer.test.ts`, `marque.test.ts`, `registre.integration.test.ts`, `tests/fixtures/inventaire/` : déclarations complétées par `debit`
- `src/server/db/chaine.integration.test.ts`, `chaine.attaque.integration.test.ts` : déclarations complétées par `debit: null` (les cas de l'étape 4 sont dans les fichiers `chaine-debit`)
- `src/server/db/schema-isolation.integration.test.ts` : `TABLES_SANS_ORGANISATION`, droits de `compteur_debit`
- `eslint.config.mjs`, `src/server/db/regles-import.test.ts` : règle N (échappement : méthode de `CLAUDE.md`, « Pièges connus »)
- `docs/DESIGN.md` : section 2.3 (clé en empreinte, protection de la table), section 3.2 (étape 4, `trop_de_requetes`)
- `docs/STRUCTURE.md` : dossier `server/debit/`, section 7 (qui importe `server/debit/` et `db/debit.ts`, règle N), section 9
- `docs/THREATS.md` : section 7.2, ligne « Compteurs de débit : empreintes, durée d'une fenêtre, purge quotidienne »
- `CLAUDE.md` : règle 5 (champ `debit`), règle sur `compteur_debit` et la règle N
- `docs/features/limitation-debit.md` : statut

Inchangés : `drizzle/`, `src/server/db/schema/technique.ts`, `src/server/env.ts`, `src/server/env-schema.ts` (clé dérivée, décision 1), `package.json`, `scripts/`, `.github/workflows/`.

## Dépendances nouvelles

Aucune (règle 10). `createHmac` et `hkdfSync` font partie de `node:crypto`. `@vercel/functions` est écarté (section 9).

## Migration

Aucune. La table actuelle suffit :

```sql
-- drizzle/20261003092117_bumpy_darkstar/migration.sql (appliquée)
CREATE TABLE "compteur_debit" (
	"cle" text PRIMARY KEY,
	"compte" integer DEFAULT 0 NOT NULL,
	"fenetre_debut" timestamp with time zone DEFAULT now() NOT NULL
);
```

- `cle` reçoit `<nom>:<empreinte>`, `compte` le compte plafonné, `fenetre_debut` le début de la fenêtre, en heure de la base.
- Aucune colonne d'expiration : l'expiration se calcule depuis `fenetre_debut` et la limite.
- Aucune règle d'isolation, aucun forçage, aucun retrait de droits (section 7).
- Droits de `app_facturation` sur la table vérifiés sur les trois bases (décision 10) : aucune correction.

## Ordre de déploiement

1. Avant la phase rouge : droits de `app_facturation` sur `compteur_debit` vérifiés par le développeur sur `dev`, `preview` et `production` le 2026-10-11 (décision 10). Fait.
2. PR, CI verte, fusion.
3. Déploiement de Vercel. Aucune étape sur la base, aucune variable nouvelle : la clé est dérivée de `BETTER_AUTH_SECRET` (décision 1).

## Reporté

### À la 0.6 (socle d'interface)

- Le libellé de `trop_de_requetes`.
- Une limite sur les lectures des pages (`etablirContexte`) : à revoir (décision 5).

### À la 0.7 et aux fonctionnalités d'envoi (2.2, 4.x, 5.x, 6.x)

- S-55 et T-40 : limite d'envoi par organisation. Contrainte posée par cette fiche : pas de compteur d'organisation à l'étape 4 (section 10), pas d'appel à `verifierDebit` dans une transaction ouverte (section 2.1). Pistes : compter après la validation de la transaction, avant l'envoi ; ou compter par la chaîne après l'étape 6 avec une connexion réservée. La fiche 0.7 tranche.

### Au jalon 1

- Avant la 1.1 : la tâche quotidienne, avancée de la 8.3 (décision 6), qui appelle `purgerCompteurs`.
- 1.1 : branchement de Better Auth sur notre compteur (section 8, option B3, inscrit dans `PLAN.md`) ; activation explicite ; source de l'adresse IP, vérifiée sur `preview` avec un en-tête forgé (section 9) ; écart avec `DESIGN.md` section 3.1 ; réponse 429 de Better Auth.
- S-11 : limites de connexion et de réinitialisation par adresse IP et par email (abus de `USECASES.md` : comptes en masse, boîte inondée).

### Au jalon 4

- S-22 : limite des pages publiques par adresse IP, avec la réponse unique de `DESIGN.md` section 3.4.

### Au jalon 7

- 7.2 : limites des exports et des générations de PDF (S-84, T-41).

### Au jalon 8

- 8.1 : signalement des limites atteintes au service de suivi des erreurs, sans la clé.
- 8.4 (test d'intrusion) : éprouver la saturation du `Pool` de connexions par un même utilisateur qui envoie de nombreuses requêtes simultanées (« Limites connues », « Une clé très demandée ») ; étudier un délai d'attente sur le verrou du compteur (par exemple `lock_timeout` local à l'instruction), et son effet sur le refus fermé par défaut (section 6).

## Décisions

Prises à la validation de la fiche, le 2026-10-11.

1. **Clé de l'empreinte.** S1 : dérivée de `BETTER_AUTH_SECRET` par HKDF. Aucune variable nouvelle.
2. **Refus.** R2 : `trop_de_requetes`, sans délai ni compte.
3. **Champ `debit`.** Obligatoire, sans défaut ; `null` permis comme choix explicite.
4. **`membre.action`.** 60 tentatives par minute et par utilisateur.
5. **Lectures des pages.** Aucune limite en 0.5. À revoir en 0.6.
6. **Purge.** `purgerCompteurs` livrée et testée en 0.5. Le premier compteur par adresse IP ou par email arrive au jalon 1, avec la limitation des connexions : la tâche quotidienne de la 8.3 est avancée au jalon 1, avant la mise en service de cette limitation (`PLAN.md`).
7. **Adresse IP.** La règle de lecture est fixée par cette fiche (section 9) ; la fonction est livrée par la 1.1, avec l'essai sur `preview`.
8. **Garde-fous.** Règle ESLint N et liste fermée des tables sans `organisation_id` : oui.
9. **Taille.** Acceptée, une seule PR.
10. **Droits sur `compteur_debit`.** Vérifiés par le développeur sur `dev`, `preview` et `production` : `SELECT`, `INSERT`, `UPDATE` et `DELETE` accordés sur les trois. Aucune correction.

Validés aussi : le refus quand la base ne répond pas (section 6, P1) ; le report de la limite par organisation à la 0.7 (section « Reporté ») ; le branchement de Better Auth sur notre compteur au jalon 1 (section 8, B3), inscrit à la ligne 1.1 de `PLAN.md`.

## Notes de l'implémentation

### Phase rouge, le 2026-10-11

Interfaces fixées par les tests, en fonctions vides qui lèvent « non implémenté » :

- `limites.ts` : `LIMITES`, `NomLimite`, `Limite`, et `fenetreMaxSecondes(limites)`, une fonction au lieu de la constante `FENETRE_MAX_SECONDES` de la section 1.
- `cle.ts` : `deriverSecret(secretAuth)` et `cleCompteur(nom, valeur, secret)`.
- `db/debit.ts` : `creerCompteur(base)` renvoie `{ consommer(cle, regle), purger(fenetreSecondes) }` ; l'instance liée à `db` est `compteur`. `db/` n'importe rien de `server/debit/` : la fenêtre de purge est un paramètre.
- `debit/debit.ts` : `creerVerificateur({ limites, compteur, secret })` renvoie `{ verifierDebit, cle }`. `cle` sert aux tests pour supprimer leurs lignes. Les tests de la chaîne passent un vérificateur dont la limite `membre.action` vaut 3 : aucune limite de démonstration dans `LIMITES`. `verifierDebit` et `purgerCompteurs` sont liés aux vraies limites.
- Types seulement, sans comportement : champ `debit` de `DeclarationAction`, dépendance `verifierDebit` de `DependancesChaine`, variante `trop_de_requetes` de `Resultat`.

### Implémentation, le 2026-10-11

- `consommer` est écrite avec le constructeur de Drizzle (`insert ... onConflictDoUpdate ... returning`). Paramètres typés dans la requête (`::double precision` pour `make_interval`, `::integer` pour le maximum), pour que PostgreSQL ne devine pas leur type. `consommer` et `purger` refusent un maximum ou une fenêtre qui n'est pas un entier positif.
- `fenetreMaxSecondes` lève une erreur sur un ensemble vide : `Math.max()` renverrait `-Infinity`, et la purge supprimerait toutes les lignes.
- `creerVerificateur` ne lit que les clés propres de `limites` (`Object.hasOwn`) ; `declarerAction` refuse un `debit` absent, inconnu ou hérité (`constructor`).
- L'étape 4 est dans `dansContexte`, qui reçoit la limite ; `etablirContexte` passe `null`.
- Règle N, écrite par un script Python (barres inverses construites par `chr(92)`), puis vérifiée : chaque ligne qui contient `u002F` a ses barres inverses doublées. Les deux lignes à une seule barre inverse sont les guillemets échappés des messages G et H, inchangés. Constaté pendant ce contrôle : un premier script de comptage contenait lui-même une expression régulière à barre inverse, réduite par l'outil, et ne trouvait rien. Le comptage fiable s'écrit aussi avec `chr(92)`. Nouveaux ensembles de fichiers : `src/server/debit/**` (tout sauf N sur le compteur) et `src/server/db/debit.ts` (tout sauf N).

### Preuves par modification temporaire, annulées ensuite

Chaque fichier a été rétabli depuis une copie, puis comparé à cette copie (`cmp`, aucune différence).

1. **Concurrence.** `consommer` remplacée par une lecture suivie d'une écriture : les deux tests de concurrence échouent (`expected [ 1, 1, 1, 1, ... ]` : les 100 appels lisent le compte 1 ; avec un maximum de 10, 100 appels autorisés au lieu de 10).
2. **« Sans session »**, qui passait à vide en phase rouge. Comptage placé avant la lecture de la session : le test échoue (`expected "vi.fn()" to not be called at all, but actually been called 1 times`).
3. **« Un membre au-delà de sa limite ne gêne pas un autre »**, qui passait à vide. Clé sans l'utilisateur (valeur fixe) : le test échoue (le voisin reçoit `trop_de_requetes`). Cet essai a laissé sur `dev` une ligne de compteur pour la valeur fixe, sans donnée personnelle, qui expire avec sa fenêtre d'une heure.
4. **Liste fermée des tables.** `compteur_debit` retiré de `TABLES_SANS_ORGANISATION` : le test échoue. Fichier de test rétabli, `git diff` vide pour lui.

### CI : « too many clients already », le 2026-10-11

- Constat sur la PR : `53300` dans `debit.integration.test.ts` (« maximum 10 ») et dans `client.integration.test.ts`, dès le garde-fou. Sur `dev`, tout passait.
- Cause : les deux tests de concurrence ouvraient chacun un `Pool` de 50, fermés seulement en `afterAll`. Les 50 connexions du premier, inactives, restaient ouvertes pendant le second (`pg` ne les rend qu'au bout de 10 s) : au moins 101 connexions pour ce seul fichier, au-delà des 97 qu'accepte la base de la CI pour un rôle ordinaire. `client.integration.test.ts`, lancé en parallèle, recevait le refus. Sur `dev`, le regroupement de Neon absorbe ces connexions.
- Écartée : une accumulation d'un fichier à l'autre. Chaque fichier s'exécute dans son propre processus (Vitest 5, `isolate: true`), et ses connexions se ferment avec lui.
- Correction : `compteurSur` ferme son `Pool` à la fin du test qui l'a ouvert (`onTestFinished`). Taille du `Pool`, 100 appels simultanés et assertions inchangés. Pic estimé en CI : environ 70 connexions (50, plus le `Pool` principal, plus deux autres fichiers en parallèle sur un runner à 4 vCPU) ; pire cas théorique proche de 96.
- Piège ajouté à `CLAUDE.md`.

