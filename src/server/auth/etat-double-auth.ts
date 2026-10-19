import "server-only";

import { ROLES_DOUBLE_AUTH } from "../autorisation/matrice";
import { aRoleExigeant, etatDoubleAuth, secondFacteurActif } from "../db/double-authentification";

// Ce que la page de la double authentification affiche (1.4) : l'état du
// second facteur, le nombre de codes de secours restants (jamais les codes),
// et si un rôle impose le second facteur. Pour l'utilisateur de la session
// seulement, que lireComptePourPage fournit. Fiche :
// docs/features/double-authentification.md, sections 5.2 et 11.

export type EtatDoubleAuthCompte = {
  actif: boolean;
  ligne: "aucune" | "a_confirmer" | "active";
  codesRestants: number;
  roleExigeant: boolean;
};

export async function lireEtatDoubleAuth(utilisateurId: string): Promise<EtatDoubleAuthCompte> {
  const [actif, etat, roleExigeant] = await Promise.all([
    secondFacteurActif(utilisateurId),
    etatDoubleAuth(utilisateurId),
    aRoleExigeant(utilisateurId, ROLES_DOUBLE_AUTH),
  ]);
  return { actif, ligne: etat.ligne, codesRestants: etat.codesRestants, roleExigeant };
}
