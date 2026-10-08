import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
