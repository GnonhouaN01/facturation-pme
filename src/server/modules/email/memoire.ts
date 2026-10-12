import "server-only";

import type { MessageEmail, Transport } from "./transport";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

export type TransportMemoire = Transport & {
  readonly messages: readonly MessageEmail[];
  vider: () => void;
};

export function creerTransportMemoire(): TransportMemoire {
  throw new Error("non implémenté");
}
