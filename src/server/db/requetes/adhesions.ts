import "server-only";

import { and, eq } from "drizzle-orm";

import type { TransactionOrganisation } from "../client";
import { member } from "../schema/auth";
import { ORGANISATION_ACTIVE } from "../schema/isolation";

// Adhésion de l'utilisateur à l'organisation active de la transaction, lue par
// la chaîne de contrôles à chaque requête. Fiche :
// docs/features/chaine-controles.md, section 2.2.

export type Adhesion = { membreId: string; role: string };

// member n'a pas de règle d'isolation (table de Better Auth) : le filtre sur
// l'organisation est celui du code, par l'expression même de la règle, sans
// second paramètre qui pourrait diverger. Sans organisation active, il ne
// trouve rien. FOR SHARE : un retrait ou un changement de rôle attend la fin
// de l'action en cours (S-17, T-52). Plus d'une ligne (que Better Auth ne crée
// pas) vaut « aucune adhésion » : aucun choix arbitraire entre deux rôles.
export async function lireAdhesion(
  tx: TransactionOrganisation,
  utilisateurId: string,
): Promise<Adhesion | null> {
  const lignes = await tx
    .select({ membreId: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, utilisateurId), eq(member.organizationId, ORGANISATION_ACTIVE)))
    .limit(2)
    .for("share");
  return lignes.length === 1 ? (lignes[0] ?? null) : null;
}
