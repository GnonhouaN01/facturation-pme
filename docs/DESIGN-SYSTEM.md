# DESIGN-SYSTEM.md — Signal, le design system

Application de facturation pour petites structures.
Statut : **validé**. Version du 5 octobre 2026.

## Comment lire ce document

Un design system est l'ensemble des règles visuelles de l'application, écrites une fois et appliquées partout. Ses valeurs élémentaires s'appellent des jetons : une décision visuelle à laquelle on donne un nom de rôle, comme `accent` ou `danger`, plutôt qu'un nom d'apparence.

- Les sections 1 à 4 listent les jetons et leurs valeurs exactes.
- La section 5 est le guide d'utilisation : principes, voix, états, composants, sécurité à l'écran, accessibilité.

Références visuelles :

- Le design system consultable : https://claude.ai/artifact/8CuzM4o4oao41AdAkenN7J
- Les maquettes des trois écrans principaux : https://claude.ai/artifact/EXqXBCcqYsbuZtQyb5uLNk

Dans le code, les jetons vivent dans `src/app/globals.css`, sous forme de variables du thème shadcn/ui. La correspondance figure à la fin du guide. Aucune couleur ne s'écrit en dur ailleurs.

---

## 1. Couleurs

| Jeton | Valeur | Usage |
|---|---|---|
| `fond` | `#FAFAFA` | Fond de page. Porte le texte encre et discret. |
| `surface` | `#FFFFFF` | Cartes, champs de saisie, tableaux, fenêtres de dialogue. |
| `surface-2` | `#F1F2F5` | Zones en retrait : en-têtes de tableau, lignes survolées, champs désactivés. |
| `encre` | `#0F1115` | Texte principal et titres, sur fond et surface. Filet épais au-dessus d'un total. |
| `discret` | `#5B6170` | Texte secondaire, libellés, légendes. Contraste suffisant sur fond et surface. |
| `ligne` | `#E1E3E8` | Séparateurs et bordures de cartes. Jamais pour un contrôle interactif. |
| `ligne-forte` | `#858B9B` | Bordure des champs de saisie, cases et boutons secondaires. |
| `accent` | `#2448C9` | Action principale d'un écran, liens, anneau de focus. Un seul bouton accent par écran. |
| `accent-survol` | `#1B379E` | État survolé ou pressé d'un élément accent. |
| `accent-clair` | `#E7ECFB` | Fond d'une ligne sélectionnée ou d'une pastille d'information. Porte du texte accent ou encre. |
| `sur-accent` | `#FFFFFF` | Texte et icônes posés sur accent ou accent-survol. |
| `succes` | `#14553B` | Texte et icône d'un état positif : payée, certifiée, acceptée. Sur succes-fond ou surface. |
| `succes-fond` | `#DAF2E6` | Fond des pastilles et bandeaux positifs. |
| `attention` | `#6A4500` | Texte d'un avertissement : simulation non certifiée, échéance proche, action irréversible. |
| `attention-fond` | `#FCEFC9` | Fond des bandeaux d'avertissement. |
| `danger` | `#9B1C1C` | Texte d'une erreur ou d'un état négatif : en retard, refusée, suppression. Fond des boutons destructeurs. |
| `danger-survol` | `#7A1515` | État survolé ou pressé d'un bouton destructeur. |
| `danger-fond` | `#FBE1E1` | Fond des pastilles et bandeaux d'erreur. |

## 2. Typographie

| Famille | Pile de polices |
|---|---|
| `display` | "Space Grotesk", "Segoe UI", system-ui, sans-serif |
| `sans` | "DM Sans", "Segoe UI", system-ui, sans-serif |
| `mono` | "DM Mono", Consolas, "Courier New", monospace |

| Style | Famille | Taille | Interligne | Graisse | Approche |
|---|---|---|---|---|---|
| `titre-1` | `display` | 32px | 38px | 600 | -0.02em |
| `titre-2` | `display` | 24px | 30px | 600 | -0.02em |
| `titre-3` | `display` | 18px | 26px | 600 | -0.01em |
| `corps` | `sans` | 15px | 24px | 400 | 0 |
| `corps-fort` | `sans` | 15px | 24px | 600 | 0 |
| `petit` | `sans` | 13px | 20px | 400 | 0 |
| `libelle` | `sans` | 12px | 16px | 600 | 0.08em |
| `montant` | `mono` | 15px | 24px | 500 | 0 |
| `montant-grand` | `mono` | 32px | 38px | 500 | -0.01em |

## 3. Espacements

| Jeton | Valeur | Usage |
|---|---|---|
| `espace-1` | 4px | Entre une icône et son libellé. |
| `espace-2` | 8px | Entre des éléments liés : libellé et champ, pastilles voisines. |
| `espace-3` | 12px | Marge intérieure verticale d'une ligne de tableau, entre deux boutons. |
| `espace-4` | 16px | Entre deux champs d'un formulaire. Marge de page sur mobile. |
| `espace-6` | 24px | Marge intérieure d'une carte. Entre deux cartes. |
| `espace-8` | 32px | Entre deux sections d'un écran. |
| `espace-12` | 48px | Marge de page sur ordinateur, entre le titre d'écran et le contenu. |

## 4. Rayons

| Jeton | Valeur | Usage |
|---|---|---|
| `rayon-sm` | 6px | Pastilles d'état, étiquettes. |
| `rayon-md` | 8px | Boutons, champs de saisie, bandeaux. |
| `rayon-lg` | 10px | Cartes, tableaux, fenêtres de dialogue. |

---

## 5. Guide d'utilisation

Signal est le design system de Facturation PME, un outil de devis et de factures pour les petites structures de Côte d'Ivoire. Net, lisible, sans ambiguïté : il va droit au chiffre.

Ce document fait foi pour toute interface du produit. Les valeurs exactes sont dans `tokens.json`.

### Principes

1. **Le chiffre d'abord.** Un montant est l'information la plus importante d'un écran. Il s'écrit en `montant` ou `montant-grand`, aligné à droite dans une colonne.
2. **Un écran, une action.** Un seul bouton `accent` par écran. Les autres actions sont secondaires.
3. **L'état se lit sans la couleur.** Tout état porte un libellé écrit. La couleur le renforce, elle ne le remplace jamais.
4. **Ce qui est irréversible prévient.** Émettre une facture, annuler un paiement, supprimer une organisation : l'interface annonce la conséquence avant de demander la confirmation.
5. **Ne rien révéler.** Un message d'erreur dit quoi faire, pas ce que le système sait.

### Voix

- En français. On vouvoie l'utilisateur.
- Des phrases courtes, à l'actif. « Enregistrer le paiement », pas « Procéder à l'enregistrement ».
- Un bouton porte un verbe et son objet : « Émettre la facture », « Relancer le client ». Jamais « OK » ni « Valider » seuls.
- Pas de jargon technique dans un message. « Cette page est introuvable », pas « Erreur 404 ».
- Pas de point d'exclamation, pas d'emoji.

#### Formats

| Donnée | Format | Exemple |
|---|---|---|
| Montant | Entier, espace comme séparateur de milliers, suivi de « F CFA » | 1 180 000 F CFA |
| Montant en colonne | Sans l'unité, rappelée dans l'en-tête | 450 000 |
| Date | Jour, mois, année | 05/10/2026 |
| Référence | Telle qu'attribuée, en `montant` | FAC-2026-0042 |
| Taux | Nombre, espace, pourcentage | 18 % |

### Couleur

Signal est un système à dominante neutre, avec une seule teinte d'identité.

| Rôle | Jetons | Règle |
|---|---|---|
| Fonds | `fond`, `surface`, `surface-2` | La page est en `fond`, le contenu dans des cartes en `surface`. `surface-2` marque un retrait |
| Texte | `encre`, `discret` | `encre` pour ce qu'on lit, `discret` pour ce qui l'accompagne |
| Traits | `ligne`, `ligne-forte` | `ligne` sépare, `ligne-forte` borde ce qui se manipule |
| Identité | `accent`, `accent-survol`, `accent-clair`, `sur-accent` | Réservé à l'action principale, aux liens et au focus |
| États | `succes`, `attention`, `danger` et leurs fonds | Toujours par paire : le texte sur son fond |

À ne pas faire : utiliser `accent` comme décoration, poser du texte `discret` sur `surface-2` en petit corps, signaler un état par un simple point de couleur.

### États d'un document

| État | Texte | Fond | Libellé |
|---|---|---|---|
| Brouillon | `discret` | `surface-2` | Brouillon |
| Envoyé, émise | `accent` | `accent-clair` | Envoyé, Émise |
| Accepté, payée, certifiée | `succes` | `succes-fond` | Accepté, Payée, Certifiée |
| Partiellement payée, en attente de certification | `attention` | `attention-fond` | Partiellement payée, En attente de certification |
| En retard, refusé, expiré | `danger` | `danger-fond` | En retard de 12 jours, Refusé, Expiré |

Une pastille d'état utilise `rayon-sm`, le style `petit` en graisse 600, et un libellé complet.

### Typographie

Trois familles, chacune avec un rôle.

| Famille | Police | Usage |
|---|---|---|
| `display` | Space Grotesk | Titres d'écran et de section, nom d'un client en tête de carte |
| `sans` | DM Sans | Tout le texte courant, les libellés, les boutons |
| `mono` | DM Mono | Montants, références, dates en colonne |

Les trois sont servies par Google Fonts. Les chiffres en `mono` ont tous la même largeur : dans une colonne, les unités s'alignent sous les unités.

- Un écran a un seul `titre-1`.
- `libelle` s'écrit en capitales, pour les en-têtes de colonne et les petites légendes.
- Le corps de texte ne descend jamais sous 13 px.

### Espacement et forme

L'échelle d'espacement repose sur un pas de 4 px. On n'utilise que ses valeurs : `espace-1` à `espace-12`.

- Une carte : marge intérieure `espace-6`, rayon `rayon-lg`, bordure `ligne`, pas d'ombre.
- Un bouton ou un champ : hauteur minimale de 44 px, rayon `rayon-md`.
- Entre deux sections d'un écran : `espace-8`.

Signal sépare par des traits et des fonds, pas par des ombres.

### Composants

Les composants sont ceux de shadcn/ui, habillés par ces jetons. Aucun n'est encore documenté ici : cette section se remplira au fil du développement.

| Composant | Règle |
|---|---|
| Bouton principal | Fond `accent`, texte `sur-accent`. Fond `accent-survol` au survol et à l'état pressé. Un seul par écran |
| Bouton secondaire | Fond `surface`, bordure `ligne-forte`, texte `encre` |
| Bouton destructeur | Fond `danger`, texte `sur-accent`. Fond `danger-survol` au survol et à l'état pressé. Seulement dans une fenêtre de confirmation |
| Champ | Fond `surface`, bordure `ligne-forte`, libellé toujours visible au-dessus |
| Champ en erreur | Bordure `danger`, message en `danger` sous le champ, relié au champ pour les lecteurs d'écran |
| Bandeau | Fond d'état, texte d'état, rayon `rayon-md`. Jamais de bordure latérale colorée |
| Tableau | En-tête en `libelle` sur `surface-2`, lignes séparées par `ligne`, montants à droite en `montant` |
| Total | Filet de 2 px en `encre` au-dessus, libellé et montant en graisse 700 |

### Ce que la sécurité impose à l'écran

| Situation | Règle d'interface |
|---|---|
| Émission d'une facture | Fenêtre de confirmation avec récapitulatif et bandeau `attention` : « Une facture émise ne peut plus être modifiée. » |
| Document produit en mode simulateur | Bandeau `attention` permanent : « Simulation : document non certifié par la DGI, sans valeur fiscale. » |
| Action sensible | Nouvelle saisie du mot de passe dans la fenêtre, avant le bouton d'action |
| Action destructrice | Bouton destructeur, jamais placé par défaut sous le curseur. L'annulation est le bouton par défaut |
| Accès refusé ou ressource absente | Le même écran « Cette page est introuvable », sans distinction |
| Erreur inattendue | « Une erreur est survenue. » suivi d'un identifiant d'incident. Aucun détail technique |
| Connexion échouée | « Email ou mot de passe incorrect », que le compte existe ou non |
| Page ouverte par un lien expiré | « Ce lien n'est plus valable », sans autre information |

### Accessibilité

- Contraste d'au moins 4,5 pour 1 pour le texte, 3 pour 1 pour les bordures de contrôle et les textes de 24 px et plus.
- Tout est atteignable et utilisable au clavier. Le focus est visible : anneau de 2 px en `accent`, décalé de 2 px.
- Chaque champ a un libellé visible. Une icône seule dans un bouton a un nom accessible.
- Cible tactile d'au moins 44 px.
- L'interface fonctionne à partir de 360 px de large : les menus s'empilent, les tableaux larges défilent dans leur cadre.

### Iconographie

Icônes au trait de la bibliothèque Lucide, livrée avec shadcn/ui : épaisseur 1,5 px, taille 16 ou 20 px, couleur du texte voisin. Pas d'emoji, pas d'icône remplie, pas d'illustration décorative.

Le produit n'a pas encore de logo. Son nom s'écrit en `display`, graisse 600.

### Correspondance avec shadcn/ui

Les variables du thème shadcn/ui reprennent ces jetons.

| Variable shadcn/ui | Jeton Signal |
|---|---|
| `--background` | `fond` |
| `--foreground` | `encre` |
| `--card`, `--popover` | `surface` |
| `--muted` | `surface-2` |
| `--muted-foreground` | `discret` |
| `--border` | `ligne` |
| `--input` | `ligne-forte` |
| `--primary`, `--ring` | `accent` |
| `--primary-foreground` | `sur-accent` |
| `--accent` | `accent-clair` |
| `--destructive` | `danger` |
| `--radius` | `rayon-md` |

### État du système

Première version : un thème clair, dix-sept couleurs, neuf styles de texte, sept pas d'espacement, trois rayons. Pas encore de thème sombre, de logo ni de composants documentés.
