import "server-only";

// Les limites de débit : source unique. Une fonctionnalité qui en ajoute une
// le fait ici, dans sa PR. Le nom apparaît en clair dans la clé du compteur :
// il ne désigne personne. Fiche : docs/features/limitation-debit.md,
// section 1.

export type Limite = {
  maximum: number;
  fenetreSecondes: number;
  // Ce que la clé désigne. En 0.5, l'utilisateur de la session seulement.
  par: "utilisateur";
};

export const LIMITES = {
  // Actions des membres, par la chaîne de contrôles (décision 4).
  "membre.action": { maximum: 60, fenetreSecondes: 60, par: "utilisateur" },
} as const satisfies Record<string, Limite>;

export type NomLimite = keyof typeof LIMITES;

// La plus longue fenêtre d'un ensemble de limites : au-delà, une ligne du
// compteur ne peut plus servir (purge, section 7).
export function fenetreMaxSecondes(limites: Readonly<Record<string, Limite>>): number {
  void limites;
  throw new Error("non implémenté");
}
