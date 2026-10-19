import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { session } from "./schema/auth";

// Fermeture des autres sessions d'un utilisateur après un changement de son
// second facteur (activation, remplacement, désactivation), en gardant la
// session donnée. Table de Better Auth sans organisation_id : par db, filtrée
// sur l'utilisateur (RR-8). Fiche : docs/features/double-authentification.md,
// section 8.2.
export function creerRevocationAutresSessions(
  base: BaseDeDonnees,
): (utilisateurId: string, jetonGarde: string) => Promise<number> {
  return async (utilisateurId, jetonGarde) => {
    const resultat = await base
      .delete(session)
      .where(and(eq(session.userId, utilisateurId), ne(session.token, jetonGarde)));
    return resultat.rowCount ?? 0;
  };
}

export const revoquerAutresSessions = creerRevocationAutresSessions(db);
