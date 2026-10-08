import "server-only";

import { z } from "zod";

import type { TransactionOrganisation } from "../db/client";
import { insererEntreeJournal } from "../db/requetes/journal";

import { ACTIONS_JOURNAL, NOMS_ACTIONS, type ActionJournal } from "./actions";

// Écriture au journal d'audit, dans la transaction de l'action qu'elle
// décrit : l'action et sa trace sont validées ou annulées ensemble (S-70).
// Toute écriture au journal passe par cette fonction. Fiche :
// docs/features/journal-audit.md, section 7.

export type EntreeJournal = {
  action: ActionJournal;
  auteurId: string;
  ressourceId: string;
  details?: Record<string, unknown>;
};

// Message fixe : ni la valeur reçue, ni cause (S-54).
const MESSAGE_INVALIDE = "Entrée du journal d'audit invalide.";

export class EntreeJournalInvalide extends Error {
  constructor() {
    super(MESSAGE_INVALIDE);
    this.name = "EntreeJournalInvalide";
  }
}

// Strict : toute clé de plus, dont une organisation ou un horodatage, est
// refusée. Les détails sont validés ensuite par le schéma de leur action.
const schemaEntree = z.strictObject({
  action: z.enum(NOMS_ACTIONS),
  auteurId: z.uuid(),
  ressourceId: z.uuid(),
  details: z.unknown().optional(),
});

// Valide l'entrée, puis l'insère dans la transaction reçue. Une entrée
// invalide lève EntreeJournalInvalide sans envoyer de requête : levée dans la
// transaction de l'action, elle l'annule. L'organisation de l'entrée est
// celle de la transaction, jamais un paramètre.
export async function journaliser(
  tx: TransactionOrganisation,
  entree: EntreeJournal,
): Promise<void> {
  const lue = schemaEntree.safeParse(entree);
  if (!lue.success) throw new EntreeJournalInvalide();

  const definition = ACTIONS_JOURNAL[lue.data.action];
  if (!definition) throw new EntreeJournalInvalide();

  // Seule l'absence de détails vaut {} ; null est refusé comme toute valeur
  // qui n'est pas un objet.
  const brut = lue.data.details === undefined ? {} : lue.data.details;
  const details = definition.details.safeParse(brut);
  if (!details.success) throw new EntreeJournalInvalide();

  await insererEntreeJournal(tx, {
    action: lue.data.action,
    typeRessource: definition.ressource,
    auteurId: lue.data.auteurId,
    ressourceId: lue.data.ressourceId,
    details: details.data,
  });
}
