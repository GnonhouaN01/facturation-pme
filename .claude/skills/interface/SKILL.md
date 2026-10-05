---
name: interface
description: Règles d'interface du projet, issues du design system Signal. À utiliser pour tout travail sur une page, un composant, un formulaire, un style, ou un texte affiché à l'utilisateur.
---

Avant de modifier l'interface, lis `docs/DESIGN-SYSTEM.md`, au moins la section 5.

## Règles

1. Couleurs, rayons et polices viennent uniquement des variables du thème définies dans `src/app/globals.css`, par les classes Tailwind correspondantes (`bg-primary`, `text-muted-foreground`, `border-border`). Aucune couleur écrite en dur, aucune classe de palette Tailwind comme `bg-blue-600`.
2. Un seul bouton principal par écran. Les autres actions sont secondaires.
3. Un montant s'affiche avec la police à largeur fixe et des chiffres tabulaires, aligné à droite dans une colonne, au format « 1 180 000 F CFA ».
4. Tout état porte un libellé écrit. Les couleurs des pastilles suivent le tableau « États d'un document ». Jamais un simple point de couleur.
5. Chaque champ a un libellé visible, un message d'erreur relié au champ pour les lecteurs d'écran, et un focus visible. Cible tactile d'au moins 44 px.
6. Les textes sont en français, au vouvoiement, regroupés dans `src/textes/`. Un bouton porte un verbe et son objet. Pas d'emoji, pas de point d'exclamation.
7. Les messages liés à la sécurité reprennent mot pour mot le tableau « Ce que la sécurité impose à l'écran » : émission irréversible, mention de simulation, page introuvable, erreur générique, connexion échouée, lien expiré.
8. Réutilise les composants de `src/components/ui/`. Un nouveau composant shadcn s'ajoute par son nom, après accord, jamais par une adresse.
9. Icônes au trait, sans remplissage. Séparation par des traits et des fonds, sans ombre.
10. L'interface fonctionne à partir de 360 px de large : les menus s'empilent, les tableaux larges défilent dans leur cadre.

## Vérification

Après toute modification d'un écran : un test Playwright du parcours, puis une capture à 390 px et à 1280 px de large, comparée aux maquettes. Liste les écarts avant de les corriger.

Maquettes de référence : https://claude.ai/artifact/EXqXBCcqYsbuZtQyb5uLNk
