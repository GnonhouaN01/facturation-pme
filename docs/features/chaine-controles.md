# Fonctionnalité : chaîne de contrôles et matrice des droits

Statut : validée

Jalon 0, fonctionnalité 0.4 de `docs/PLAN.md`. Taille L.

## Contexte

Cette fonctionnalité sert au développeur. Elle fournit le seul chemin par lequel une action d'un membre atteint un service métier : `docs/DESIGN.md` section 3.2 (« aucune action ne peut atteindre le service métier sans passer par les étapes 1 à 4 »), règles d'architecture 2 à 4 de `DESIGN.md` section 4.3, règle 5 de `CLAUDE.md`. `PLAN.md` section 3 la désigne comme la fonctionnalité la plus importante du projet.

Aujourd'hui :

- Les fonctionnalités 0.1 à 0.3 sont livrées et déployées : `env.ts`, `executerDansOrganisation` et le modèle d'isolation, le journal d'audit en ajout seul (`journaliser`). Sur `production` et `preview`, 11 tables.
- Aucune action, aucune route, aucune page métier. `src/app/` ne contient que `layout.tsx` et `page.tsx`. La route `/api/auth` n'est pas exposée (règle 11).
- `src/server/auth/config.ts` configure Better Auth 1.7.7 avec `twoFactor()`, `organization()` sans option et `nextCookies()`.
- Les reports adressés à la 0.4 par les fiches précédentes :
  - `acces-donnees.md` : l'organisation active lue dans la session après vérification de l'adhésion ; la traduction de `OrganisationActiveInvalide` et de `42501` en « introuvable » ; la garantie qu'un service ne reçoit que la transaction de la chaîne et n'en ouvre pas ; le `set_config` vers une autre organisation par du code qui dispose de `tx`.
  - `journal-audit.md` : `auteurId` lu dans la session vérifiée ; l'action du journal déclarée avec chaque action de la chaîne, pour qu'une action sensible ne puisse pas oublier sa trace (T-20) ; la traduction de `EntreeJournalInvalide` en erreur générique avec identifiant d'incident (S-85).

Cas d'utilisation concernés : aucun directement. Tous les cas d'utilisation d'un membre (UC-06 à UC-31) en dépendent. Abus repris : UC-10 (« un membre retiré continue d'agir avec une session ouverte »), UC-11 (« indiquer l'identifiant d'une organisation dont on n'est pas membre »).

## Problème

- Rien n'enchaîne origine, session, adhésion, rôle et validation : chaque action devrait les réécrire, et un oubli passerait inaperçu (T-50, T-72).
- La matrice de `THREATS.md` section 6 n'existe pas dans le code. Rien ne garantit qu'un droit codé correspond au document qui fait foi (`SPEC.md` section 2.2).
- Rien ne dit comment répondre à un refus sans révéler si la ressource existe (S-02, T-30).
- Les rôles de Better Auth ne sont pas les nôtres (section 1).
- `session.active_organization_id` est un `text` sans clé étrangère, qui n'est pas remis à jour quand un membre est retiré par un autre (section 2).

## Solution retenue

Exigences couvertes : aucune exigence F ou R. Exigences de sécurité dans la section « Règles de sécurité et permissions ».

Vue d'ensemble, détaillée ensuite :

| Fichier | Rôle |
|---|---|
| `src/server/autorisation/matrice.ts` | Les quatre rôles, les droits (une ligne de `THREATS.md` section 6 = un droit), `peut(role, droit)` |
| `src/server/actions/action.ts` | `declarerAction` et la chaîne `executerChaine`, indépendante de Next.js |
| `src/server/actions/exposer.ts` | L'adaptateur Next.js : lit les en-têtes de la requête et appelle la chaîne |
| `src/server/actions/refus.ts` | Le modèle de résultat et la traduction des erreurs |
| `src/server/actions/registre.ts` | La liste de toutes les actions déclarées (vide en 0.4) |
| `src/server/auth/session.ts` | Lecture de la session par Better Auth |
| `src/server/db/requetes/adhesions.ts` | Lecture de l'adhésion dans la transaction de l'organisation active |

### 1. Les rôles

#### 1.1 Ce que fournit Better Auth 1.7.7

Vérifié dans `node_modules/better-auth/dist/plugins/organization/` :

- `access/statement.mjs` : trois rôles par défaut, `owner`, `admin`, `member`, définis sur les ressources du module (`organization`, `member`, `invitation`, `team`, `ac`). `member` n'a aucun droit sauf `ac: ["read"]`.
- `schema/auth.ts` (généré) : `member.role` est un `text NOT NULL DEFAULT 'member'`. `invitation.role` est un `text` facultatif. Un rôle peut contenir plusieurs valeurs séparées par des virgules (`permission.mjs` : `input.role.split(",")`).
- `organization.mjs` ligne 581 : l'option `roles` **s'ajoute** aux rôles par défaut (`{ ...defaultRoles, ...opts.roles }`), elle ne les remplace pas.
- `routes/crud-invites.mjs` ligne 104 et `routes/crud-members.mjs` ligne 311 : les rôles acceptés par les points d'entrée du module sont l'union des rôles par défaut et des rôles configurés. Même avec nos rôles configurés, `owner`, `admin` et `member` restent attribuables par ces points d'entrée.
- `creatorRole` (défaut `owner`) est le rôle donné au créateur (`routes/crud-org.mjs` ligne 83) et protégé contre le retrait du dernier titulaire (`routes/crud-members.mjs` lignes 194 et 419).
- `has-permission.mjs` : le contrôle du module ne concerne que ses propres ressources. Il ne connaît ni clients, ni devis, ni factures.
- Le module déclare 36 points d'entrée `/organization/*` (ceux des équipes et des rôles dynamiques ne sont actifs qu'avec leur option) (dont `update-member-role`, `remove-member`, `invite-member`, `set-active`), chacun avec son propre contrôle de droits, sans notre matrice, sans journal, sans nouvelle authentification. Ils ne sont pas joignables aujourd'hui, faute de route `/api/auth`.

Conséquence : Better Auth ne peut pas porter notre matrice. Il stocke l'adhésion et sa colonne `role` ; la décision reste à notre code.

#### 1.2 Options

| Option | Principe | Avis |
|---|---|---|
| R1. Rôles de Better Auth renommés | Correspondance `owner` → Propriétaire, `admin` → Comptable, `member` → Commercial, et un quatrième rôle configuré pour Lecteur | Écarté : correspondance trompeuse (`admin` n'est pas un comptable), et le défaut `member` de la colonne donnerait le rôle Commercial à toute adhésion créée sans rôle explicite |
| **R2. Nos quatre rôles écrits dans `member.role`, liste fermée dans `matrice.ts`** | Valeurs `proprietaire`, `comptable`, `commercial`, `lecteur`. La chaîne n'accepte que ces quatre valeurs exactes. Toute autre valeur (`owner`, `admin`, `member`, vide, plusieurs rôles séparés par une virgule) vaut « aucun droit » | **Retenu (décision 1)** |
| R3. Table propre `role_membre` à côté de `member` | Rôle hors de Better Auth | Écarté : deux sources pour une même adhésion, à synchroniser ; migration et table de plus sans gain |

Avec R2, le défaut `'member'` de la colonne joue en notre faveur : une adhésion créée sans rôle explicite n'a aucun droit (refus par défaut). Aucune migration : la colonne reste celle du fichier généré.

La configuration de Better Auth (`organization({ creatorRole: "proprietaire", roles: ... })`) n'est **pas** modifiée en 0.4 : elle ne sert qu'aux points d'entrée du module, qui ne sont pas exposés. Elle est reportée à la 2.1 (création d'une organisation, qui donne le rôle du créateur). La fermeture des points d'entrée natifs relève de la 1.1 (décision 15, T-55).

### 2. L'organisation active et l'adhésion

#### 2.1 Où valider `active_organization_id`

La colonne est un `text` (exception de `DESIGN.md` section 2.1). Elle n'est écrite que par Better Auth (`set-active`, qui vérifie l'adhésion à ce moment-là), mais elle n'est jamais revérifiée ensuite.

Dans la chaîne, après la lecture de la session :

1. Absente (`null`) : refus. L'utilisateur n'a pas d'organisation active (le choix d'une organisation est la 2.1).
2. Validée par `z.uuid()` : une valeur invalide est un refus, avant toute requête. `executerDansOrganisation` la revalide de toute façon (défense en profondeur, `acces-donnees.md` section 1.4).
3. L'adhésion est lue **dans la transaction** ouverte pour cette organisation (section 2.2).

#### 2.2 Le membre retiré depuis l'ouverture de sa session (S-17, T-52)

Constaté dans `routes/crud-members.mjs` ligne 223 : quand un Propriétaire retire un membre, Better Auth ne vide `active_organization_id` que si l'auteur du retrait se retire lui-même. Les sessions du membre retiré gardent l'organisation active. Le contrôle ne peut donc pas reposer sur la session.

| Option | Principe | Effet |
|---|---|---|
| C1. Adhésion lue avant la transaction, par `db` | Une requête, puis `executerDansOrganisation` | Fenêtre courte entre la lecture et l'action : un retrait validé pendant ce temps n'empêche pas l'action déjà commencée |
| C2. Adhésion lue dans la transaction, sans verrou | Première requête après `set_config` | Même fenêtre, réduite à la durée de la transaction |
| **C3. Adhésion lue dans la transaction, `FOR SHARE`** | La ligne `member` est verrouillée en partage jusqu'à la fin de l'action | Un retrait ou un changement de rôle (2.4) attend la fin des actions en cours ; toute action commencée après lui ne trouve plus l'adhésion ou lit le nouveau rôle. **Retenu (décision 2)** |

Détails de C3 :

- `lireAdhesion(tx, utilisateurId)` dans `src/server/db/requetes/adhesions.ts`. Le filtre sur l'organisation utilise l'expression `ORGANISATION_ACTIVE` exportée par `schema/isolation.ts` : l'adhésion lue est forcément celle de l'organisation de la transaction, sans second paramètre qui pourrait diverger.
- `member` n'a pas de règle d'isolation (table de Better Auth, `DESIGN.md` section 2.5) : le filtre est celui du code seul. C'est acceptable, car la requête ne renvoie que le rôle de l'utilisateur de la session.
- `FOR SHARE` exige le droit `UPDATE` sur la table : le rôle de l'application l'a sur `member` (droits par défaut, Better Auth y écrit).
- Aucune écriture sur la session dans la chaîne : vider `active_organization_id` des sessions d'un membre retiré appartient à la 2.4 (UC-10 étape 4).

Un rôle modifié s'applique à la requête suivante, par la même relecture.

### 3. La forme technique d'une action dans Next.js 16

#### 3.1 Ce que dit Next.js 16.3.8

Lu dans `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` et `data-security.md`, et dans `node_modules/next/dist/server/app-render/action-handler.js` :

- Une action serveur est une fonction d'un fichier marqué `"use server"`. Toute fonction exportée devient un point d'entrée `POST` joignable par quiconque envoie la même requête : « Treat every action as an untrusted entry point ».
- Next.js compare l'en-tête `Origin` à `Host` ou `X-Forwarded-Host`. Mais **une requête sans `Origin` passe**, avec un simple avertissement (`action-handler.js` lignes 440 à 445). Et la comparaison se fait avec un en-tête de la requête, pas avec une adresse configurée.
- Un gestionnaire de route (`route.ts`) n'a **aucun** contrôle d'origine du cadre.
- `redirect()` et `notFound()` lèvent des erreurs de contrôle que tout `try/catch` doit relancer (`unstable_rethrow`, `next/navigation`).
- `headers()` (`next/headers`) est asynchrone et lisible dans une action serveur.

#### 3.2 Forme retenue

Trois couches, pour que la chaîne se teste sans Next.js :

1. **Déclaration**, dans `src/server/actions/<domaine>.ts` :

   ```ts
   export const modifierRoleMembre = declarerAction({
     nom: "membre.modifier_role",          // unique, vérifié par le registre
     droit: "organisation.membres.gerer",  // clé de la matrice : vérifié par le type
     entree: schemaModifierRole,           // z.strictObject, obligatoire
     journal: "membre.role_modifie",       // ou null : champ obligatoire, sans défaut
     nouvelleAuthentification: true,      // S-14 : champ obligatoire, sans défaut
     executer: async (ctx, entree) => { ... },  // appelle un service
   });
   ```

2. **Chaîne**, `executerChaine(declaration, requete, entreeBrute)` dans `src/server/actions/action.ts`. `requete` est un objet `{ entetes: Headers }` : la chaîne ne lit jamais `next/headers` elle-même. Elle est construite par une fabrique `creerChaine(dependances)`, sur le modèle de `creerAcces` : les tests unitaires lui passent des dépendances factices, les tests d'intégration les vraies.

3. **Exposition**, dans `src/app/(app)/<domaine>/actions.ts`, fichier `"use server"` :

   ```ts
   "use server";
   export const modifierRole = exposer(modifierRoleMembre);
   ```

   `exposer` (`src/server/actions/exposer.ts`) renvoie une fonction `async` qui lit `await headers()`, appelle la chaîne et relance les erreurs de contrôle de Next.js. Elle marque la fonction renvoyée (symbole privé) pour l'inventaire (section 7).

**Vérifié avant la phase rouge** (essai jetable du 2026-10-09, supprimé ensuite) : un fichier `"use server"` contenant `export const essaiAction = exposer("essai.action")`, où `exposer` renvoie une fonction `async` marquée par un symbole et lit `await headers()`, est accepté par `npm run build` (Next.js 16.3.8, Turbopack). Dans le code compilé, Next.js appelle `ensureServerEntryExports([essaiAction])`, puis `registerServerReference(essaiAction, "<identifiant>")`. Le manifeste `server-reference-manifest.json` liste `essaiAction` sous son nom exporté. La page qui l'utilise a été préconstruite, donc le module a été chargé sans erreur. La vérification de Next.js à l'exécution n'exige que `typeof === "function"` (`next/dist/server/app-render/action-validate.js`). Non vérifié : un appel HTTP réel de l'action (`curl` vers le serveur local refusé pendant l'essai). Il sera fait par le premier test de bout en bout qui utilise une action.

**Gestionnaire de route.** Aucune route de membre n'est prévue avant la 7.2 (exports en téléchargement). Retenu : la chaîne ne dépend que de `{ entetes }`, donc un adaptateur `exposerRoute` se branche sans la modifier ; il est livré par la 7.2, avec sa fiche (règle 11). La 0.4 interdit dès maintenant tout `route.ts` qui n'en passe pas par là (section 7), sauf `api/auth` et `api/taches`, qui ont leur propre contrôle et leur propre fiche.

**Lectures des pages.** Une page (composant serveur) lit des données sans passer par une action serveur. Elle a besoin du même contexte (session, adhésion, rôle, droit de lecture). Retenu (décision 9) : la 0.4 livre le noyau `etablirContexte` (étapes 2 à 6 de la section 5, sans contrôle d'origine, pour une lecture) ; l'adaptateur des pages et des gabarits est livré par la 0.6 (socle d'interface), qui crée `(app)/layout.tsx`.

#### 3.3 L'origine de la requête (S-81, T-17)

Contrôle propre, en plus de celui de Next.js :

- `Origin` est **obligatoire** et doit être égal à l'origine de `env.BETTER_AUTH_URL` (schéma, hôte et port), valeur de configuration et non en-tête de la requête. Un navigateur envoie toujours `Origin` sur un `POST`, y compris vers la même origine.
- Si `Sec-Fetch-Site` est présent, il doit valoir `same-origin`.
- Aucune autre origine n'est acceptée. `Origin: null` est refusé.

Ce contrôle est une fonction pure, `verifierOrigine(entetes, origineAttendue)`, testée sans base.

Décision 4 : une seule adresse acceptée, celle de `BETTER_AUTH_URL`. Sur `preview`, elle est déduite de `VERCEL_URL` (adresse propre au déploiement) : une prévisualisation ouverte par l'adresse de branche de Vercel a une autre origine et est refusée. L'acceptation de l'adresse de branche, avec le réglage équivalent de Better Auth, est tranchée par la fiche 1.1 (`PLAN.md`).

### 4. Ce que reçoit le service : le contexte

```ts
type Contexte<J> = {
  utilisateurId: string;     // de la session vérifiée, jamais de l'entrée
  organisationId: string;    // de la session, adhésion vérifiée
  role: Role;                // relu en base à chaque requête
  perimetre: "organisation" | "portefeuille";  // P* et L* de la matrice
  tx: TransactionOrganisation;
  journaliser: J extends ActionJournal ? (trace: { ressourceId: string; details?: DetailsDe<J> }) => Promise<void> : never;
  introuvable: () => never;  // lève le refus uniforme
};
```

- `perimetre` vaut `"portefeuille"` pour un Commercial sur un droit marqué P\* ou L\*. En 0.4, la chaîne le calcule et le transmet ; le filtrage par portefeuille et la lecture du réglage de visibilité sont la 7.4. Jusque-là, `"portefeuille"` est traité comme `"organisation"` par les services (point d'accroche).
- `journaliser` du contexte est lié à l'action déclarée et à l'auteur de la session : le service ne fournit ni l'action, ni l'auteur. Il n'existe que si la déclaration a un `journal` non nul (type).
- `introuvable()` est la seule façon pour un service de refuser une ressource (section 6).

### 5. L'ordre des contrôles

| # | Contrôle | Requête en base | Refus |
|---|---|---|---|
| 1 | Origine (section 3.3) | Aucune | `refuse` |
| 2 | Session : `auth.api.getSession({ headers })`. Le cache de session dans un cookie est désactivé par défaut (`api/routes/session.mjs` ligne 39) : la session est relue en base | `session`, `user` | `connexion_requise` |
| 3 | Organisation active présente et au format UUID | Aucune | `refuse` |
| 4 | *Point d'accroche 0.5 : limitation de débit* | — | — |
| 5 | Ouverture de `executerDansOrganisation(organisationId)`. Toutes les étapes suivantes s'y déroulent | `set_config` | — |
| 6 | Adhésion `FOR SHARE` (section 2.2) ; rôle parmi les quatre ; `peut(role, droit)` | `member` | `refuse` |
| 7 | *Point d'accroche 1.4 : double authentification exigée pour Propriétaire et Comptable (S-12, S-13, T-02)* | — | `refuse` |
| 8 | Nouvelle authentification (S-14) : en 0.4, toute déclaration `nouvelleAuthentification: true` est **refusée** (fermé par défaut) jusqu'à la fonctionnalité du jalon 1 qui l'implémente | Aucune | `refuse` |
| 9 | Validation de l'entrée par le schéma de la déclaration | Aucune | `invalide` |
| 10 | `executer(ctx, entree)` : le service, dans la transaction | Selon le service | `refuse` par `ctx.introuvable()` |
| 11 | Si la déclaration a un `journal` : la chaîne vérifie que `ctx.journaliser` a été appelé au moins une fois ; sinon elle lève `TraceManquante`, qui annule la transaction | `journal_audit` | `erreur` |
| 12 | Validation de la transaction ; réponse | — | — |

Raisons de l'ordre :

- **Rôle avant validation** (ordre de `DESIGN.md` section 3.2) : un membre non autorisé reçoit `refuse` quelle que soit son entrée. Il ne peut pas sonder le schéma ni apprendre quoi que ce soit de la forme attendue.
- **Rien d'issu de l'entrée n'est lu avant l'étape 9.** Les étapes 1 à 8 ne dépendent que de la requête, de la session et de la base : leur résultat ne révèle rien sur une ressource visée.
- **L'organisation ne vient jamais de l'entrée** : une entrée qui contient `organisationId`, `role` ou `auteurId` est refusée par le schéma strict (`invalide`), et ne serait de toute façon jamais lue.
- Écart avec `DESIGN.md` section 3.2 : l'adhésion est lue après l'ouverture de la transaction (étape 5), et non avant. `DESIGN.md` est mis à jour en conséquence.

### 6. Le modèle de refus

#### 6.1 Ce que reçoit le client

```ts
type Resultat<T> =
  | { ok: true; donnees: T }
  | { ok: false; raison: "connexion_requise" }
  | { ok: false; raison: "refuse" }
  | { ok: false; raison: "invalide"; champs: string[] }   // chemins des champs, jamais les valeurs
  | { ok: false; raison: "erreur"; incident: string };   // S-85
```

- `refuse` couvre, sans distinction : origine refusée, organisation active absente ou invalide, adhésion absente, rôle inconnu, droit refusé par la matrice, nouvelle authentification non disponible, et ressource introuvable (inexistante, d'une autre organisation, ou hors du périmètre du rôle). C'est le « introuvable » de S-02 ; l'interface (0.6) l'affiche comme tel.
- `connexion_requise` est distinct, pour que l'interface renvoie vers la connexion. Il ne révèle rien sur une ressource : il est décidé à l'étape 2, avant toute lecture qui dépend de l'entrée (option U2, retenue par la décision 3 ; U1, tout confondre en `refuse`, est écarté car l'interface ne pourrait pas distinguer une session expirée).
- `invalide` n'est atteint que par un membre autorisé (étape 9). `champs` contient les chemins Zod (`["lignes", 0, "quantite"]` rendu `lignes.0.quantite`), jamais la valeur reçue ni le message de Zod.
- Aucun texte : des codes. Les libellés français vivent dans `src/textes/` et sont la 0.6 (NF-01).

#### 6.2 « Inexistante » et « d'une autre organisation » ne se distinguent pas

- Lecture : la règle d'isolation rend la ressource de A invisible dans une transaction de B. Le service obtient « aucune ligne » dans les deux cas, et appelle `ctx.introuvable()` dans les deux cas, par le même chemin de code.
- Écriture vers une ressource de A (association par clé étrangère, modification) : refus `42501` de la règle ou violation de clé étrangère `23503`. La chaîne traduit `42501` en `refuse`. Pour `23503`, la règle de construction est que le service vérifie l'existence de la ressource associée par une lecture avant d'écrire, et appelle `ctx.introuvable()` ; un `23503` qui remonte quand même est traduit en `refuse` aussi, pour qu'aucun chemin ne réponde différemment.
- Durée : le refus par rôle (étape 6) répond plus vite qu'une recherche de ressource. Il ne révèle que « ce rôle n'a pas ce droit », que la matrice rend publique de toute façon. Inexistante et autre organisation passent par la même requête : pas d'écart mesurable attendu. Non testé en durée (risque résiduel noté).

#### 6.3 Traduction des erreurs

| Erreur | Réponse | Journal technique |
|---|---|---|
| `RefusUniforme` (levée par la chaîne ou `ctx.introuvable()`) | `refuse` | Rien |
| `OrganisationActiveInvalide` | `refuse` | Rien |
| Erreur PostgreSQL `42501`, `23503` | `refuse` | Nom de l'action, code PostgreSQL |
| `EntreeJournalInvalide`, `TraceManquante` | `erreur` + incident | Nom de l'action, classe de l'erreur, incident |
| Erreur de contrôle de Next.js (`redirect`, `notFound`) | Relancée telle quelle (`unstable_rethrow`) | Rien |
| Toute autre erreur | `erreur` + incident | Nom de l'action, classe de l'erreur, code PostgreSQL éventuel, incident |

- L'incident est un `crypto.randomUUID()`. Le journal technique est `console.error` jusqu'à la 8.1 (suivi des erreurs).
- **Jamais le message de l'erreur** dans le journal technique : un message PostgreSQL peut contenir des valeurs (`Key (email)=(...)` d'une violation d'unicité). S-54, T-35.
- `42501` peut aussi venir d'une erreur de programmation (écriture interdite sur `journal_audit`). Il est alors masqué en `refuse` pour le client, mais consigné avec son code. Accepté.

### 7. Aucune action ne contourne la chaîne

Les deux mécanismes, complémentaires :

| Mécanisme | Ce qu'il attrape | Limite |
|---|---|---|
| **Règles ESLint** (analyse du code, dans l'éditeur et la CI) | La forme : un export de fichier `"use server"` qui n'est pas `exposer(...)`, une directive `"use server"` à l'intérieur d'une fonction, un import interdit | Ne voit pas ce qui est construit à l'exécution |
| **Test d'inventaire** (exécution) | Le fond : chaque export de chaque `src/app/**/actions.ts` porte la marque d'`exposer`, et sa déclaration est dans le registre ; chaque `route.ts` est sur la liste des routes admises | Ne voit que les fichiers qu'il parcourt |

**Retenu : les deux.** Règles ajoutées à `eslint.config.mjs`, chacune vérifiée par `regles-import.test.ts` :

- G. Dans un fichier qui commence par `"use server"` : tout export est `export const x = exposer(y)`. Refusés : `export async function`, `export default`, `export { ... }` d'une autre valeur.
- H. La directive `"use server"` n'apparaît qu'en tête de fichier, et seulement dans `src/app/**/actions.ts` (pas d'action serveur en ligne dans un composant).
- I. `executerDansOrganisation` ne s'importe que dans `src/server/actions/action.ts`, `src/server/db/` et les tests. Un service ne peut donc ni ouvrir une transaction, ni en imbriquer une seconde : il reçoit `ctx.tx` (report de `acces-donnees.md`).
- J. `journaliser` ne s'importe que dans `src/server/actions/action.ts` et les tests : un service écrit au journal par `ctx.journaliser`, avec l'auteur de la session (report de `journal-audit.md`). Change `STRUCTURE.md` section 7, qui autorisait `server/services/` à importer `server/journal/`.
- K. La chaîne `app.organisation_id` (littéral ou gabarit) n'apparaît que dans `src/server/db/client.ts` et `src/server/db/schema/isolation.ts` : un `set_config` vers une autre organisation par du code qui dispose de `tx` devient visible (report de `acces-donnees.md`).
- L. `src/server/actions/` n'importe pas `next/headers` sauf `exposer.ts` : la chaîne reste testable sans Next.js.

Test d'inventaire, `src/server/actions/inventaire.test.ts` (sans base) :

- parcourt `src/app/**/actions.ts`, importe chaque fichier, vérifie que chaque export porte la marque d'`exposer`, et que sa déclaration figure dans `registre.ts` ;
- parcourt `src/app/**/route.ts` et exige que chacun figure dans une liste fermée (`api/auth/[...all]`, `api/taches/quotidienne`, vides aujourd'hui), chaque entrée de la liste citant sa fiche ;
- échoue si deux déclarations du registre portent le même `nom` ;
- garde contre un parcours vide : il vérifie qu'il a bien parcouru `src/app/`.

**Vérifié avant la phase rouge** (même essai jetable) : sous Vitest (projet `unitaires`), `await import("./actions")` d'un fichier `"use server"` qui importe `next/headers` réussit. Les exports sont les fonctions renvoyées par `exposer`, et la marque (symbole) se lit. La directive `"use server"` n'est, pour Vitest, qu'une chaîne sans effet. Le test d'inventaire importe donc les fichiers ; l'analyse syntaxique n'est pas nécessaire.

### 8. La matrice dans le code, et son test exhaustif

#### 8.1 Forme

`src/server/autorisation/matrice.ts` :

- `ROLES = ["proprietaire", "comptable", "commercial", "lecteur"] as const`.
- `DROITS` : un objet constant ; pour chaque droit, `libelle` (le texte exact de la ligne de `THREATS.md` section 6) et la valeur pour chacun des quatre rôles : `"oui"`, `"non"`, `"portefeuille"` (P\*), `"lecture_portefeuille"` (L\*).
- `peut(role, droit)` : `true` pour `oui`, `portefeuille`, `lecture_portefeuille`. `perimetre(role, droit)` : `"portefeuille"` pour les deux dernières.
- Le type `Droit` est dérivé des clés : `declarerAction({ droit: "inconnu" })` ne compile pas. **Une action ne peut pas être déclarée sans son droit.**

#### 8.2 La matrice telle qu'elle sera codée

| Droit | Libellé (`THREATS.md` section 6) | Propriétaire | Comptable | Commercial | Lecteur |
|---|---|---|---|---|---|
| `organisation.membres.voir` | Voir la liste des membres et leur rôle | oui | oui | oui | oui |
| `organisation.fiche.modifier` | Modifier la fiche, les taux de TVA, les délais | oui | non | non | non |
| `organisation.instructions_paiement.modifier` | Modifier les instructions de paiement | oui | non | non | non |
| `organisation.invitations.gerer` | Inviter un membre, révoquer une invitation | oui | non | non | non |
| `organisation.membres.gerer` | Modifier un rôle, retirer un membre | oui | non | non | non |
| `organisation.visibilite.regler` | Régler la visibilité des Commerciaux | oui | non | non | non |
| `organisation.supprimer` | Supprimer l'organisation | oui | non | non | non |
| `organisation.quitter` | Quitter l'organisation | oui | oui | oui | oui |
| `clients.voir` | Voir les clients | oui | oui | portefeuille | oui |
| `clients.modifier` | Créer, modifier, archiver un client | oui | oui | portefeuille | non |
| `clients.reaffecter` | Réaffecter un client | oui | non | non | non |
| `clients.anonymiser` | Anonymiser un particulier | oui | non | non | non |
| `catalogue.voir` | Voir le catalogue | oui | oui | oui | oui |
| `catalogue.modifier` | Créer, modifier, désactiver un article | oui | oui | non | non |
| `devis.voir` | Voir les devis | oui | oui | portefeuille | oui |
| `devis.brouillons.modifier` | Créer, modifier, supprimer un brouillon (Devis) | oui | oui | portefeuille | non |
| `devis.envoyer` | Envoyer, révoquer le lien | oui | oui | portefeuille | non |
| `devis.reponse.marquer` | Marquer accepté ou refusé | oui | oui | portefeuille | non |
| `devis.transformer` | Transformer en brouillon de facture | oui | oui | portefeuille | non |
| `factures.brouillons.voir` | Voir les brouillons de facture | oui | oui | portefeuille | oui |
| `factures.brouillons.modifier` | Créer, modifier, supprimer un brouillon (Factures et avoirs) | oui | oui | portefeuille | non |
| `factures.emises.voir` | Voir les factures émises, les avoirs et les paiements | oui | oui | lecture_portefeuille | oui |
| `factures.emettre` | Émettre une facture, relancer une certification | oui | oui | non | non |
| `factures.envoyer` | Envoyer une facture, révoquer le lien | oui | oui | non | non |
| `avoirs.emettre` | Émettre un avoir | oui | oui | non | non |
| `paiements.enregistrer` | Enregistrer un paiement | oui | oui | non | non |
| `paiements.annuler` | Annuler un paiement, enregistrer un remboursement | oui | oui | non | non |
| `relances.modeles.gerer` | Gérer les modèles de relance | oui | oui | non | non |
| `relances.envoyer` | Envoyer une relance | oui | oui | non | non |
| `tableau_de_bord.voir` | Voir le tableau de bord | oui | oui | portefeuille | oui |
| `exports.csv` | Exporter en CSV | oui | oui | non | oui |
| `exports.complet` | Exporter l'ensemble des données | oui | non | non | non |
| `journal.consulter` | Consulter le journal d'audit | oui | non | non | non |

33 droits, 132 cases. Les noms des droits sont validés (décision 7) ; les libellés et les valeurs sont ceux de `THREATS.md`. La ligne « Quitter l'organisation » a été ajoutée à `THREATS.md` à la validation (décision 5).

#### 8.3 Divergences avec `THREATS.md` section 6, signalées

1. **Lignes « Par lien, sans compte »** (consulter un devis et y répondre, consulter une facture) : non codées dans la matrice. Elles n'ont pas de rôle ; elles passent par la recherche du lien (`DESIGN.md` section 2.5), sans session, et auront leur propre chaîne aux 4.5 et 5.4. Le test de conformité les ignore explicitement, par leur libellé.
2. **« Chaque utilisateur gère en outre son propre compte »** (phrase sous le tableau) : non codé. Ces actions n'ont pas d'organisation (jalon 1).
3. **Départ volontaire d'une organisation** (`membre.parti` au journal) : la matrice n'avait pas de ligne. **Résolu à la validation (décision 5)** : ligne « Quitter l'organisation », oui pour les quatre rôles, ajoutée à `THREATS.md` section 6, et droit `organisation.quitter`. La phrase sous le tableau ne cite plus le départ parmi la gestion de son propre compte. La règle du dernier Propriétaire (R-12) reste un contrôle du service (2.4).
4. **Créer une organisation, changer d'organisation active** (F-010, F-014, UC-06, UC-11) : actions sans organisation active, ou avant elle. Hors de la matrice. Elles demanderont une variante de la chaîne « portée compte » (origine, session, validation, sans adhésion). Reporté à la 2.1.
5. **Annuler la suppression de l'organisation** (UC-13, erreur 4a) : rattachée au droit `organisation.supprimer` (décision 6).
6. Deux lignes portent le même libellé « Créer, modifier, supprimer un brouillon » (Devis, et Factures et avoirs). Le test de conformité identifie une ligne par son groupe et son libellé.

#### 8.4 Les tests de la matrice

Trois niveaux, qui répondent ensemble à « un test parcourt chaque case et vérifie la réponse du serveur ; ajouter une action sans son test fait échouer la suite » (`PLAN.md` section 4.4, T-50) :

1. **Conformité au document** (`matrice.test.ts`, sans base). Le test lit `docs/THREATS.md`, extrait le tableau de la section 6, et compare chaque case à `DROITS` : même ensemble de lignes (hors divergences 1 et 2, listées dans le test avec leur motif), mêmes valeurs pour les 132 cases. Un droit ajouté au code sans le document, ou au document sans le code, fait échouer la suite. C'est la mise en œuvre de « Un droit : `matrice.ts`, après mise à jour de THREATS.md » (`STRUCTURE.md` section 9).

   | Option | Avis |
   |---|---|
   | **T1. Le test lit `THREATS.md`** | Le document fait foi (`SPEC.md` section 2.2) et devient vérifié. Dépend du format du tableau, qui est stable. **Retenu (décision 8)** |
   | T2. Seconde transcription dans le test | Deux copies à tenir à jour ; une divergence avec le document passe |

2. **Réponse de la chaîne pour chaque action déclarée et chaque rôle** (`registre.integration.test.ts`, avec base). Pour chaque déclaration du registre et chacun des quatre rôles, un membre réel de ce rôle, avec une vraie session, appelle la chaîne : `peut(role, droit)` faux doit donner `refuse`, vrai ne doit pas donner `refuse` sur une ressource de sa propre organisation. Les données d'appel viennent d'un objet `CAS` du test, typé `satisfies Record<NomAction, CasAction>` : **une action ajoutée au registre sans son cas ne compile pas** (`npm run typecheck`), et un contrôle à l'exécution le vérifie aussi.

3. **Exhaustivité du registre** : le test d'inventaire (section 7) garantit qu'aucune action exposée n'échappe au registre, donc au niveau 2.

En 0.4, le registre est vide : le niveau 2 tourne sur zéro action. Sa mécanique est prouvée sur un registre de démonstration (section 9).

### 9. Sur quoi prouver la chaîne

Aucune action métier n'existe. Options :

| Option | Avis |
|---|---|
| P1. Une action de test exposée dans `src/app/` | Écarté : elle existerait en production (règle 11, `PLAN.md` principe 5) |
| P2. Une vraie action utile, par exemple « voir la liste des membres » | Écarté : c'est le travail d'une fonctionnalité du jalon 2, avec sa fiche, son écran et ses textes |
| **P3. Des déclarations de démonstration définies dans les fichiers de test seulement, passées directement à `executerChaine`** | `declarerAction` ne crée aucun point d'entrée : seul un export d'un fichier `"use server"` en crée un. Une déclaration faite dans un test n'existe que dans le test. **Retenu** |

Les déclarations de démonstration :

- `demo.lire` : droit `organisation.membres.voir` (tous les rôles), `journal: null`. Son service lit `temoin_isolation` et renvoie le contexte reçu.
- `demo.ecrire` : droit `organisation.supprimer` (Propriétaire seul), `journal: "organisation.parametres_modifies"`. Son service insère dans `temoin_isolation` et appelle `ctx.journaliser`.
- `demo.oubli_trace` : même droit, `journal` déclaré, service qui n'appelle pas `ctx.journaliser`.
- `demo.sensible` : `nouvelleAuthentification: true`.
- `demo.ressource` : reçoit un identifiant de ligne de `temoin_isolation` et appelle `ctx.introuvable()` si la ligne est absente.

Ces tests ont besoin de `drizzle-orm` pour lire et écrire `temoin_isolation` : ils vivent dans `src/server/db/` (`chaine.integration.test.ts`, `chaine.attaque.integration.test.ts`), seul endroit où un test peut l'importer (`CLAUDE.md`, « Pièges connus »).

Les tests qui valident une trace laissent leur organisation sur `dev` (`journal-audit.md`, décision 8). Ils l'évitent quand c'est possible : la plupart des vérifications de `demo.ecrire` se font dans une transaction annulée par une exception levée à la fin du service.

### 10. Des sessions réelles en test

Aucun écran de connexion n'existe. Vérifié dans `node_modules/better-auth/dist/plugins/test-utils/` : Better Auth 1.7.7 fournit le module `testUtils` (exporté par `better-auth/plugins`, **aucune dépendance nouvelle**). `login({ userId })` crée une vraie ligne `session` par l'adaptateur interne et renvoie les en-têtes `Cookie` signés avec le secret (`auth-helpers.mjs`). Les champs supplémentaires de la session, dont `activeOrganizationId`, sont acceptés (`createSession`, filtre sur le schéma de base). La documentation du module recommande une instance réservée aux tests, distincte de la configuration de production.

| Option | Avis |
|---|---|
| **S1. Instance Better Auth de test, dans `outils-test/`, avec les mêmes options que la production plus `testUtils()`** | Mêmes secret, adresse et noms de cookies : la session créée est lue par l'instance de production, par le vrai `getSession`. **Retenu (décision 13 pour `optionsAuth`)** |
| S2. Dépendance `lireSession` factice injectée dans la chaîne | Gardé pour les tests unitaires seulement : ne prouve pas la lecture réelle |
| S3. Insérer `session` à la main et signer le cookie soi-même | Réécrit ce que `testUtils` fait, avec le risque de diverger du format de Better Auth |

Pour partager les options sans les recopier, `config.ts` exporte l'objet d'options (`optionsAuth`) en plus de `auth`. Effet sur le générateur du schéma : aucun (mêmes options, même schéma) ; à vérifier par `git diff` si `auth.ts` est régénéré un jour.

Nouvel outil, `src/server/db/outils-test/membres.ts` :

- `creerMembre({ organisationId, role, organisationActive? })` : crée un `user` (email `test-<uuid>@exemple.test`), une ligne `member` avec le rôle donné (n'importe quelle chaîne, pour tester `owner` ou `comptable,proprietaire`), une session dont l'organisation active est `organisationActive` (par défaut `organisationId`, `null` possible). Renvoie `{ utilisateurId, membreId, entetes }`, `entetes` portant `Cookie` et une `Origin` valide.
- `nettoyer` supprime les utilisateurs créés (les sessions et adhésions suivent par `ON DELETE CASCADE` des tables de Better Auth), avant les organisations.
- Importable seulement depuis un test (règle ESLint D existante).

### 11. Points d'accroche pour la suite

| Point | Fonctionnalité | Ce que la 0.4 prépare |
|---|---|---|
| Limitation de débit | 0.5 | Étape 4 réservée dans l'ordre ; champ `debit` de la déclaration ajouté par la 0.5 (clé possible : utilisateur, organisation) |
| Nouvelle authentification avant une action sensible (S-14) | 1.6 (ajoutée à `PLAN.md`, décision 10), avant 2.2, 2.4, 2.5, 7.2 | Champ `nouvelleAuthentification` obligatoire ; `true` refusé tant que la 1.6 n'est pas livrée. Le mécanisme (`freshAge` de Better Auth, 24 h par défaut d'après `context/create-context.mjs`, trop long pour S-14) est choisi par la fiche 1.6 |
| Double authentification par rôle (S-12, S-13, T-02) | 1.4 | Étape 7 réservée, sans effet avant la 1.4 (décision 11) ; `user.two_factor_enabled` est déjà lu avec la session. Test à écrire en 1.4 : un Propriétaire puis un Comptable sans second facteur activé reçoivent `refuse` sur toute action, y compris de lecture ; le même compte, après activation, est accepté ; un Commercial et un Lecteur sans second facteur ne sont pas concernés |
| Visibilité des Commerciaux (F-016, T-31) | 7.4 | `ctx.perimetre` |
| Route de membre | 7.2 | Chaîne indépendante du transport ; adaptateur `exposerRoute` à livrer |
| Lecture par les pages | 0.6 | `etablirContexte` |
| Points d'entrée `/organization/*` de Better Auth | 1.1 (exposition de `/api/auth`) | Menace T-55, ajoutée à `THREATS.md` (décision 15) : ils contournent la chaîne (section 1.1). Better Auth offre `disabledPaths` (`api/index.mjs` ligne 166, réponse 404). `PLAN.md`, ligne 1.1 : fermeture avant toute exposition de la route ; toute opération d'organisation passe par la chaîne |
| Sessions d'un membre retiré | 2.4 | La chaîne refuse déjà ; vider `active_organization_id` reste à faire |
| Actions « portée compte » | 2.1 | Variante sans adhésion, à concevoir avec la création d'organisation |

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| S'appuyer sur le contrôle d'origine de Next.js seul | Laisse passer une requête sans `Origin`, compare à un en-tête de la requête, et n'existe pas pour `route.ts` |
| Contrôle d'accès de Better Auth (`hasPermission`) pour la matrice | Ne connaît que ses ressources ; rôles par défaut toujours actifs ; aucune lecture de la matrice possible par les tests |
| Un intergiciel (`proxy.ts`) qui contrôle toutes les requêtes | Ne connaît pas l'action visée ni son droit ; ne peut pas ouvrir la transaction du service |
| Bibliothèque d'actions serveur typées | Dépendance nouvelle (règle 10) pour une fonction de quelques dizaines de lignes, et contrôle moins direct de l'ordre |
| Vérifier le rôle dans chaque service | C'est exactement l'oubli que la chaîne supprime (T-50) |

## Règles de sécurité et permissions

- Exigences couvertes :
  - **S-02** : refus uniforme `refuse` (section 6).
  - **S-03** : droits vérifiés côté serveur à chaque requête, depuis la matrice.
  - **S-05** (en partie) : le rôle vient de la base, jamais de la requête ; une entrée contenant `role` est refusée. « Seul un Propriétaire attribue les rôles, nul ne modifie le sien » : droit `organisation.membres.gerer` réservé au Propriétaire ; la règle « pas le sien » est un contrôle du service de la 2.4.
  - **S-17** (en partie) : adhésion et rôle relus à chaque requête, verrouillés pendant l'action (section 2.2). La fermeture des sessions au changement de mot de passe est la 1.3.
  - **S-81** : origine obligatoire et égale à l'adresse configurée (section 3.3).
  - **S-01, S-04** : organisation de la session seule, transaction `executerDansOrganisation` pour tout service.
  - **S-50** : schéma strict obligatoire dans chaque déclaration.
  - **S-54, S-85** : codes sans texte ni valeur ; incident ; jamais le message d'une erreur dans le journal technique.
  - **S-70, S-71** : trace déclarée avec l'action, écrite dans sa transaction, auteur de la session, trace manquante = action annulée.
- Menaces concernées :
  - **T-17** : tests d'origine (section « Tests d'attaque »).
  - **T-50** : matrice unique, test de conformité, test par action et par rôle, inventaire.
  - **T-51** : rôle jamais lu dans la requête ; rôle inconnu ou multiple sans droit.
  - **T-52** : membre retiré ou rétrogradé refusé dès la requête suivante.
  - **T-54** : hors périmètre (règle du dernier Propriétaire, service de la 2.4, R-12). Mentionné car cité par la demande.
  - **T-30** : refus identique pour une ressource d'une autre organisation et une ressource inexistante.
  - **T-20** : trace obligatoire quand elle est déclarée.
  - **T-72** : règles ESLint et inventaire contre une action qui retirerait la chaîne.
  - **T-55** (nouvelle) : signalée et ajoutée à `THREATS.md` ; sa parade (fermeture des points d'entrée natifs) et son test appartiennent à la 1.1.
- Matrice des droits : créée (section 8.2), 33 droits. Aucune action réelle en 0.4.
- Tables créées ou modifiées : aucune. `member` est lue (`FOR SHARE`), sans changement de schéma.

## Dépendances nouvelles

Aucune (règle 10). `testUtils` fait partie de `better-auth` 1.7.7 ; `next/headers`, `next/navigation` (`unstable_rethrow`) font partie de `next` ; `zod` est déjà déclaré.

## Migration

Aucune. Ni table, ni colonne, ni droit. La colonne `member.role` garde son défaut `'member'`, qui vaut « aucun droit » (section 1.2).

## Découpage en PR

La fonctionnalité est de taille L. Retenu (décision 14) : une fiche, trois PR successives, la fiche passant à « livrée » avec la troisième. Condition : après la fusion de chacune, `main` reste cohérent (aucun document ne décrit comme en vigueur un contrôle qui n'existe pas encore sans le dater) et la CI est verte.

| PR | Contenu | Ce qu'elle prouve | Base |
|---|---|---|---|
| 1. Matrice | `matrice.ts` (rôles, 33 droits, `peut`, `perimetre`), `matrice.test.ts` ; documents mis à jour à la validation (`THREATS.md`, `PLAN.md`, `STRUCTURE.md`, cette fiche, `journal-audit.md`) | La matrice du code est identique, case par case, au tableau de `THREATS.md` ; toute divergence future fait échouer la CI ; les rôles hors liste n'ont aucun droit | Non |
| 2. Chaîne | `action.ts`, `origine.ts`, `refus.ts`, `exposer.ts`, `session.ts`, `requetes/adhesions.ts`, `outils-test/membres.ts`, `optionsAuth`, tests unitaires, d'intégration et d'attaque ; `DESIGN.md` section 3.2 | L'ordre des contrôles ; le refus uniforme (ressource d'une autre organisation et ressource inexistante indiscernables) ; l'origine (T-17) ; le membre retiré ou rétrogradé refusé (T-52) ; la trace obligatoire (T-20) ; l'auteur pris dans la session ; sur de vraies sessions et la vraie base | Oui |
| 3. Garde-fous | Règles ESLint G à L, `registre.ts`, `inventaire.test.ts`, `registre.integration.test.ts`, `CLAUDE.md` règle 5 | Aucune action ne contourne la chaîne : toute action exposée est déclarée, inscrite au registre et testée pour chaque rôle (T-50, T-72) ; un service n'ouvre pas de transaction et n'écrit pas au journal lui-même | Oui |

Cohérence de `main` entre les PR : `STRUCTURE.md` section 7 indique que les règles de la chaîne sont vérifiées par ESLint « à partir de sa troisième PR ». Aucune action n'existe avant la PR 3, donc aucune ne peut contourner la chaîne entre-temps.

## Critères d'acceptation

- [x] `matrice.ts` contient les 4 rôles et les 33 droits de la section 8.2 ; le test de conformité compare les 132 cases à `THREATS.md` et échoue si l'on change une valeur dans l'un ou l'autre (vérifié en changeant temporairement une case).
- [ ] `declarerAction` avec un droit inconnu, sans `entree`, sans `journal` ou sans `nouvelleAuthentification` ne compile pas (`@ts-expect-error`).
- [ ] La chaîne applique l'ordre de la section 5 ; un refus à une étape n'exécute aucune étape suivante (vérifié par dépendances espionnes).
- [ ] Origine absente, différente, `null`, ou `Sec-Fetch-Site` différent de `same-origin` : `refuse`, sans lecture de session.
- [ ] Sans session, session expirée, cookie falsifié : `connexion_requise`, sans transaction ouverte.
- [ ] Organisation active absente ou invalide : `refuse`, sans transaction ouverte.
- [ ] Adhésion absente (jamais membre, ou retiré après l'ouverture de la session) : `refuse`.
- [ ] Rôle `owner`, `admin`, `member`, vide, `comptable,proprietaire`, casse différente : `refuse` pour tout droit.
- [ ] Pour chaque rôle, `demo.lire` réussit et `demo.ecrire` est refusé sauf pour le Propriétaire.
- [ ] Rôle rétrogradé entre deux requêtes : la seconde applique le nouveau rôle.
- [ ] Un retrait de membre lancé pendant une action attend la fin de celle-ci (`FOR SHARE`), et la requête suivante est refusée.
- [ ] Une entrée invalide ou contenant `organisationId`, `role`, `auteurId` : `invalide`, `champs` sans valeur reçue ; aucune requête du service.
- [ ] Une ressource de B demandée par A et une ressource inexistante produisent des résultats strictement égaux (`toStrictEqual`).
- [ ] `demo.ecrire` valide : la ligne témoin et l'entrée du journal existent, l'entrée porte l'organisation de la session et `auteur_id` de la session.
- [ ] `demo.oubli_trace` : `erreur` avec incident, et la ligne témoin n'existe pas.
- [ ] `demo.sensible` : `refuse`, pour tous les rôles.
- [ ] Une erreur inattendue du service renvoie `erreur` et un incident ; le journal technique ne contient ni le message de l'erreur ni aucune valeur de l'entrée.
- [ ] `redirect()` levé dans un service traverse la chaîne.
- [ ] Les règles ESLint G à L refusent chacune un exemple fautif et acceptent l'exemple correct (`regles-import.test.ts`).
- [ ] Le test d'inventaire échoue sur un fichier `actions.ts` de démonstration dont un export n'est pas passé par `exposer`, sur une déclaration absente du registre, sur un `route.ts` hors liste ; il passe sur le dépôt.
- [ ] Le test par action et par rôle échoue sur un registre de démonstration contenant une action sans cas.
- [ ] `DESIGN.md` section 3.2, `STRUCTURE.md` sections 3.2, 3.3 et 7, `CLAUDE.md` règle 5 sont à jour.
- [ ] Tout nouveau fichier de `src/server/` commence par `import "server-only";`.
- [ ] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` (sur `dev` et en CI) passent.

## Tests à écrire

Tous écrits avant le code et vus en échec.

### Tests unitaires

`src/server/autorisation/matrice.test.ts` :

- [x] Conformité à `THREATS.md` section 6 (section 8.4, niveau 1). Divergence 1 exclue par son groupe (« Par lien, sans compte »), avec motif ; la divergence 2 est une phrase hors du tableau, rien à exclure.
- [x] Le test ne réussit pas à vide : il exige 33 lignes lues, et échoue sur un tableau de démonstration modifié.
- [x] Les identifiants des droits sont exactement les 33 de la section 8.2 (décision 7).
- [x] `peut` et `perimetre` pour les 132 cases.
- [x] `peut("owner", ...)`, `peut("", ...)`, `peut("Proprietaire", ...)`, rôles multiples, noms de propriétés héritées (`__proto__`, `constructor`), droits inconnus : faux, vérifié à l'exécution (voir « Notes de l'implémentation »).

`src/server/actions/origine.attaque.test.ts` :

- [ ] Origine égale à `BETTER_AUTH_URL` : acceptée ; même hôte, autre port ou autre schéma : refusée ; sous-domaine : refusée ; `null` : refusée ; absente : refusée ; `Sec-Fetch-Site: cross-site` ou `same-site` : refusée.

`src/server/actions/action.test.ts` (dépendances factices) :

- [ ] Ordre des étapes ; aucune étape après un refus.
- [ ] Traduction des erreurs (section 6.3), dont `unstable_rethrow`.
- [ ] Journal technique : ni message d'erreur, ni valeur d'entrée, ni `cause`.
- [ ] `champs` de `invalide` : chemins seulement.
- [ ] `@ts-expect-error` sur les déclarations incomplètes.

`src/server/actions/inventaire.test.ts` : section 7.

`src/server/db/regles-import.test.ts` : règles G à L.

### Tests d'intégration

`src/server/db/chaine.integration.test.ts` (sessions réelles, section 10) :

- [ ] `demo.lire` par chacun des quatre rôles : le contexte reçu porte l'utilisateur, l'organisation et le rôle de la base, `perimetre` correct.
- [ ] `demo.ecrire` par le Propriétaire : ligne témoin et trace écrites ensemble ; auteur de la session.
- [ ] `demo.oubli_trace` : annulée.
- [ ] Le service s'exécute dans la transaction de l'organisation active (il lit ses lignes de `temoin_isolation`, pas celles de B).

`src/server/actions/registre.integration.test.ts` : niveau 2 de la section 8.4, sur le registre réel (vide) et sur un registre de démonstration.

### Tests d'attaque

`src/server/db/chaine.attaque.integration.test.ts` :

- [ ] **Sans session** : aucun cookie, cookie au jeton inconnu, cookie à la signature modifiée, session expirée : `connexion_requise`.
- [ ] **Autre organisation** : membre de B avec l'organisation active A forcée dans sa session (écriture directe en base) : `refuse`. Membre de B qui demande par `demo.ressource` une ligne de A, puis une ligne inexistante : résultats égaux.
- [ ] **Rôle insuffisant** : chaque rôle non autorisé sur `demo.ecrire` : `refuse`, aucune ligne écrite.
- [ ] **Entrée falsifiée** : `organisationId: B`, `role: "proprietaire"`, `auteurId` d'un autre utilisateur dans l'entrée : `invalide`, rien d'écrit ; une entrée non objet, `null`, très profonde : `invalide`.
- [ ] **T-17** : requête complète avec une session valide et une `Origin` d'un autre site : `refuse`, rien d'écrit.
- [ ] **T-51** : `member.role` à `owner`, `admin`, `comptable,proprietaire` : `refuse` partout.
- [ ] **T-52** : membre retiré (ligne `member` supprimée) après la création de sa session : `refuse` à la requête suivante ; rôle passé de `comptable` à `lecteur` : `demo` réservée refusée à la requête suivante.
- [ ] **T-52, concurrence** : action en cours qui tient l'adhésion ; suppression de la ligne `member` dans une autre connexion : la suppression attend la fin de l'action.
- [ ] **Organisation active falsifiée** : valeur non UUID, UUID d'une organisation inexistante : `refuse`.

### Tests de bout en bout

- [ ] Aucun. Aucune page, aucune action exposée.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/autorisation/matrice.ts`, `matrice.test.ts`
- `src/server/actions/action.ts`, `refus.ts`, `origine.ts`, `exposer.ts`, `registre.ts`
- `src/server/actions/action.test.ts`, `origine.attaque.test.ts`, `inventaire.test.ts`, `registre.integration.test.ts`
- `src/server/auth/session.ts`
- `src/server/db/requetes/adhesions.ts`
- `src/server/db/outils-test/membres.ts`
- `src/server/db/chaine.integration.test.ts`, `src/server/db/chaine.attaque.integration.test.ts`

Modifiés :

- `src/server/auth/config.ts` : export de `optionsAuth` (section 10)
- `src/server/db/outils-test/organisations.ts` : nettoyage des utilisateurs avant les organisations, si `membres.ts` ne le porte pas seul
- `eslint.config.mjs` : règles G à L ; `src/server/db/regles-import.test.ts`
- `docs/DESIGN.md` section 3.2 : adhésion lue dans la transaction, modèle de refus
- `docs/STRUCTURE.md` sections 3.2, 3.3, 7 (services sans `server/journal/` ; `server/actions/` importe `server/db/client` et `server/journal/`)
- `CLAUDE.md` règle 5 : forme `declarerAction` / `exposer`, et le registre
- Faits à la validation : `docs/THREATS.md` (section 6 : ligne « Quitter l'organisation » et phrase sous le tableau ; section 5.6 : T-55), `docs/PLAN.md` (ligne 1.1, ligne 1.6, couverture de T-55, estimation), `docs/STRUCTURE.md` (sections 3, 3.1, 3.2, 3.3, 7, 9), `docs/features/journal-audit.md` (statut « livrée »)
- `docs/features/chaine-controles.md` : statut

Inchangés : `drizzle/`, `scripts/`, `.github/workflows/` (la CI fournit déjà `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` au job avec base), `package.json`, `next.config.ts`.

## Reporté

### À la fonctionnalité 0.5 (limitation de débit)

- Le contrôle de débit à l'étape 4, et le champ de déclaration correspondant.

### À la fonctionnalité 0.6 (socle d'interface)

- L'adaptateur des pages et de `(app)/layout.tsx` sur `etablirContexte`.
- Les libellés français des codes `connexion_requise`, `refuse`, `invalide`, `erreur`, et l'affichage de l'incident.

### Au jalon 1

- 1.1 : fermer les points d'entrée `/organization/*` de Better Auth avant d'exposer `/api/auth` (T-55) ; trancher l'adresse de branche de Vercel sur `preview` et le réglage équivalent de Better Auth (décision 4).
- 1.4 : l'étape 7 (double authentification par rôle) et son test (section 11).
- 1.6 : le mécanisme de nouvelle authentification (S-14) et le passage de `nouvelleAuthentification: true` de « refusé » à « exigé ».

### Au jalon 2

- 2.1 : configuration `organization({ creatorRole: "proprietaire", roles })` ; variante « portée compte » de la chaîne (créer, changer d'organisation).
- 2.4 : vider l'organisation active des sessions d'un membre retiré ; règle « nul ne modifie son propre rôle » (S-05) et dernier Propriétaire (R-12, T-54) dans le service.

### Au jalon 7

- 7.2 : adaptateur `exposerRoute` pour les téléchargements.
- 7.4 : filtrage par `ctx.perimetre`.

### Au jalon 8

- 8.1 : le journal technique passe de `console.error` au service de suivi des erreurs.
- 8.1 : le signalement d'un rôle inconnu rencontré en base (`owner`, `admin`, `member`, valeur multiple), sans l'identifiant de l'utilisateur (décision 1). Jusque-là, ce rôle vaut « aucun droit » sans signalement.

## Décisions

Prises à la validation de la fiche, le 2026-10-09.

1. **Rôles.** R2 : nos quatre rôles (`proprietaire`, `comptable`, `commercial`, `lecteur`) en liste fermée ; toute autre valeur de `member.role`, y compris `'member'`, n'a aucun droit. Le signalement d'un rôle inconnu est reporté à la 8.1 (aucun journal technique n'existe).
2. **Adhésion.** C3 : relue dans la transaction de l'organisation active, avec `FOR SHARE`.
3. **Refus.** U2 : `connexion_requise` distinct de `refuse`.
4. **Origine.** Une seule adresse acceptée, celle de `BETTER_AUTH_URL`. L'adresse de branche de Vercel et le réglage équivalent de Better Auth sont tranchés par la fiche 1.1.
5. **Départ volontaire.** Ligne « Quitter l'organisation », oui pour les quatre rôles, ajoutée à `THREATS.md` ; droit `organisation.quitter`. La matrice compte 33 droits.
6. **Annulation de la suppression.** Rattachée à `organisation.supprimer`.
7. **Noms des droits.** Ceux de la section 8.2.
8. **Test de conformité.** T1 : le test lit `THREATS.md`.
9. **Pages.** Le noyau `etablirContexte` en 0.4, l'adaptateur des pages en 0.6.
10. **Nouvelle authentification.** Fermée par défaut : `nouvelleAuthentification: true` est refusé jusqu'à la livraison du mécanisme, inscrit dans `PLAN.md` comme fonctionnalité 1.6.
11. **Double authentification par rôle.** Rien d'exigé avant la 1.4 ; point d'accroche à l'étape 7 ; test à écrire en 1.4 (section 11).
12. **`journaliser` réservé à la chaîne** (règle J). `STRUCTURE.md` section 7 mise à jour.
13. **`optionsAuth`** exporté par `config.ts` pour l'instance de test.
14. **Découpage.** Trois PR sous une fiche, à condition qu'après chacune `main` reste cohérent et la CI verte.
15. **Points d'entrée natifs de Better Auth.** Confirmé : la fiche 1.1 les ferme avant toute exposition de `/api/auth` (inscrit dans `PLAN.md`, ligne 1.1), et toute opération d'organisation passe par la chaîne. Menace T-55 ajoutée à `THREATS.md`, avec sa parade.

Vérifié avant la phase rouge, par un essai jetable supprimé ensuite : la forme `export const x = exposer(...)` dans un fichier `"use server"` (section 3.2) et l'import de ces fichiers sous Vitest (section 7).

## Notes de l'implémentation

### PR 1 : signature de `peut` et `perimetre`

`peut(role, droit)` et `perimetre(role, droit)` reçoivent des `string`, et non les types précis `Role` et `Droit`, qui restent exportés. Deux raisons :

1. Le rôle vient de `member.role`, colonne `text` écrite par Better Auth : la chaîne le passera tel quel, sans conversion préalable. La protection est faite à l'exécution : seules les clés propres de la matrice comptent (`Object.hasOwn`), donc `owner`, `member`, `comptable,proprietaire`, `__proto__` ou `constructor` n'ont aucun droit.
2. Le test, écrit avant le code et non modifié, appelle `peut` et indexe `DROITS` avec des chaînes. Avec un paramètre typé `Droit`, `npm run typecheck` l'aurait refusé.

La phrase de la section « Tests unitaires » (« le type l'interdit ») a été corrigée en conséquence. La garantie de compilation demandée par la section 8.1 (« `declarerAction({ droit: "inconnu" })` ne compile pas ») reste à la charge de `declarerAction`, qui prendra le type `Droit` (PR 2).

`perimetre` d'un droit refusé vaut `"organisation"`. La chaîne ne l'appelle qu'après `peut`, il est donc sans effet.
