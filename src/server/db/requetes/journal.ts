import "server-only";

import type { TransactionOrganisation } from "../client";
import { ORGANISATION_ACTIVE } from "../schema/isolation";
import { journalAudit } from "../schema/technique";

// Insertion d'une entrée au journal d'audit, déjà validée par
// src/server/journal/audit.ts, seul fichier autorisé à l'importer (règle
// ESLint). Fiche : docs/features/journal-audit.md, sections 5 et 7.

export type EntreeJournalValidee = {
  action: string;
  typeRessource: string;
  auteurId: string;
  ressourceId: string;
  details: Record<string, unknown>;
};

// organisation_id n'est jamais fourni par l'appelant : c'est l'organisation
// active de la transaction, par l'expression même de la règle. Sans
// organisation active, l'insertion est refusée par la base. cree_le est
// laissé à la base (now(), heure de début de la transaction).
export async function insererEntreeJournal(
  tx: TransactionOrganisation,
  entree: EntreeJournalValidee,
): Promise<void> {
  await tx.insert(journalAudit).values({
    organisationId: ORGANISATION_ACTIVE,
    auteurId: entree.auteurId,
    action: entree.action,
    typeRessource: entree.typeRessource,
    ressourceId: entree.ressourceId,
    details: entree.details,
  });
}
