import "server-only";

import { db, type BaseDeDonnees } from "./client";

// Le compteur de débit : une instruction atomique par tentative, hors de
// toute transaction d'organisation, et la purge des lignes expirées. Seul
// fichier qui touche compteur_debit (règle N). Fiche :
// docs/features/limitation-debit.md, sections 2, 4 et 7.

export type RegleDebit = {
  maximum: number;
  fenetreSecondes: number;
};

export type Compteur = {
  // Compte une tentative et renvoie le compte après l'incrément, plafonné à
  // maximum + 1.
  consommer: (cle: string, regle: RegleDebit) => Promise<number>;
  // Supprime les lignes dont la fenêtre a commencé il y a plus de
  // fenetreSecondes ; renvoie le nombre de lignes supprimées.
  purger: (fenetreSecondes: number) => Promise<number>;
};

// Fabrique liée à une base : les tests de concurrence s'en servent avec un
// Pool de plusieurs dizaines de connexions.
export function creerCompteur(base: BaseDeDonnees): Compteur {
  void base;
  return {
    consommer: async () => {
      throw new Error("non implémenté");
    },
    purger: async () => {
      throw new Error("non implémenté");
    },
  };
}

export const compteur = creerCompteur(db);
