import "server-only";

import type { Compteur } from "../db/debit";

import type { Limite, NomLimite } from "./limites";

// La fonction réutilisable : compte une tentative pour une limite et une
// valeur, et dit si la limite est atteinte. Ne s'appelle jamais pendant une
// transaction ouverte (section 2.1). Fiche : docs/features/limitation-debit.md,
// section 2.

export type Verificateur = {
  // Vrai : sous la limite, la tentative est permise.
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  // La clé du compteur, pour les tests qui nettoient leurs lignes.
  cle: (nom: NomLimite, valeur: string) => string;
};

export function creerVerificateur(options: {
  limites: Readonly<Record<NomLimite, Limite>>;
  compteur: Compteur;
  secret: Uint8Array;
}): Verificateur {
  void options;
  return {
    verifierDebit: async () => {
      throw new Error("non implémenté");
    },
    cle: () => {
      throw new Error("non implémenté");
    },
  };
}

// Vérificateur lié aux vraies limites, au vrai compteur et à la clé dérivée.
export async function verifierDebit(nom: NomLimite, valeur: string): Promise<boolean> {
  void nom;
  void valeur;
  throw new Error("non implémenté");
}

// Purge des compteurs expirés, appelée par la tâche quotidienne (jalon 1).
export async function purgerCompteurs(): Promise<number> {
  throw new Error("non implémenté");
}
