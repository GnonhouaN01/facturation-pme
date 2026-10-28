import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  bytea,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  DELAI_DEFAUT,
  DELAI_MAX,
  DELAI_MIN,
  REGLES_TEXTE,
  TAILLE_MAX_LOGO,
  TAUX_MAX_CENTIEMES,
  type ChampTexte,
} from "../../../schemas/regles-parametres";

import { colonneOrganisation, reglesSansSuppression } from "./isolation";

// Paramètres de l'organisation et taux de TVA (2.2). Tables sans suppression :
// règles de lecture, d'insertion et de modification seulement, et aucun
// droit DELETE pour le rôle de l'application (migration
// forcer-isolation-parametres). Chaque texte est borné en base comme dans
// l'application (char_length compte les points de code, comme
// regles-parametres.ts). Fiche : docs/features/parametres-organisation.md,
// section 1.
// Pas de server-only ici : drizzle-kit charge ce fichier hors de Next.js.

// Texte non renseigné (NULL) ou de 1 à max points de code. La borne est
// écrite en littéral : une contrainte n'a pas de paramètre.
function borne(nom: string, colonne: AnyPgColumn, champ: ChampTexte) {
  const max = REGLES_TEXTE[champ].max;
  return check(nom, sql`char_length(${colonne}) BETWEEN 1 AND ${sql.raw(String(max))}`);
}

function entre(colonne: AnyPgColumn, min: number, max: number): SQL {
  return sql`${colonne} BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`;
}

// Une ligne par organisation. Les colonnes paiement_* ne s'écrivent que par
// ecrireInstructionsPaiement (S-33) ; logo ne se lit que par lireLogo, pour
// la route qui le sert.
export const parametresOrganisation = pgTable.withRLS(
  "parametres_organisation",
  {
    organisationId: colonneOrganisation().primaryKey(),
    adresse: text("adresse"),
    ncc: text("ncc"),
    rccm: text("rccm"),
    regimeImposition: text("regime_imposition"),
    mentionsLegales: text("mentions_legales"),
    validiteDevisJours: integer("validite_devis_jours").notNull().default(DELAI_DEFAUT),
    echeanceFactureJours: integer("echeance_facture_jours").notNull().default(DELAI_DEFAUT),
    paiementMobileMoney: text("paiement_mobile_money"),
    paiementBancaire: text("paiement_bancaire"),
    logo: bytea("logo"),
    logoType: text("logo_type"),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    ...reglesSansSuppression(),
    borne("parametres_adresse_longueur", table.adresse, "adresse"),
    borne("parametres_ncc_longueur", table.ncc, "ncc"),
    borne("parametres_rccm_longueur", table.rccm, "rccm"),
    borne("parametres_regime_longueur", table.regimeImposition, "regimeImposition"),
    borne("parametres_mentions_longueur", table.mentionsLegales, "mentionsLegales"),
    borne("parametres_mobile_money_longueur", table.paiementMobileMoney, "mobileMoney"),
    borne("parametres_bancaire_longueur", table.paiementBancaire, "bancaire"),
    check("parametres_validite_devis", entre(table.validiteDevisJours, DELAI_MIN, DELAI_MAX)),
    check("parametres_echeance_facture", entre(table.echeanceFactureJours, DELAI_MIN, DELAI_MAX)),
    check(
      "parametres_logo_taille",
      sql`octet_length(${table.logo}) BETWEEN 1 AND ${sql.raw(String(TAILLE_MAX_LOGO))}`,
    ),
    check(
      "parametres_logo_type",
      sql`(${table.logo} IS NULL AND ${table.logoType} IS NULL) OR (${table.logo} IS NOT NULL AND ${table.logoType} IN ('image/png', 'image/jpeg'))`,
    ),
  ],
);

// Taux de TVA, en centièmes de pour cent (1800 = 18 %). Jamais supprimés,
// seulement désactivés (UC-07 2a) ; un seul taux par valeur et par
// organisation.
export const tauxTva = pgTable.withRLS(
  "taux_tva",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: colonneOrganisation(),
    libelle: text("libelle").notNull(),
    tauxCentiemes: integer("taux_centiemes").notNull(),
    actif: boolean("actif").notNull().default(true),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    ...reglesSansSuppression(),
    uniqueIndex("taux_tva_organisation_taux_idx").on(table.organisationId, table.tauxCentiemes),
    borne("taux_tva_libelle_longueur", table.libelle, "libelleTaux"),
    check("taux_tva_borne", entre(table.tauxCentiemes, 0, TAUX_MAX_CENTIEMES)),
  ],
);
