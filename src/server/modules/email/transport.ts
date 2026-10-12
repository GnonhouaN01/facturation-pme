import "server-only";

// Interface commune des transports d'email (DESIGN.md, section 4.3, règle 5) :
// en mémoire pour les tests, en fichiers en local et pour les tests de bout
// en bout, SMTP vers Gmail en production (PR 2). Seule la porte d'envoi
// (src/server/email/envoi.ts) les utilise (règle ESLint T). Fiche :
// docs/features/envoi-emails.md, sections 1 et 2.

// Le message, déjà construit et validé par la porte : un seul destinataire,
// aucun en-tête libre, texte brut.
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

// Échec d'un transport, traduit en une raison fermée. code et responseCode
// sont ceux du client SMTP (PR 2) ; ni message, ni réponse du serveur, qui
// peuvent citer l'adresse du destinataire (section 6.3). Message fixe.
export class EchecTransport extends Error {
  readonly raison: RaisonEchecTransport;
  readonly code: string | undefined;
  readonly responseCode: number | undefined;

  constructor(options: { raison: RaisonEchecTransport; code?: string; responseCode?: number }) {
    super("Échec du transport d'email.");
    this.name = "EchecTransport";
    this.raison = options.raison;
    this.code = options.code;
    this.responseCode = options.responseCode;
  }
}
