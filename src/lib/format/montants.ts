// Formatage des montants en francs CFA (NF-02, R-01). Fiche :
// docs/features/socle-interface.md, section 11.2.

// Phase rouge : à remplacer par l'implémentation.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

// Montant suivi de l'unité : « 1 180 000 F CFA », espaces insécables.
export const formaterMontant: (montant: number) => string = nonImplemente;

// Montant en colonne, sans l'unité, rappelée dans l'en-tête.
export const formaterMontantColonne: (montant: number) => string = nonImplemente;
