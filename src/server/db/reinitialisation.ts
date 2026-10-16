import "server-only";

import { and, eq, like } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { user, verification } from "./schema/auth";

// Requêtes du rappel d'après réinitialisation (1.3), sur des tables de
// Better Auth sans organisation_id : par db, sans organisation active, comme
// les purges de comptes.ts. Importées par src/server/auth/reinitialisation.ts
// seulement. Fiche : docs/features/mot-de-passe.md, section 4.2.

// Préfixe des empreintes de jetons de réinitialisation (section 3.2). Motif
// constant : aucune valeur reçue n'entre dans le LIKE.
const MOTIF_EMPREINTES = "reinitialisation:%";

// Supprime tous les jetons de réinitialisation encore en base pour un compte :
// après un changement de mot de passe, une demande antérieure ne sert plus.
export function creerSuppressionJetons(
  base: BaseDeDonnees,
): (utilisateurId: string) => Promise<number> {
  return async (utilisateurId) => {
    const resultat = await base
      .delete(verification)
      .where(
        and(eq(verification.value, utilisateurId), like(verification.identifier, MOTIF_EMPREINTES)),
      );
    return resultat.rowCount ?? 0;
  };
}

// Marque vérifiée l'adresse d'un compte : la réinitialisation prouve la
// possession de la boîte (décision B, pré-appropriation d'adresse).
export function creerMarquageAdresse(
  base: BaseDeDonnees,
): (utilisateurId: string) => Promise<void> {
  return async (utilisateurId) => {
    await base
      .update(user)
      .set({ emailVerified: true })
      .where(and(eq(user.id, utilisateurId), eq(user.emailVerified, false)));
  };
}

export const supprimerJetonsReinitialisation = creerSuppressionJetons(db);
export const marquerAdresseVerifiee = creerMarquageAdresse(db);
