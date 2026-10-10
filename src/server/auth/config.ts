import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";

import { db } from "../db/client";
import * as schema from "../db/schema/auth";
import { env } from "../env";

// Options partagées avec l'instance de test (src/server/db/outils-test/),
// qui y ajoute le module de test de Better Auth. Ce module n'est jamais
// ajouté ici, même sous condition : il crée des sessions sans mot de passe
// (vérifié par config.test.ts). Fiche : docs/features/chaine-controles.md,
// section 10.
export const optionsAuth = {
  appName: "Facturation PME",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true },
  plugins: [twoFactor(), organization(), nextCookies()],
} satisfies BetterAuthOptions;

export const auth = betterAuth(optionsAuth);
