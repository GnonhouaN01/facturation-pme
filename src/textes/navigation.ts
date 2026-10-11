// Textes de la navigation de l'application (NF-01). Une entrée n'a de
// libellé qu'avec sa page : en 0.6, le tableau de bord seul. Fiche :
// docs/features/socle-interface.md, sections 2.4 et 10.

export const TEXTES_NAVIGATION = {
  // Nom accessible de l'élément nav.
  nom: "Navigation principale",
  organisationActive: "Organisation active",
  entrees: {
    tableauDeBord: "Tableau de bord",
  },
  // Clés : les rôles de src/server/autorisation/matrice.ts.
  roles: {
    proprietaire: "Propriétaire",
    comptable: "Comptable",
    commercial: "Commercial",
    lecteur: "Lecteur",
  },
} as const;
