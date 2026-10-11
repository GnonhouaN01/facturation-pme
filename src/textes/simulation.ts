// Bandeau permanent du mode simulateur de certification (NF-01).
// Fiche : docs/features/socle-interface.md, section 10.

// Phase rouge : à remplacer par le texte.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const TEXTES_SIMULATION: {
  readonly bandeau: string;
} = nonImplemente();
