import "server-only";

// Clé d'un compteur : le nom de la limite en clair, suivi d'une empreinte
// HMAC-SHA-256 du nom et de la valeur comptée. Jamais la valeur en clair
// (S-54). Fiche : docs/features/limitation-debit.md, section 3.

// Clé secrète des empreintes, dérivée de BETTER_AUTH_SECRET par HKDF
// (décision 1).
export function deriverSecret(secretAuth: string): Uint8Array {
  void secretAuth;
  throw new Error("non implémenté");
}

export function cleCompteur(nom: string, valeur: string, secret: Uint8Array): string {
  void nom;
  void valeur;
  void secret;
  throw new Error("non implémenté");
}
