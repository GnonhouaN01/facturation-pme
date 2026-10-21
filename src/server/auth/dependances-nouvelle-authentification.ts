import "server-only";

import type { NomLimite } from "../debit/limites";

import { creerLectureSession } from "./dependances-double-auth";
import type { DependancesDoubleAuth } from "./double-authentification";
import type { DependancesNouvelleAuthentification } from "./nouvelle-authentification";

// Les dépendances de la nouvelle authentification liées aux fonctions de la
// double authentification (même lecture de session par l'adaptateur interne,
// même vérification du mot de passe), à un compteur et à la requête de
// db/nouvelle-authentification.ts : une seule fabrique pour gestionnaire.ts
// et pour le banc des tests d'intégration. Fiche :
// docs/features/nouvelle-authentification.md, section 2.

export type OptionsDependancesNouvelleAuthentification = {
  contexte: () => Promise<unknown>;
  doubleAuth: Pick<DependancesDoubleAuth, "motDePasseValide">;
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  enregistrerPreuve: (utilisateurId: string, sessionId: string) => Promise<void>;
};

export function creerDependancesNouvelleAuthentification(
  options: OptionsDependancesNouvelleAuthentification,
): DependancesNouvelleAuthentification {
  return {
    lireSession: creerLectureSession({ contexte: options.contexte }),
    limiter: (utilisateurId) =>
      options.verifierDebit("auth.nouvelle_authentification", utilisateurId),
    motDePasseValide: options.doubleAuth.motDePasseValide,
    enregistrerPreuve: options.enregistrerPreuve,
  };
}
