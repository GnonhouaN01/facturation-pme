import "server-only";

import { randomUUID } from "node:crypto";

// Le journal de Better Auth (options.logger.log). Better Auth lui passe le
// niveau, le message et des arguments ; ceux-ci peuvent contenir l'erreur
// complète d'une base en panne, dont la requête SQL et ses paramètres (le
// jeton de session, T-39), ou une adresse email interpolée dans le message.
// Cette fonction n'a qu'un paramètre : le message et les arguments ne sont
// jamais lus, donc jamais transmis. Une ligne fixe garde le signal. Fiche :
// docs/features/inscription.md, section 1.2.

const NIVEAUX_GARDES = new Set(["warn", "error"]);

export function consignerAuth(niveau: string): void {
  if (!NIVEAUX_GARDES.has(niveau)) return;
  try {
    console.error("[auth]", JSON.stringify({ niveau, incident: randomUUID() }));
  } catch {
    // Console défaillante : rien de plus à faire sans risquer de lever.
  }
}
