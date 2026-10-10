import "server-only";

import type { SessionLue } from "../actions/action";

import { auth } from "./config";

// Lecture de la session par Better Auth, à partir des en-têtes de la requête.
// Le cache de session dans un cookie est désactivé (défaut) : la session est
// relue en base à chaque appel. Cookie absent, falsifié, jeton inconnu ou
// session expirée : null. Fiche : docs/features/chaine-controles.md,
// section 5, étape 2.
export async function lireSession(entetes: Headers): Promise<SessionLue | null> {
  const lue = await auth.api.getSession({ headers: entetes });
  if (!lue) return null;
  return {
    utilisateurId: lue.user.id,
    organisationActiveId: lue.session.activeOrganizationId ?? null,
  };
}
