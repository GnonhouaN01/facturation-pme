import "server-only";

import type { DependancesProfil } from "../../auth/profil";

// Dépendances du profil et des sessions pour les tests des fiches 1.1 à 1.4,
// qui n'appellent jamais un point du profil : chaque appel lève, ce qui fait
// échouer le test qui en atteindrait une par erreur. Ne s'importe que depuis
// un fichier de test. Fiche : docs/features/profil-sessions.md, « Tests à
// écrire ».
export function dependancesProfilInertes(): DependancesProfil {
  const inattendue = () => {
    throw new Error("dépendance du profil inattendue");
  };
  return {
    lireSession: async () => inattendue(),
    limiterProfil: async () => inattendue(),
    limiterMotDePasse: async () => inattendue(),
    motDePasseValide: async () => inattendue(),
    motDePasseCompromis: async () => inattendue(),
    revoquerSessionDe: async () => inattendue(),
    revoquerAutresSessions: async () => inattendue(),
    supprimerJetonsReinitialisation: async () => inattendue(),
    modifierNom: async () => inattendue(),
    notifier: () => inattendue(),
  };
}
