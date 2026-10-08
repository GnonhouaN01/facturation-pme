# STRUCTURE.md — Structure des dossiers

Application de facturation pour petites structures.
Statut : **validé**. Version du 5 octobre 2026.

## Comment lire ce document

Ce document dit où va chaque fichier du projet, et pourquoi. Il traduit en dossiers l'architecture en couches de DESIGN.md, section 4.

Une bonne structure répond à deux questions sans réfléchir : « où est le code qui fait ceci ? » et « où dois-je mettre ce nouveau fichier ? ». Elle sert aussi la sécurité : quand la couche d'accès aux données tient dans un seul dossier, il n'y a qu'un endroit à auditer, et une règle automatique peut interdire d'y accéder d'ailleurs.

---

## 1. Vue d'ensemble

```
facturation-pme/
├── .claude/                 Configuration de Claude Code
├── docs/                    Documents de référence et fiches de fonctionnalité
├── drizzle/                 Migrations SQL générées
├── e2e/                     Tests de bout en bout (Playwright)
├── public/                  Fichiers statiques servis tels quels
├── scripts/                 Outils d'administration et de vérification
├── src/
│   ├── app/                 Pages et points d'entrée
│   ├── components/          Composants d'interface
│   ├── server/              Tout ce qui ne s'exécute que sur le serveur
│   ├── schemas/             Schémas de validation partagés
│   ├── lib/                 Fonctions utilitaires pures
│   └── textes/              Libellés de l'interface, en français
├── CLAUDE.md                Consignes pour Claude Code
└── fichiers de configuration (package.json, tsconfig.json, drizzle.config.ts...)
```

La frontière la plus importante passe au milieu de `src/` : le dossier `server/` contient tout ce qui touche à la base, aux secrets et aux droits. Rien de ce dossier ne doit jamais atteindre le navigateur.

---

## 2. Le dossier `src/app/` : pages et points d'entrée

Next.js transforme chaque sous-dossier de `app/` en adresse du site. Les dossiers entre parenthèses regroupent des pages sans apparaître dans l'adresse.

```
src/app/
├── (public)/                Pages sans session
│   ├── page.tsx             Accueil
│   ├── connexion/
│   ├── inscription/
│   └── mot-de-passe-oublie/
├── (app)/                   Pages avec session obligatoire
│   ├── layout.tsx           Vérifie la session, affiche le menu
│   ├── tableau-de-bord/
│   ├── clients/
│   │   ├── page.tsx         Liste
│   │   ├── [id]/page.tsx    Fiche
│   │   └── actions.ts       Actions serveur de ce domaine
│   ├── catalogue/
│   ├── devis/
│   ├── factures/
│   ├── paiements/
│   ├── relances/
│   ├── organisation/        Paramètres, membres, journal d'audit
│   └── compte/              Mot de passe, double authentification, sessions
├── lien/                    Pages publiques par lien
│   ├── devis/[jeton]/
│   └── facture/[jeton]/
├── api/
│   ├── auth/[...all]/       Route de Better Auth
│   └── taches/quotidienne/  Tâche planifiée
├── layout.tsx               Structure commune à toutes les pages
└── globals.css
```

**Les trois zones correspondent aux trois niveaux d'accès de THREATS.md.**

| Zone | Qui y accède | Frontière de confiance |
|---|---|---|
| `(public)/` | Tout le monde | F1 |
| `(app)/` | Un membre connecté | F2 |
| `lien/` | Le détenteur d'un jeton | F1, la plus exposée |

Regrouper les pages publiques par lien dans un dossier à part rend visible, d'un coup d'œil, toute la surface accessible sans compte.

**Les fichiers `actions.ts`** sont les points d'entrée des modifications. Ils ne contiennent aucune règle métier : chaque action y est déclarée à travers la fonction commune de contrôle, puis délègue à un service. Voir la section 3.3.

---

## 3. Le dossier `src/server/` : le cœur protégé

```
src/server/
├── db/                      Couche d'accès aux données
│   ├── client.ts            Connexion, transaction avec organisation active
│   ├── outils-test/         Outillage des tests avec base (tests seulement)
│   ├── schema/              Description des tables
│   │   ├── auth.ts          Tables de Better Auth (fichier généré)
│   │   ├── isolation.ts     Modèle de règle d'isolation
│   │   ├── technique.ts     Compteurs, table témoin, liens publics, journal d'audit
│   │   ├── organisation.ts  Paramètres, taux de TVA
│   │   ├── clients.ts
│   │   ├── catalogue.ts
│   │   ├── devis.ts
│   │   ├── factures.ts
│   │   └── paiements.ts
│   └── requetes/            Fonctions de lecture et d'écriture, par domaine
│       ├── adhesions.ts     Lecture de l'adhésion dans la transaction de l'organisation active
│       └── journal.ts       Insertion au journal d'audit (importée par journal/audit.ts seul)
├── auth/
│   ├── config.ts            Configuration de Better Auth
│   └── session.ts           Lecture de la session
├── autorisation/
│   └── matrice.ts           Les rôles, la matrice rôles x droits, unique, et peut()
├── actions/
│   ├── action.ts            La fonction commune de contrôle : declarerAction, la chaîne
│   ├── origine.ts           Contrôle de l'origine de la requête
│   ├── refus.ts             Modèle de résultat, traduction des erreurs
│   ├── exposer.ts           Adaptateur Next.js des actions serveur
│   ├── registre.ts          Liste de toutes les actions déclarées
│   └── <domaine>.ts         Déclarations des actions d'un domaine
├── services/                Règles métier, par domaine
│   ├── clients.ts
│   ├── devis.ts
│   ├── factures.ts
│   ├── paiements.ts
│   └── ...
├── modules/                 Composants interchangeables
│   ├── certification/       Interface, simulateur
│   ├── pdf/                 Génération des documents
│   └── email/               Interface, envoi réel, interception locale
├── journal/
│   ├── actions.ts           Liste fermée des actions, schémas stricts des détails
│   └── audit.ts             journaliser : seule écriture au journal d'audit
└── env.ts                   Lecture et validation des variables d'environnement
```

### 3.1 `db/` : le seul dossier qui parle à la base

- **`client.ts`** crée la connexion avec le rôle restreint, et fournit `executerDansOrganisation`, qui ouvre une transaction en fixant l'organisation active. **Toute requête métier passe par cette fonction**, et les fonctions de `requetes/` reçoivent sa `TransactionOrganisation`. `db`, sans organisation active, n'est importé que par `auth/config.ts` et par `db/` (règle ESLint).
- **`schema/`** décrit les tables. Un fichier par domaine, pour que chaque fiche de fonctionnalité touche un fichier précis. `auth.ts` est produit par l'outil de Better Auth et ne se modifie pas à la main. `isolation.ts` est le modèle unique de la règle de sécurité au niveau des lignes (`colonneOrganisation()`, `regleIsolation()`) ; `technique.ts` contient la table témoin `temoin_isolation`. Aucun fichier de test dans `schema/`, que drizzle-kit charge en entier.
- **`outils-test/`** contient l'outillage des tests avec base : création et nettoyage d'organisations, vérification générique d'isolation, garde-fou contre toute base non marquée. Il ne s'importe que depuis un fichier de test (règle ESLint).
- **`requetes/`** contient les fonctions qui lisent et écrivent. Ce sont les seules à utiliser Drizzle. `requetes/journal.ts` insère une entrée du journal d'audit sans la valider : il ne s'importe que depuis `server/journal/audit.ts` (règle ESLint). `requetes/adhesions.ts` lit le rôle de l'utilisateur dans l'organisation de la transaction, verrouillé en partage (`FOR SHARE`) jusqu'à la fin de l'action.
- **`executerDansOrganisation`** ne s'importe que dans `server/actions/action.ts`, dans `db/` et dans les tests (règle ESLint) : un service n'ouvre jamais de transaction, il reçoit celle de la chaîne.

### 3.2 `autorisation/` : un seul fichier pour les droits

`matrice.ts` est la transcription exacte du tableau de THREATS.md, section 6 : les quatre rôles (`proprietaire`, `comptable`, `commercial`, `lecteur`), un droit par ligne du tableau, et `peut(role, droit)`. Toute autre valeur de rôle n'a aucun droit. Les contrôles d'accès la lisent, et les tests aussi : un test compare chaque case au tableau de THREATS.md, et un autre vérifie, pour chaque action déclarée et chaque rôle, que la chaîne répond comme la matrice le dit. Un droit n'est donc défini qu'à un seul endroit (menace T-50). Fiche : `docs/features/chaine-controles.md`.

### 3.3 `actions/` : la chaîne de contrôles

`action.ts` contient la fonction commune décrite dans DESIGN.md, section 3.2. Elle enchaîne, dans l'ordre : origine de la requête, session, organisation active, puis, dans la transaction de cette organisation, adhésion et rôle, matrice, validation des données, service et trace au journal. Une action déclarée à travers elle ne peut pas atteindre un service sans avoir passé ces contrôles.

- Une action se **déclare** dans `actions/<domaine>.ts` par `declarerAction` (droit, schéma d'entrée, action du journal, nouvelle authentification), et figure dans `registre.ts`.
- Elle s'**expose** dans `src/app/(app)/<domaine>/actions.ts`, fichier `"use server"`, uniquement sous la forme `export const x = exposer(declaration)`. Une règle ESLint et un test d'inventaire refusent toute autre forme.
- Le service reçoit un contexte (utilisateur, organisation, rôle, transaction) et écrit au journal par `ctx.journaliser`, lié à l'action déclarée et à l'auteur de la session.

### 3.4 `services/` : les règles métier

Un service applique les règles de SPEC.md : calcul des totaux, cycle de vie d'un devis, numérotation, plafond des paiements. Il reçoit toujours un **contexte** déjà vérifié (utilisateur, organisation, rôle) et ne lit jamais lui-même une session ni une requête. Cela le rend simple à tester : on lui passe un contexte, on vérifie le résultat.

### 3.5 `modules/` : ce qui peut être remplacé

Chaque module est défini par une interface, avec plusieurs implémentations. La certification a son simulateur, l'envoi d'emails a sa version réelle et sa version qui intercepte. Brancher la vraie plateforme FNE reviendra à ajouter un fichier dans `certification/`, sans toucher aux services.

### 3.6 `env.ts` : les variables d'environnement

Le seul fichier qui lit `process.env`. Aucun autre fichier ne lit directement une variable d'environnement.

- `env-schema.ts`, à côté, contient le schéma Zod et la fonction pure `validerEnvironnement`. Elle reçoit les variables en paramètre, ce qui permet de la tester sans toucher à `process.env`. En cas d'erreur, son message nomme chaque variable fautive et la raison, jamais la valeur.
- `env.ts` appelle cette fonction sur `process.env` à son chargement et exporte l'objet `env`, seule source des variables pour le reste de `src/server/`.
- `src/instrumentation.ts` importe `env.ts` dans sa fonction `register`, que Next.js appelle au lancement du serveur : une variable invalide est consignée dès le démarrage. Le serveur ne s'arrête pas pour autant : tout module qui importe `env.ts` échoue au chargement, mais les pages statiques, qui ne lisent aucune variable, restent servies.

### 3.7 `journal/` : l'écriture au journal d'audit

- **`actions.ts`** tient la liste fermée des actions journalisables, leur type de ressource et le schéma strict de leurs détails (identifiants, valeurs énumérées, entiers, booléens ; aucun texte libre).
- **`audit.ts`** fournit `journaliser(tx, entree)`, **seule façon d'écrire au journal**. Elle reçoit la `TransactionOrganisation` de l'action, valide l'entrée, puis l'insère : l'action et sa trace sont validées ou annulées ensemble, et l'organisation de l'entrée est celle de la transaction. Fiche : `docs/features/journal-audit.md`.
- `journal_audit` est une table en ajout seul : le rôle de l'application n'y a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE`.

**Règle : aucun fichier hors de `src/server/db/` n'importe `drizzle-orm`.** C'est l'exigence S-86.

---

## 4. Les autres dossiers de `src/`

### `components/`

```
src/components/
├── ui/                      Composants shadcn/ui, copiés dans le projet
└── clients/, devis/, ...    Composants propres à un domaine
```

Un composant affiche et recueille des saisies. Il ne décide d'aucun droit et n'accède jamais à la base.

### `schemas/`

Les schémas Zod, un fichier par domaine. Ils sont importés à la fois par les formulaires, pour afficher les erreurs, et par les actions serveur, pour refuser une requête invalide. Une règle de validation n'est écrite qu'une fois (S-50).

### `lib/`

Des fonctions pures, sans dépendance au serveur ni au navigateur : formatage d'un montant en francs CFA, calcul de TVA, manipulation de dates. Ce sont les plus faciles à tester, et elles le sont toutes.

### `textes/`

Les libellés de l'interface, regroupés par domaine. Aucun texte destiné à l'utilisateur n'est écrit en dur dans un composant (NF-01).

---

## 5. Les dossiers à la racine

| Dossier | Contenu | Règle |
|---|---|---|
| `.claude/` | `settings.json`, `hooks/`, plus tard `skills/` et `agents/` | Commité, sauf `settings.local.json` |
| `docs/` | Documents de référence, `EXCEPTIONS-SECURITE.md`, `features/` | Une fiche par fonctionnalité dans `features/` |
| `drizzle/` | Migrations SQL et instantanés | Généré. Jamais modifié à la main |
| `e2e/` | Tests Playwright, un fichier par parcours | Seul Playwright les exécute |
| `scripts/` | Vérifications et administration | Seul endroit, avec `drizzle.config.ts`, autorisé à utiliser le rôle propriétaire |
| `public/` | Images et fichiers servis tels quels | Rien de confidentiel : tout y est public |

---

## 6. Où vont les tests

| Type | Emplacement | Nom |
|---|---|---|
| Test unitaire, sans base | À côté du fichier testé | `montants.test.ts` |
| Test d'intégration, avec base | À côté du service ou de la requête testés | `factures.integration.test.ts` |
| Test d'attaque avec base | À côté du service ou de l'action visés | `factures.attaque.integration.test.ts` |
| Test d'attaque sans base | À côté de la fonction visée | `env-schema.attaque.test.ts` |
| Test de bout en bout | `e2e/` | `devis-acceptation.spec.ts` |

Le suffixe `.integration.test.ts` marque tout test qui touche la base : `npm test` ne lance que les autres, `npm run test:integration` ne lance que ceux-là. Un test ne vit jamais dans `src/server/db/schema/`, que drizzle-kit charge en entier.

Le suffixe `.attaque` distingue les tests qui tentent de violer une exigence de sécurité. On peut ainsi les compter (`*.attaque*.test.ts`), les lancer seuls, et vérifier que chaque menace de priorité haute en possède au moins un (NF-06).

L'outillage des tests avec base vit dans `src/server/db/outils-test/`. Il ne s'importe que depuis un fichier de test (règle ESLint).

---

## 7. Qui a le droit d'importer quoi

Ces règles seront vérifiées automatiquement par l'analyse du code, en phase 9.

| Dossier | Peut importer | Ne peut pas importer |
|---|---|---|
| `app/`, `components/` | `components/`, `schemas/`, `lib/`, `textes/`, et `server/` uniquement par les actions et les services | `server/db/` |
| `server/actions/` | `server/auth/`, `server/autorisation/`, `server/db/client.ts` (`executerDansOrganisation`), `server/db/requetes/adhesions.ts`, `server/journal/`, `server/services/`, `schemas/` ; `next/headers` dans `exposer.ts` seulement | Les autres fichiers de `server/db/requetes/` |
| `server/services/` | `server/db/` (sauf `executerDansOrganisation`), `server/modules/`, `lib/`, `schemas/` | `app/`, `components/`, `server/journal/` (le journal s'écrit par `ctx.journaliser`) |
| `server/journal/` | `server/db/` (le type `TransactionOrganisation` et `requetes/journal.ts`), `zod` | Tout le reste du projet |
| `server/db/` | `drizzle-orm`, `pg`, `server/env.ts` | Tout le reste de `server/` |
| `schemas/`, `lib/`, `textes/` | Rien du projet, sauf entre eux | `server/`, `app/`, `components/` |

Règles de la chaîne de contrôles (fonctionnalité 0.4, vérifiées par ESLint à partir de sa troisième PR) :

- `journaliser` ne s'importe que dans `server/actions/action.ts` et les tests.
- `executerDansOrganisation` ne s'importe que dans `server/actions/action.ts`, `server/db/` et les tests.
- La chaîne `app.organisation_id` n'apparaît que dans `server/db/client.ts` et `server/db/schema/isolation.ts`.
- `"use server"` n'apparaît qu'en tête des fichiers `src/app/**/actions.ts`, dont chaque export est `exposer(...)`.

Quatre règles s'y ajoutent :

1. **`drizzle-orm` ne s'importe que dans `src/server/db/`.**
2. **`process.env` ne se lit que dans `src/server/env.ts`.**
3. **`src/server/db/requetes/journal.ts` ne s'importe que depuis `src/server/journal/audit.ts`** et les tests (règle ESLint) : toute écriture au journal passe par `journaliser`.
4. **Aucun composant exécuté dans le navigateur n'importe `src/server/`.** Le marqueur `server-only`, qui fait échouer la construction dans ce cas, sera mis en place avec les règles d'analyse du code, car il demande des réglages pour Vitest, les scripts et l'outil de Better Auth.

---

## 8. Ce qui change par rapport à l'emplacement provisoire

| Aujourd'hui | Emplacement définitif |
|---|---|
| `src/db/index.ts` | `src/server/db/client.ts` |
| `src/db/schema.ts` | `src/server/db/schema/technique.ts` |
| `src/db/auth-schema.ts` | `src/server/db/schema/auth.ts` |
| `src/lib/auth.ts` | `src/server/auth/config.ts` |

Ce déplacement entraîne quatre ajustements : le chemin du schéma dans `drizzle.config.ts`, le chemin protégé dans `.claude/settings.json`, les mentions dans `CLAUDE.md`, et l'import du script `scripts/verifier-auth.mts`.

---

## 9. Où mettre un nouveau fichier

Les dossiers et fichiers de ce document se créent au fur et à mesure, avec la fonctionnalité qui en a besoin. Aucun dossier vide n'est créé d'avance.

| Je veux ajouter... | Il va dans... |
|---|---|
| Une page | `src/app/(app)/<domaine>/` ou `src/app/(public)/` |
| Une action de modification | Déclarée par `declarerAction` dans `src/server/actions/<domaine>.ts` et inscrite dans `registre.ts`, puis exposée par `exposer` dans `src/app/(app)/<domaine>/actions.ts` |
| Une règle métier | `src/server/services/<domaine>.ts` |
| Une requête à la base | `src/server/db/requetes/<domaine>.ts` |
| Une table | `src/server/db/schema/<domaine>.ts`, puis une migration générée |
| Un droit | `src/server/autorisation/matrice.ts`, après mise à jour de THREATS.md |
| Une règle de validation | `src/schemas/<domaine>.ts` |
| Un calcul réutilisable | `src/lib/` |
| Un texte affiché | `src/textes/` |
| Un bouton, un champ | `src/components/ui/`, par la commande shadcn |
| Un composant métier | `src/components/<domaine>/` |
