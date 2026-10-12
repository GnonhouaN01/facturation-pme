import "server-only";

import type { MessageEmail, Transport } from "./transport";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

export function creerTransportFichier(dossier: string): Transport {
  void dossier;
  throw new Error("non implémenté");
}

export async function lireMessages(dossier: string): Promise<MessageEmail[]> {
  void dossier;
  throw new Error("non implémenté");
}
