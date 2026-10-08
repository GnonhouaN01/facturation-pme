import "server-only";

import type { InferInsertModel } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

// Outillage des tests avec base. Ne s'importe que depuis un fichier de test.
// Fiche : docs/features/acces-donnees.md, section 4.3. Non implémenté.

export type TableOrganisation = PgTable & { organisationId: AnyPgColumn };

// Passe les huit contrôles d'isolation sur la table. Lève une erreur qui
// nomme le contrôle en échec.
export async function verifierIsolation<T extends TableOrganisation>(
  table: T,
  fabriquer: (organisationId: string) => InferInsertModel<T>,
): Promise<void> {
  void table;
  void fabriquer;
  throw new Error("non implémenté : verifierIsolation");
}

// Code PostgreSQL du refus de la promesse, en parcourant la chaîne des cause.
// « aucun refus » si la promesse réussit, « aucun code » si l'erreur n'en a pas.
export async function codeDuRefus(promesse: Promise<unknown>): Promise<string> {
  void promesse;
  throw new Error("non implémenté : codeDuRefus");
}
