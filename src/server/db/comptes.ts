import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { db, type BaseDeDonnees, type TransactionOrganisation } from "./client";
import { session, user, verification } from "./schema/auth";

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

// Purge des jetons expirés (S-63, 1.3) : Better Auth ne supprime les lignes
// expirées de verification qu'à l'occasion d'une recherche. Même table hors
// organisation, par db. Une transaction est admise pour le test : ses lignes
// restent invisibles des recherches de Better Auth lancées en parallèle, qui
// suppriment elles aussi les lignes expirées. Fiche :
// docs/features/mot-de-passe.md, section 9.
export function creerPurgeJetons(
  base: BaseDeDonnees | TransactionOrganisation,
): () => Promise<number> {
  return async () => {
    const resultat = await base.delete(verification).where(lt(verification.expiresAt, sql`now()`));
    return resultat.rowCount ?? 0;
  };
}

export const purgerJetonsExpires = creerPurgeJetons(db);
