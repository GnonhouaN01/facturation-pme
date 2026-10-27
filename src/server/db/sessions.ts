import "server-only";

import { and, desc, eq, exists, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type BaseDeDonnees } from "./client";
import { member, session } from "./schema/auth";

// Les sessions d'un utilisateur. Table de Better Auth sans organisation_id :
// par db, chaque requête filtrée sur l'utilisateur (RR-8). Fermeture des
// autres sessions après un changement du second facteur (activation,
// remplacement, désactivation), en gardant la session donnée. Fiche :
// docs/features/double-authentification.md, section 8.2. 1.5 : liste des
// sessions non expirées, sans jeton, et fermeture d'une session par son
// identifiant (docs/features/profil-sessions.md, sections 3.1 et 3.2).
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

// Une session telle que la page des sessions la lit : jamais le jeton.
export type SessionLueEnBase = {
  id: string;
  navigateur: string | null;
  adresseIp: string | null;
  ouverteLe: Date;
  expireLe: Date;
};

export function creerLectureSessions(
  base: BaseDeDonnees,
): (utilisateurId: string) => Promise<SessionLueEnBase[]> {
  return (utilisateurId) =>
    base
      .select({
        id: session.id,
        navigateur: session.userAgent,
        adresseIp: session.ipAddress,
        ouverteLe: session.createdAt,
        expireLe: session.expiresAt,
      })
      .from(session)
      .where(and(eq(session.userId, utilisateurId), gt(session.expiresAt, sql`now()`)))
      .orderBy(desc(session.createdAt));
}

export const sessionsDe = creerLectureSessions(db);

// Supprime la session d'identifiant donné si elle est à l'utilisateur et
// n'est pas celle du jeton gardé (la session courante se ferme par la
// déconnexion). Ne dit pas si une ligne a été supprimée : la réponse du point
// d'entrée ne peut pas en dépendre (S-02).
export function creerRevocationSession(
  base: BaseDeDonnees,
): (utilisateurId: string, sessionId: string, jetonGarde: string) => Promise<void> {
  return async (utilisateurId, sessionId, jetonGarde) => {
    await base
      .delete(session)
      .where(
        and(
          eq(session.id, sessionId),
          eq(session.userId, utilisateurId),
          ne(session.token, jetonGarde),
        ),
      );
  };
}

export const revoquerSessionDe = creerRevocationSession(db);

// 2.1, report de la 1.5 : l'organisation active d'une session, lue par son
// jeton avant le changement du mot de passe ; null si absente. Fiche :
// docs/features/organisations.md, section 5.
export async function organisationActiveDe(jeton: string): Promise<string | null> {
  const [ligne] = await db
    .select({ active: session.activeOrganizationId })
    .from(session)
    .where(eq(session.token, jeton))
    .limit(1);
  return ligne?.active ?? null;
}

const identifiantOrganisation = z.uuid();

// Écrit l'organisation sur la session neuve, par une seule requête : la
// session est celle du jeton et de l'utilisateur, et l'adhésion doit exister
// (une adhésion retirée entre-temps n'est pas reprise). Une valeur qui n'est
// pas un UUID n'envoie aucune requête.
export async function reprendreOrganisationActive(
  utilisateurId: string,
  jeton: string,
  organisationId: string,
): Promise<void> {
  const lue = identifiantOrganisation.safeParse(organisationId);
  if (!lue.success) return;
  await db
    .update(session)
    .set({ activeOrganizationId: lue.data })
    .where(
      and(
        eq(session.token, jeton),
        eq(session.userId, utilisateurId),
        exists(
          db
            .select({ un: sql`1` })
            .from(member)
            .where(and(eq(member.userId, utilisateurId), eq(member.organizationId, lue.data))),
        ),
      ),
    );
}
