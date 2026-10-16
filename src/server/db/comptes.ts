import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { session, user } from "./schema/auth";

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

// Purge des sessions expirées (S-63, 1.2) : une session expirée ne sert plus,
// et garde une adresse IP et un navigateur. Même table hors organisation, par
// db. Fiche : docs/features/connexion.md, section 4.4.
export function creerPurgeSessions(base: BaseDeDonnees): () => Promise<number> {
  return async () => {
    const resultat = await base.delete(session).where(lt(session.expiresAt, sql`now()`));
    return resultat.rowCount ?? 0;
  };
}

export const purgerSessionsExpirees = creerPurgeSessions(db);
