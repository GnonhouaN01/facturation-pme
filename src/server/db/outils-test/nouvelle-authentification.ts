import "server-only";

import type { DependancesNouvelleAuthentification } from "../../auth/nouvelle-authentification";

// Dépendances de la nouvelle authentification pour les tests des fiches 1.1
// à 1.5, qui n'appellent jamais /verify-password : chaque appel lève, ce qui
// fait échouer le test qui en atteindrait une par erreur. Ne s'importe que
// depuis un fichier de test. Fiche :
// docs/features/nouvelle-authentification.md, « Tests à écrire ».
export function dependancesNouvelleAuthentificationInertes(): DependancesNouvelleAuthentification {
  const inattendue = () => {
    throw new Error("dépendance de la nouvelle authentification inattendue");
  };
  return {
    lireSession: async () => inattendue(),
    limiter: async () => inattendue(),
    motDePasseValide: async () => inattendue(),
    enregistrerPreuve: async () => inattendue(),
  };
}
