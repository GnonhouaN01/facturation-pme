import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, type BaseDeDonnees, type TransactionOrganisation } from "./client";
import { verification } from "./schema/auth";

// La preuve de nouvelle authentification (1.6) : une ligne de verification
// (table de Better Auth, sans organisation_id), liée à une session par son
// identifiant et à son utilisateur, valable 5 minutes à l'horloge de la base,
// d'usage unique. Posée par le point /api/auth/verify-password, consommée
// par l'étape 8 de la chaîne dans la transaction de l'action : rendue si
// l'action est annulée. Fiche : docs/features/nouvelle-authentification.md,
// sections 3 et 4.

export const DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES = 5 * 60;
const PREFIXE_PREUVE = "nouvelle-authentification:";

export function identifiantPreuve(sessionId: string): string {
  return `${PREFIXE_PREUVE}${sessionId}`;
}

// Remplace la preuve de la session : une seule ligne par session.
export function creerPosePreuve(
  base: BaseDeDonnees,
): (utilisateurId: string, sessionId: string) => Promise<void> {
  return async (utilisateurId, sessionId) => {
    const identifiant = identifiantPreuve(sessionId);
    await base.transaction(async (tx) => {
      await tx.delete(verification).where(eq(verification.identifier, identifiant));
      await tx.insert(verification).values({
        identifier: identifiant,
        value: utilisateurId,
        expiresAt: sql`now() + make_interval(secs => ${DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES})`,
      });
    });
  };
}

// Supprime la preuve valable de la session pour cet utilisateur, dans la
// transaction de l'action ; vrai si une ligne l'a été. Deux transactions
// simultanées : la seconde attend le verrou de la ligne, puis ne la trouve
// plus.
export async function consommerPreuve(
  tx: TransactionOrganisation,
  utilisateurId: string,
  sessionId: string,
): Promise<boolean> {
  const supprimees = await tx
    .delete(verification)
    .where(
      and(
        eq(verification.identifier, identifiantPreuve(sessionId)),
        eq(verification.value, utilisateurId),
        gt(verification.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: verification.id });
  return supprimees.length > 0;
}

export const enregistrerPreuve = creerPosePreuve(db);
