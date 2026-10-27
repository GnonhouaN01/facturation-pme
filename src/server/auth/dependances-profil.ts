import "server-only";

import type { NomLimite } from "../debit/limites";

import type { DependancesDoubleAuth } from "./double-authentification";
import type { DependancesProfil, ModeleProfil } from "./profil";

// Les dépendances du profil et des sessions liées à une instance de Better
// Auth, à un compteur et aux requêtes de db/ : une seule fabrique pour
// gestionnaire.ts et pour le banc des tests d'intégration. La session et le
// mot de passe actuel sont lus comme par la gestion de la double
// authentification (mêmes fonctions, adaptateur interne) ; le nom s'écrit par
// l'adaptateur interne (updateUser, champ name seul), jamais par auth.api,
// dont l'extension nextCookies écrirait des cookies dans notre réponse.
// Fiche : docs/features/profil-sessions.md, sections 2 à 6.

type Contexte = {
  internalAdapter: {
    updateUser: (utilisateurId: string, donnees: { name: string }) => Promise<unknown>;
  };
};

export type OptionsDependancesProfil = {
  contexte: () => Promise<unknown>;
  // lireSession et motDePasseValide de la double authentification.
  doubleAuth: Pick<DependancesDoubleAuth, "lireSession" | "motDePasseValide">;
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  motDePasseCompromis: (motDePasse: string) => Promise<boolean>;
  requetes: {
    revoquerSessionDe: (
      utilisateurId: string,
      sessionId: string,
      jetonGarde: string,
    ) => Promise<void>;
    revoquerAutresSessions: (utilisateurId: string, jetonGarde: string) => Promise<unknown>;
    supprimerJetonsReinitialisation: (utilisateurId: string) => Promise<unknown>;
    adresseUtilisateur: (utilisateurId: string) => Promise<string | null>;
    // 2.1 (db/sessions.ts).
    organisationActiveDe: (jeton: string) => Promise<string | null>;
    reprendreOrganisationActive: (
      utilisateurId: string,
      jeton: string,
      organisationId: string,
    ) => Promise<void>;
  };
  emailProfil: (modele: ModeleProfil, lireAdresse: () => Promise<string | null>) => void;
};

export function creerDependancesProfil(options: OptionsDependancesProfil): DependancesProfil {
  const { doubleAuth, requetes } = options;
  return {
    lireSession: async (entetes) => {
      const lue = await doubleAuth.lireSession(entetes);
      return lue === null ? null : { utilisateurId: lue.utilisateurId, jeton: lue.jeton };
    },
    limiterProfil: (utilisateurId) => options.verifierDebit("auth.profil_compte", utilisateurId),
    limiterMotDePasse: (utilisateurId) =>
      options.verifierDebit("auth.mot_de_passe_compte", utilisateurId),
    motDePasseValide: doubleAuth.motDePasseValide,
    motDePasseCompromis: options.motDePasseCompromis,
    revoquerSessionDe: requetes.revoquerSessionDe,
    revoquerAutresSessions: async (utilisateurId, jetonGarde) => {
      await requetes.revoquerAutresSessions(utilisateurId, jetonGarde);
    },
    supprimerJetonsReinitialisation: async (utilisateurId) => {
      await requetes.supprimerJetonsReinitialisation(utilisateurId);
    },
    modifierNom: async (utilisateurId, nom) => {
      const contexte = (await options.contexte()) as Contexte;
      await contexte.internalAdapter.updateUser(utilisateurId, { name: nom });
    },
    notifier: (modele, utilisateurId) => {
      options.emailProfil(modele, () => requetes.adresseUtilisateur(utilisateurId));
    },
    organisationActive: requetes.organisationActiveDe,
    reprendreOrganisationActive: requetes.reprendreOrganisationActive,
  };
}
