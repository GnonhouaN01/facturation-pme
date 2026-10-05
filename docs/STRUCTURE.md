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
│   ├── schema/              Description des tables
│   │   ├── auth.ts          Tables de Better Auth (fichier généré)
│   │   ├── technique.ts     Compteurs, liens publics, journal d'audit
│   │   ├── organisation.ts  Paramètres, taux de TVA
│   │   ├── clients.ts
│   │   ├── catalogue.ts
│   │   ├── devis.ts
│   │   ├── factures.ts
│   │   └── paiements.ts
│   └── requetes/            Fonctions de lecture et d'écriture, par domaine
├── auth/
│   ├── config.ts            Configuration de Better Auth
│   └── session.ts           Lecture de la session et de l'adhésion
├── autorisation/
│   ├── matrice.ts           La matrice rôles x actions, unique
│   └── verifier.ts          « Ce rôle peut-il faire cette action ? »
├── actions/
│   └── action.ts            La fonction commune de contrôle
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
│   └── audit.ts             Écriture au journal d'audit
└── env.ts                   Lecture et validation des variables d'environnement
```

### 3.1 `db/` : le seul dossier qui parle à la base

- **`client.ts`** crée la connexion avec le rôle restreint, et fournit la fonction qui ouvre une transaction en fixant l'organisation active. Aucune requête métier ne s'exécute hors de cette fonction.
- **`schema/`** décrit les tables. Un fichier par domaine, pour que chaque fiche de fonctionnalité touche un fichier précis. `auth.ts` est produit par l'outil de Better Auth et ne se modifie pas à la main.
- **`requetes/`** contient les fonctions qui lisent et écrivent. Ce sont les seules à utiliser Drizzle.

**Règle : aucun fichier hors de `src/server/db/` n'importe `drizzle-orm`.** C'est l'exigence S-86.

### 3.2 `autorisation/` : un seul fichier pour les droits

`matrice.ts` est la transcription exacte du tableau de THREATS.md, section 6. Les contrôles d'accès la lisent, et les tests aussi : un test parcourt chaque case et vérifie que le serveur répond comme la matrice le dit. Un droit n'est donc défini qu'à un seul endroit (menace T-50).

### 3.3 `actions/` : la chaîne de contrôles

`action.ts` contient la fonction commune décrite dans DESIGN.md, section 3.2. Elle enchaîne, dans l'ordre : origine de la requête, session, rôle, validation des données. Une action déclarée à travers elle ne peut pas atteindre un service sans avoir passé ces quatre contrôles.

### 3.4 `services/` : les règles métier

Un service applique les règles de SPEC.md : calcul des totaux, cycle de vie d'un devis, numérotation, plafond des paiements. Il reçoit toujours un **contexte** déjà vérifié (utilisateur, organisation, rôle) et ne lit jamais lui-même une session ni une requête. Cela le rend simple à tester : on lui passe un contexte, on vérifie le résultat.

### 3.5 `modules/` : ce qui peut être remplacé

Chaque module est défini par une interface, avec plusieurs implémentations. La certification a son simulateur, l'envoi d'emails a sa version réelle et sa version qui intercepte. Brancher la vraie plateforme FNE reviendra à ajouter un fichier dans `certification/`, sans toucher aux services.

### 3.6 `env.ts` : les variables d'environnement

Le seul fichier qui lit `process.env`. Il valide chaque variable au démarrage avec un schéma, et arrête l'application avec un message clair si l'une manque. Aucun autre fichier ne lit directement une variable d'environnement.

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
| Test unitaire | À côté du fichier testé | `montants.test.ts` |
| Test d'attaque | À côté du service ou de l'action visés | `factures.attaque.test.ts` |
| Test de bout en bout | `e2e/` | `devis-acceptation.spec.ts` |

Le suffixe `.attaque.test.ts` distingue les tests qui tentent de violer une exigence de sécurité. On peut ainsi les compter, les lancer seuls, et vérifier que chaque menace de priorité haute en possède au moins un (NF-06).

---

## 7. Qui a le droit d'importer quoi

Ces règles seront vérifiées automatiquement par l'analyse du code, en phase 9.

| Dossier | Peut importer | Ne peut pas importer |
|---|---|---|
| `app/`, `components/` | `components/`, `schemas/`, `lib/`, `textes/`, et `server/` uniquement par les actions et les services | `server/db/` |
| `server/actions/` | `server/auth/`, `server/autorisation/`, `schemas/` | `server/db/requetes/` directement |
| `server/services/` | `server/db/`, `server/modules/`, `server/journal/`, `lib/`, `schemas/` | `app/`, `components/` |
| `server/db/` | `drizzle-orm`, `pg`, `server/env.ts` | Tout le reste de `server/` |
| `schemas/`, `lib/`, `textes/` | Rien du projet, sauf entre eux | `server/`, `app/`, `components/` |

Trois règles s'y ajoutent :

1. **`drizzle-orm` ne s'importe que dans `src/server/db/`.**
2. **`process.env` ne se lit que dans `src/server/env.ts`.**
3. **Aucun composant exécuté dans le navigateur n'importe `src/server/`.** Le marqueur `server-only`, qui fait échouer la construction dans ce cas, sera mis en place avec les règles d'analyse du code, car il demande des réglages pour Vitest, les scripts et l'outil de Better Auth.

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
| Une action de modification | `src/app/(app)/<domaine>/actions.ts`, déclarée par la fonction commune |
| Une règle métier | `src/server/services/<domaine>.ts` |
| Une requête à la base | `src/server/db/requetes/<domaine>.ts` |
| Une table | `src/server/db/schema/<domaine>.ts`, puis une migration générée |
| Un droit | `src/server/autorisation/matrice.ts`, après mise à jour de THREATS.md |
| Une règle de validation | `src/schemas/<domaine>.ts` |
| Un calcul réutilisable | `src/lib/` |
| Un texte affiché | `src/textes/` |
| Un bouton, un champ | `src/components/ui/`, par la commande shadcn |
| Un composant métier | `src/components/<domaine>/` |
