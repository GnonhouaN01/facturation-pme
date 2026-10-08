import { sql } from "drizzle-orm";
import { pgPolicy, uuid } from "drizzle-orm/pg-core";

import { organization } from "./auth";

// Modèle unique de l'isolation entre organisations (CLAUDE.md, règle 3).
// Toute table métier se déclare avec pgTable.withRLS(...), colonneOrganisation()
// et regleIsolation(). Le forçage (FORCE ROW LEVEL SECURITY) n'est pas produit
// par drizzle-kit : il s'ajoute par une migration --custom.
// Toute table métier porte aussi un index dont organisation_id est la première
// colonne : chaque requête filtre sur elle (la règle comme le code). La table
// témoin, sans usage métier, n'en a pas.
// Fiche : docs/features/acces-donnees.md, section 2.
// Pas de server-only ici : drizzle-kit charge ce fichier hors de Next.js.

// ON DELETE RESTRICT : une organisation qui a des lignes ne se supprime pas
// directement.
export function colonneOrganisation() {
  return uuid("organisation_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
}

// L'organisation active de la transaction. NULLIF ramène à NULL le réglage
// absent (NULL) ou rétabli après une transaction (''). Sans organisation
// active, aucune ligne n'est visible et toute écriture est refusée, sans
// erreur de conversion. Exporté pour la fonction d'écriture du journal, qui
// impose cette organisation à la ligne (docs/features/journal-audit.md,
// section 5).
export const ORGANISATION_ACTIVE = sql`NULLIF(current_setting('app.organisation_id', true), '')::uuid`;

const CONDITION = sql`organisation_id = ${ORGANISATION_ACTIVE}`;

// Toutes les commandes, tous les rôles (pas de clause to).
export function regleIsolation() {
  return pgPolicy("isolation_organisation", {
    as: "permissive",
    for: "all",
    using: CONDITION,
    withCheck: CONDITION,
  });
}
