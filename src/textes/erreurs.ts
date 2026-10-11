// Textes des pages « introuvable » et « erreur » (NF-01, S-02, S-85).
// Fiche : docs/features/socle-interface.md, sections 3 et 4.

// Phase rouge : à remplacer par les textes.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const TEXTES_ERREURS: {
  readonly introuvable: string;
  readonly erreur: string;
  readonly identifiantIncident: string;
  readonly recharger: string;
} = nonImplemente();
