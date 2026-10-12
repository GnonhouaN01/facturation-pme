import "server-only";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

export type MessageEmail = {
  de: string;
  nomExpediteur: string;
  a: string;
  sujet: string;
  corps: string;
};

export type Transport = {
  remettre: (message: MessageEmail) => Promise<void>;
};

export type RaisonEchecTransport = "indisponible" | "refuse_par_serveur";

export class EchecTransport extends Error {
  declare readonly raison: RaisonEchecTransport;
  declare readonly code: string | undefined;
  declare readonly responseCode: number | undefined;

  constructor(options: { raison: RaisonEchecTransport; code?: string; responseCode?: number }) {
    super("non implémenté");
    void options;
    throw new Error("non implémenté");
  }
}
