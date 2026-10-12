import "server-only";

import type { MessageEmail, Transport } from "./transport";

// Transport des tests : garde une copie de chaque message, n'ouvre aucune
// connexion. Fiche : docs/features/envoi-emails.md, section 2.

export type TransportMemoire = Transport & {
  readonly messages: readonly MessageEmail[];
  vider: () => void;
};

export function creerTransportMemoire(): TransportMemoire {
  const messages: MessageEmail[] = [];
  return {
    remettre: async (message) => {
      messages.push({ ...message });
    },
    get messages() {
      return messages;
    },
    vider: () => {
      messages.length = 0;
    },
  };
}
