# CONTRIBUTING.md — Conventions de travail

Ces règles valent pour toute modification du dépôt, qu'elle soit écrite à la main ou avec Claude Code.

## 1. Branches

La branche `main` est protégée : rien n'y entre sans pull request.

| Préfixe | Usage | Exemple |
|---|---|---|
| `feat/` | Nouvelle fonctionnalité | `feat/clients` |
| `fix/` | Correction d'un défaut | `fix/total-tva` |
| `refactor/` | Réorganisation sans changement de comportement | `refactor/structure-dossiers` |
| `test/` | Ajout ou correction de tests seuls | `test/isolation-factures` |
| `docs/` | Documentation seule | `docs/conventions` |
| `chore/` | Outillage, dépendances, configuration | `chore/ci` |

Une branche porte un seul sujet et vit quelques jours au plus.

## 2. Commits

Format : `type(portée): message`, en français, à l'infinitif ou au présent, sans point final.

Les types sont ceux des préfixes de branche : `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. La portée est le domaine touché : `clients`, `factures`, `auth`, `db`, `design`.

Avant chaque commit :

1. `git add .`
2. `git status --short`, et compter les fichiers : un fichier en moins est un oubli, un fichier en trop est peut-être un secret.
3. Seulement ensuite, `git commit`.

## 3. Pull requests

- Une PR traite un seul sujet. Un déplacement de fichiers et une nouvelle fonctionnalité font deux PR.
- La description suit le modèle : problème, changement, vérification, sécurité.
- Avant de fusionner : contrôles au vert, onglet « Files changed » relu en entier, onglet « Commits » vérifié.
- Fusion par « Squash and merge », puis suppression de la branche distante.
- Une PR qui échoue à un contrôle se corrige. Elle ne se force pas.

Après la fusion, sur le poste :

1. `git switch main`, puis `git pull`.
2. Vérifier que le travail est bien dans `main`.
3. Seulement ensuite, `git branch -D <branche>`.

## 4. Fonctionnalités

Une fonctionnalité commence par une fiche `docs/features/<nom>.md`, copiée depuis `docs/features/_modele.md` et validée avant d'écrire le code.

Ordre de travail :

1. La fiche, avec les exigences de `SPEC.md` et les menaces de `THREATS.md` concernées.
2. Les tests, dont les tests d'attaque. Ils échouent.
3. Le code. Les tests passent.
4. Les vérifications : `typecheck`, `lint`, `test`, `test:e2e`, `build`.
5. La PR.

Un test écrit après le code doit être vu en échec une fois, en faussant temporairement sa valeur attendue.

## 5. Sécurité

- Aucun secret dans le dépôt, les journaux, les messages de commit, les descriptions de PR ou les conversations.
- Le fichier `.env.local` ne s'ouvre pas dans l'éditeur. Il se modifie par les scripts du dossier `scripts/`.
- Un secret exposé se renouvelle immédiatement. Il ne se « répare » pas.
- Une nouvelle dépendance se justifie par écrit dans la PR : nom exact, raison, alternative écartée.
- Une alerte de dépendance se trie avant d'agir : quel paquet, livré ou non, atteignable ou non. Jamais `npm audit fix --force`. Une faille acceptée s'inscrit dans `docs/EXCEPTIONS-SECURITE.md`.
- Une migration se lit avant d'être appliquée. Une migration appliquée ne se modifie plus.

## 6. Travailler avec Claude Code

- Un prompt donne le contexte, les étapes avec leur résultat attendu, les limites et le format du rapport.
- Exiger la preuve : la sortie de chaque commande, pas l'affirmation « c'est fait ».
- Lire toute commande soumise à autorisation avant de l'accepter. Ne jamais accorder « toujours autoriser » à une commande que l'on ne comprend pas.
- Les permissions et les fichiers du dossier `.claude/` se modifient à la main, jamais par l'assistant.
- Quand il signale un écart ou une question, trancher soi-même et l'écrire dans le document concerné.
