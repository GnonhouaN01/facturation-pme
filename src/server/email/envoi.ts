import "server-only";

import type { Transport } from "../modules/email/transport";

import type { ModeleEmail } from "./modeles";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

export type DemandeEmail = {
  modele: ModeleEmail;
  destinataire: string;
  parametres: Record<string, unknown>;
};

export type ResultatEnvoi =
  | { envoye: true }
  | { envoye: false; raison: "limite" | "indisponible" | "refuse_par_serveur" | "non_autorise" };

export class DemandeEmailInvalide extends Error {
  constructor() {
    super("non implémenté");
    throw new Error("non implémenté");
  }
}

export function validerDemande(demande: unknown): DemandeEmail {
  void demande;
  throw new Error("non implémenté");
}

export function creerPorteEmail(configuration: {
  transport: Transport;
  expediteur: string;
  estProduction: boolean;
  destinatairesAutorises: readonly string[];
  origine: string;
}): { envoyerEmail: (demande: DemandeEmail) => Promise<ResultatEnvoi> } {
  void configuration;
  throw new Error("non implémenté");
}

export async function envoyerEmail(demande: DemandeEmail): Promise<ResultatEnvoi> {
  void demande;
  throw new Error("non implémenté");
}
