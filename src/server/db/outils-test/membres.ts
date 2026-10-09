import "server-only";

// Outillage des tests avec base : membres et sessions réelles, par l'instance
// Better Auth de test (optionsAuth + testUtils). Ne s'importe que depuis un
// fichier de test. Fiche : docs/features/chaine-controles.md, section 10.

export type Membre = {
  utilisateurId: string;
  membreId: string;
  // Cookie de session signé et Origin valide.
  entetes: Headers;
};

export type OptionsMembre = {
  organisationId: string;
  // N'importe quelle chaîne : owner, comptable,proprietaire, vide...
  role: string;
  // Par défaut organisationId ; null possible.
  organisationActive?: string | null;
};

// Phase rouge : non implémenté.
export async function creerMembre(options: OptionsMembre): Promise<Membre> {
  void options;
  throw new Error("non implémenté");
}

// Supprime les utilisateurs créés par ce fichier de test (sessions et
// adhésions suivent par ON DELETE CASCADE). Phase rouge : non implémenté.
export async function nettoyerMembres(): Promise<void> {
  throw new Error("non implémenté");
}
