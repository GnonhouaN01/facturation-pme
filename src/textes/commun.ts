// Textes communs à toute l'interface (NF-01). Fiche :
// docs/features/socle-interface.md, section 11.1.

// Phase rouge : à remplacer par les textes.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const TEXTES_COMMUNS: {
  readonly produit: string;
  readonly description: string;
  readonly allerAuContenu: string;
  readonly menu: string;
  readonly revenirAccueil: string;
} = nonImplemente();
