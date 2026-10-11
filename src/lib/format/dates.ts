// Formatage des dates au format jour/mois/année (NF-02), fuseau
// Africa/Abidjan. Fiche : docs/features/socle-interface.md, section 11.3.

// Phase rouge : à remplacer par l'implémentation.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

// Un instant (horodatage), affiché au jour d'Abidjan.
export const formaterDate: (instant: Date) => string = nonImplemente;

// Une date de calendrier AAAA-MM-JJ (colonne date), sans fuseau.
export const formaterJour: (jour: string) => string = nonImplemente;
