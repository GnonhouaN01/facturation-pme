import "server-only";

import { createHash } from "node:crypto";

import { marquerAdresseVerifiee, supprimerJetonsReinitialisation } from "../db/reinitialisation";

import { planifierEmailMotDePasseModifie } from "./emails";
import { consignerIncidentAuth } from "./journal";

// Réinitialisation du mot de passe (1.3). Le jeton est stocké sous son
// empreinte (S-15) ; après un changement de mot de passe, le rappel
// onPasswordReset planifie la notification, supprime les autres jetons du
// compte et marque l'adresse vérifiée. Fiche : docs/features/mot-de-passe.md,
// sections 3.2 et 4.2.

// Préfixe distinct de reset-password: : Better Auth essaie aussi la forme en
// clair d'un identifiant (reset-password:<x>), qui ne peut donc jamais
// désigner une ligne stockée, même si l'on présente une empreinte lue en base
// comme jeton. Le préfixe permet aussi de supprimer les jetons d'un compte.
export const PREFIXE_EMPREINTE = "reinitialisation:";

// verification.storeIdentifier de Better Auth, pour les identifiants
// reset-password:<jeton>. Le jeton a 143 bits d'entropie : une empreinte
// rapide, sans sel, suffit.
export async function empreinteJetonReinitialisation(identifiant: string): Promise<string> {
  return `${PREFIXE_EMPREINTE}${createHash("sha256").update(identifiant).digest("base64url")}`;
}

export type DependancesApresReinitialisation = {
  planifierNotification: (donnees: { user: { email: string } }) => Promise<void> | void;
  supprimerJetons: (utilisateurId: string) => Promise<number>;
  marquerVerifiee: (utilisateurId: string) => Promise<void>;
};

type DonneesReinitialisation = {
  user: { id: string; email: string; emailVerified: boolean };
};

// Ne lève jamais : Better Auth appelle ce rappel avant de révoquer les
// sessions, et une exception l'en empêcherait. Chaque étape est tentée ; un
// échec écrit une ligne [auth] fixe, sans identifiant ni adresse.
export function creerApresReinitialisation(
  dependances: DependancesApresReinitialisation,
): (donnees: DonneesReinitialisation, requete?: unknown) => Promise<void> {
  async function tenter(etape: () => Promise<unknown> | unknown): Promise<void> {
    try {
      await etape();
    } catch {
      consignerIncidentAuth();
    }
  }

  return async ({ user }) => {
    await tenter(() => dependances.planifierNotification({ user: { email: user.email } }));
    await tenter(() => dependances.supprimerJetons(user.id));
    if (!user.emailVerified) await tenter(() => dependances.marquerVerifiee(user.id));
  };
}

export const apresReinitialisation = creerApresReinitialisation({
  planifierNotification: planifierEmailMotDePasseModifie,
  supprimerJetons: supprimerJetonsReinitialisation,
  marquerVerifiee: marquerAdresseVerifiee,
});
