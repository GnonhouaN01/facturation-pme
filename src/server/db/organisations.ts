import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "./client";
import { member, organization } from "./schema/auth";

// Les organisations d'un utilisateur, pour la page /compte (2.1), hors de
// toute organisation active : par db, filtrée sur l'utilisateur de la
// session (RR-8). Aucune autre adhésion, aucun autre membre n'est lu. Fiche :
// docs/features/organisations.md, section 6.

export type OrganisationDuCompte = { id: string; nom: string; role: string };

// Plafond de lecture (T-42) : bien au-delà de l'usage d'une PME.
export const ORGANISATIONS_MAX = 100;

export async function organisationsDuCompte(
  utilisateurId: string,
): Promise<OrganisationDuCompte[]> {
  return db
    .select({ id: organization.id, nom: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, utilisateurId))
    .orderBy(asc(organization.name), asc(organization.id))
    .limit(ORGANISATIONS_MAX);
}
