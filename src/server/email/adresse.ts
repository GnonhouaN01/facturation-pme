import "server-only";

import { z } from "zod";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. Toute lecture par le schéma lève. Fiche :
// docs/features/envoi-emails.md, « Notes de l'implémentation ».

export const schemaAdresse: z.ZodType<string, unknown> = z.unknown().transform((): string => {
  throw new Error("non implémenté");
});

export function adressePourCompteur(adresse: string): string {
  void adresse;
  throw new Error("non implémenté");
}
