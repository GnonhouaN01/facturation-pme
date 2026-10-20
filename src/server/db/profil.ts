import "server-only";

import { eq } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { user } from "./schema/auth";

// Le profil de l'utilisateur de la session, pour la page /compte/profil
// (1.5) : son nom et son adresse, rien d'autre. Table de Better Auth : par
// db, filtrée sur l'utilisateur (RR-8). Le nom s'écrit par l'adaptateur
// interne de Better Auth (dependances-profil.ts). Fiche :
// docs/features/profil-sessions.md, sections 5 et 9.
export type Profil = { nom: string; email: string };

export function creerLectureProfil(
  base: BaseDeDonnees,
): (utilisateurId: string) => Promise<Profil | null> {
  return async (utilisateurId) => {
    const [ligne] = await base
      .select({ nom: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, utilisateurId))
      .limit(1);
    return ligne ?? null;
  };
}

export const lireProfil = creerLectureProfil(db);
