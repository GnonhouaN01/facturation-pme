import "server-only";

import { z } from "zod";

// Liste fermée des actions journalisables, avec leur type de ressource et le
// schéma de leurs détails. Une fonctionnalité qui ajoute une action l'ajoute
// ici, avec ses tests ; une action n'est jamais retirée, pour que les
// anciennes entrées restent lisibles. Fiche : docs/features/journal-audit.md,
// section 6.

// Les quatre briques des détails : identifiant, valeur énumérée, nombre
// entier, booléen. Aucun texte libre, donc aucune donnée personnelle (S-54).
// Tout schéma de détails est un z.strictObject de ces briques : le test de
// actions.test.ts le vérifie pour chaque action.
export const briques = {
  identifiant: () => z.uuid(),
  enumeration: <const T extends readonly [string, ...string[]]>(valeurs: T) => z.enum(valeurs),
  // Entier, comme tout montant en francs CFA (CLAUDE.md, règle 8).
  nombre: () => z.int(),
  booleen: () => z.boolean(),
};

const SANS_DETAILS = z.strictObject({});

export type TypeRessource = "organisation" | "invitation" | "membre";

export type DefinitionAction = {
  ressource: TypeRessource;
  details: z.ZodType<Record<string, unknown>>;
};

const DEFINITIONS = {
  "organisation.parametres_modifies": { ressource: "organisation", details: SANS_DETAILS },
  "organisation.instructions_paiement_modifiees": {
    ressource: "organisation",
    details: SANS_DETAILS,
  },
  "organisation.visibilite_modifiee": { ressource: "organisation", details: SANS_DETAILS },
  "organisation.suppression_demandee": { ressource: "organisation", details: SANS_DETAILS },
  "organisation.suppression_annulee": { ressource: "organisation", details: SANS_DETAILS },
  "invitation.creee": { ressource: "invitation", details: SANS_DETAILS },
  "invitation.revoquee": { ressource: "invitation", details: SANS_DETAILS },
  // ressource_id : la ligne d'adhésion (table member de Better Auth).
  "membre.ajoute": { ressource: "membre", details: SANS_DETAILS },
  "membre.role_modifie": { ressource: "membre", details: SANS_DETAILS },
  "membre.retire": { ressource: "membre", details: SANS_DETAILS },
  "membre.parti": { ressource: "membre", details: SANS_DETAILS },
} as const satisfies Record<string, DefinitionAction>;

export type ActionJournal = keyof typeof DEFINITIONS;

// Indexable par toute chaîne : une action reçue de l'extérieur se cherche ici
// avant d'être validée.
export const ACTIONS_JOURNAL: Readonly<Record<string, DefinitionAction>> = DEFINITIONS;

export const NOMS_ACTIONS = Object.keys(DEFINITIONS) as [ActionJournal, ...ActionJournal[]];
