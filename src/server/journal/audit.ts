import "server-only";

import type { TransactionOrganisation } from "../db/client";

import type { ActionJournal } from "./actions";

// Écriture au journal d'audit, dans la transaction de l'action qu'elle
// décrit. Fiche : docs/features/journal-audit.md, section 7.

export type EntreeJournal = {
  action: ActionJournal;
  auteurId: string;
  ressourceId: string;
  details?: Record<string, unknown>;
};

export class EntreeJournalInvalide extends Error {}

export async function journaliser(
  _tx: TransactionOrganisation,
  _entree: EntreeJournal,
): Promise<void> {
  throw new Error("non implémenté");
}
