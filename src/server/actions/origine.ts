import "server-only";

// Contrôle de l'origine de la requête, en plus de celui de Next.js (S-81,
// T-17). Fonction pure. Fiche : docs/features/chaine-controles.md,
// section 3.3.

// Phase rouge : non implémenté.
export function verifierOrigine(entetes: Headers, origineAttendue: string): boolean {
  void entetes;
  void origineAttendue;
  throw new Error("non implémenté");
}
