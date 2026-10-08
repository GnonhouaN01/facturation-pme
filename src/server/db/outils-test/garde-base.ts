import "server-only";

// Garde-fou des tests avec base : refuse toute base qui n'est pas marquée
// comme base de test. Fiche : docs/features/acces-donnees.md, section 5.
// Non implémenté.

export type EtatBase = {
  marque: string | null;
  role: string | null;
  contourne: boolean | null;
};

// Décision pure, appliquée au résultat de la requête du garde-fou.
export function deciderBaseDeTest(etat: EtatBase): void {
  void etat;
  throw new Error("non implémenté : deciderBaseDeTest");
}

export async function verifierBaseDeTest(): Promise<void> {
  throw new Error("non implémenté : verifierBaseDeTest");
}
