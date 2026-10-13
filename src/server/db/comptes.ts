import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { user } from "./schema/auth";

// Purge des comptes non vérifiés de plus de 7 jours (THREATS.md 7.2) : leurs
// comptes et sessions suivent par ON DELETE CASCADE. Table de Better Auth,
// sans organisation_id : requête par db, sans organisation active. Appelée
// par la tâche quotidienne. Fiche : docs/features/inscription.md,
// section 4.6.

const DUREE_JOURS = 7;

export function creerPurgeComptes(base: BaseDeDonnees): () => Promise<number> {
  return async () => {
    const resultat = await base
      .delete(user)
      .where(
        and(
          eq(user.emailVerified, false),
          lt(user.createdAt, sql`now() - make_interval(days => ${DUREE_JOURS})`),
        ),
      );
    return resultat.rowCount ?? 0;
  };
}

export const purgerComptesNonVerifies = creerPurgeComptes(db);
