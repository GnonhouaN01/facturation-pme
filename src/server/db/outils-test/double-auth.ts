import "server-only";

import type { DependancesDoubleAuth } from "../../auth/double-authentification";

// Dépendances de double authentification pour les tests des fiches 1.1 à
// 1.3, qui n'appellent jamais un point /two-factor/* : chaque appel lève, ce
// qui fait échouer le test qui en atteindrait une par erreur. Ne s'importe
// que depuis un fichier de test. Fiche :
// docs/features/double-authentification.md, « Tests à écrire ».
export function dependancesDoubleAuthInertes(): DependancesDoubleAuth {
  const inattendue = () => {
    throw new Error("dépendance de double authentification inattendue");
  };
  return {
    lireSession: async () => inattendue(),
    etatLigne: async () => inattendue(),
    utilisateurDuDefi: async () => inattendue(),
    limiterConnexion: async () => inattendue(),
    limiterGestion: async () => inattendue(),
    reserverTranche: async () => inattendue(),
    motDePasseValide: async () => inattendue(),
    aRoleExigeant: async () => inattendue(),
    preparerRemplacement: async () => inattendue(),
    revoquerAutresSessions: async () => inattendue(),
    empreinteCodeSecours: () => inattendue(),
    matriceQr: () => inattendue(),
    notifier: () => inattendue(),
  };
}
