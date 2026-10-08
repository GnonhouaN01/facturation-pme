import "server-only";

import type { TransactionOrganisation } from "../client";

// Insertion d'une entrée au journal d'audit, déjà validée par
// src/server/journal/audit.ts, seul fichier autorisé à l'importer (règle
// ESLint). Fiche : docs/features/journal-audit.md, section 7.

export type EntreeJournalValidee = {
  action: string;
  typeRessource: string;
  auteurId: string;
  ressourceId: string;
  details: Record<string, unknown>;
};

export async function insererEntreeJournal(
  _tx: TransactionOrganisation,
  _entree: EntreeJournalValidee,
): Promise<void> {
  throw new Error("non implémenté");
}
