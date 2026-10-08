import "server-only";

import type { z } from "zod";

// Liste fermée des actions journalisables, avec leur type de ressource et le
// schéma de leurs détails. Fiche : docs/features/journal-audit.md, section 6.

export type DefinitionAction = {
  ressource: string;
  details: z.ZodType;
};

export const ACTIONS_JOURNAL: Record<string, DefinitionAction> = {};

export type ActionJournal = keyof typeof ACTIONS_JOURNAL;

// Les quatre briques des détails : identifiant, valeur énumérée, nombre
// entier, booléen.
export const briques = {
  identifiant(): z.ZodType {
    throw new Error("non implémenté");
  },
  enumeration(_valeurs: readonly [string, ...string[]]): z.ZodType {
    throw new Error("non implémenté");
  },
  nombre(): z.ZodType {
    throw new Error("non implémenté");
  },
  booleen(): z.ZodType {
    throw new Error("non implémenté");
  },
};
