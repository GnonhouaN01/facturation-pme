import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { colonneOrganisation, regleIsolation } from "./isolation";

export const compteurDebit = pgTable("compteur_debit", {
  cle: text("cle").primaryKey(),
  compte: integer("compte").notNull().default(0),
  fenetreDebut: timestamp("fenetre_debut", { withTimezone: true }).notNull().defaultNow(),
});

// Table témoin de l'isolation, sans usage métier : elle prouve le modèle de
// schema/isolation.ts de bout en bout et sert de référence au test
// d'inventaire. Vide en production. Fiche : docs/features/acces-donnees.md,
// section 2.3.
export const temoinIsolation = pgTable.withRLS(
  "temoin_isolation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: colonneOrganisation(),
    valeur: text("valeur").notNull(),
  },
  () => [regleIsolation()],
);

// Journal d'audit, en ajout seul : le rôle de l'application n'y a ni UPDATE,
// ni DELETE, ni TRUNCATE (migration retirer-droits-journal-audit). Toute
// écriture passe par journaliser (src/server/journal/audit.ts), qui impose
// l'organisation de la transaction. auteur_id n'a pas de clé étrangère : la
// suppression d'un compte ne bloque ni n'efface ses traces. Fiche :
// docs/features/journal-audit.md, sections 1 et 4.
export const journalAudit = pgTable.withRLS(
  "journal_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: colonneOrganisation(),
    auteurId: uuid("auteur_id").notNull(),
    action: text("action").notNull(),
    typeRessource: text("type_ressource").notNull(),
    ressourceId: uuid("ressource_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    // Heure de début de la transaction : l'action et sa trace portent la même.
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    regleIsolation(),
    index("journal_audit_organisation_cree_le_idx").on(table.organisationId, table.creeLe),
  ],
);
