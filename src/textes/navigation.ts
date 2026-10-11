// Textes de la navigation de l'application (NF-01). Une entrée n'a de
// libellé qu'avec sa page. Fiche : docs/features/socle-interface.md,
// sections 2.4 et 10.

// Phase rouge : à remplacer par les textes.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const TEXTES_NAVIGATION: {
  readonly nom: string;
  readonly organisationActive: string;
  readonly entrees: { readonly tableauDeBord: string };
  readonly roles: {
    readonly proprietaire: string;
    readonly comptable: string;
    readonly commercial: string;
    readonly lecteur: string;
  };
} = nonImplemente();
