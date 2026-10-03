import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const compteurDebit = pgTable("compteur_debit", {
  cle: text("cle").primaryKey(),
  compte: integer("compte").notNull().default(0),
  fenetreDebut: timestamp("fenetre_debut", { withTimezone: true }).notNull().defaultNow(),
});
