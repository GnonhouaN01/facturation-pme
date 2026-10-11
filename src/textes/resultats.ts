// Libellés des codes de résultat de la chaîne de contrôles (NF-01).
// Fiche : docs/features/socle-interface.md, section 11.1.

// Phase rouge : à remplacer par les textes.
function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const TEXTES_RESULTATS: {
  readonly connexion_requise: string;
  readonly refuse: string;
  readonly trop_de_requetes: string;
  readonly invalide: string;
  readonly erreur: string;
} = nonImplemente();
