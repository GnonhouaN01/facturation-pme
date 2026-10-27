import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { TransactionOrganisation } from "../client";
import { member, organization, session } from "../schema/auth";
import { ORGANISATION_ACTIVE } from "../schema/isolation";

// Requêtes de la 2.1 sur les tables de Better Auth, dans la transaction
// ouverte par la chaîne pour une organisation. Aucune de ces tables n'a de
// règle d'isolation (RR-8) : chaque requête filtre elle-même, sur
// l'organisation de la transaction (ORGANISATION_ACTIVE, sans second
// paramètre qui pourrait diverger) et sur l'utilisateur ou la session de la
// requête. Fiche : docs/features/organisations.md, sections 4 à 6.

// L'organisation de la transaction : identifiant imposé par la base (celui
// de la transaction, tiré par la chaîne), slug égal à l'identifiant.
export async function insererOrganisation(
  tx: TransactionOrganisation,
  nom: string,
): Promise<string> {
  const [ligne] = await tx
    .insert(organization)
    .values({
      id: ORGANISATION_ACTIVE,
      name: nom,
      slug: sql`(${ORGANISATION_ACTIVE})::text`,
      createdAt: new Date(),
    })
    .returning({ id: organization.id });
  if (!ligne) throw new Error("Organisation non créée.");
  return ligne.id;
}

// L'adhésion de l'utilisateur à l'organisation de la transaction.
export async function insererAdhesion(
  tx: TransactionOrganisation,
  utilisateurId: string,
  role: string,
): Promise<void> {
  await tx.insert(member).values({
    organizationId: ORGANISATION_ACTIVE,
    userId: utilisateurId,
    role,
    createdAt: new Date(),
  });
}

// L'organisation de la transaction devient l'organisation active de la
// session donnée, si elle est à l'utilisateur.
export async function activerOrganisation(
  tx: TransactionOrganisation,
  sessionId: string,
  utilisateurId: string,
): Promise<void> {
  await tx
    .update(session)
    .set({ activeOrganizationId: sql`(${ORGANISATION_ACTIVE})::text` })
    .where(and(eq(session.id, sessionId), eq(session.userId, utilisateurId)));
}

// Le nom de l'organisation de la transaction ; null si elle n'existe pas.
export async function nomOrganisationActive(tx: TransactionOrganisation): Promise<string | null> {
  const [ligne] = await tx
    .select({ nom: organization.name })
    .from(organization)
    .where(eq(organization.id, ORGANISATION_ACTIVE))
    .limit(1);
  return ligne?.nom ?? null;
}
