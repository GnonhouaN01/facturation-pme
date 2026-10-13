import "server-only";

import { configurationEmail, env } from "../env";

import { auth } from "./config";
import { creerTraitementAuth } from "./points-entree";

// Le gestionnaire de /api/auth lié à l'application : Better Auth
// (auth.handler), l'origine de BETTER_AUTH_URL, et la production lue de
// VERCEL_ENV par la configuration validée (env-schema.ts), où l'inscription
// reste fermée jusqu'à la 1.3 (décision 1). Seul import de
// src/app/api/auth/[...all]/route.ts. Fiche : docs/features/inscription.md,
// section 2.
export const traiterRequeteAuth = creerTraitementAuth({
  traiter: (requete) => auth.handler(requete),
  origine: env.BETTER_AUTH_URL,
  estProduction: configurationEmail.estProduction,
});
