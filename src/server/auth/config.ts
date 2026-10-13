import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";

import { db } from "../db/client";
import * as schema from "../db/schema/auth";
import { reglesBetterAuth, stockageBetterAuth } from "../debit/better-auth";
import { LIMITES } from "../debit/limites";
import { env } from "../env";

import { planifierEmailCompteExistant, planifierEmailVerification } from "./emails";
import { consignerAuth } from "./journal";

// Options partagées avec l'instance de test (src/server/db/outils-test/),
// qui y ajoute le module de test de Better Auth. Ce module n'est jamais
// ajouté ici, même sous condition : il crée des sessions sans mot de passe
// (vérifié par config.test.ts). Fiche : docs/features/chaine-controles.md,
// section 10. Réglages de l'inscription (1.1) : docs/features/inscription.md.
export const optionsAuth = {
  appName: "Facturation PME",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Sans transaction (défaut de l'adaptateur, figé par config.test.ts) : les
  // rappels d'envoi ne tournent jamais dans une transaction (règle 15).
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Journal réduit à une ligne fixe : le message et ses arguments, qui
  // peuvent porter un jeton de session ou une adresse, ne sont jamais lus
  // (T-39, section 1).
  logger: { level: "warn", log: consignerAuth },
  // Toute erreur qui n'est pas une réponse de Better Auth est relancée vers
  // notre gestionnaire, au lieu d'être écrite en entier par better-call
  // (section 1.2).
  onAPIError: { throw: true },
  // Limitation activée explicitement, sur notre compteur, règles tirées de
  // LIMITES (section 3).
  rateLimit: {
    enabled: true,
    window: LIMITES["auth.defaut"].fenetreSecondes,
    max: LIMITES["auth.defaut"].maximum,
    customRules: reglesBetterAuth(),
    customStorage: stockageBetterAuth,
  },
  advanced: {
    database: { generateId: "uuid" },
    // Un seul en-tête, fixé ici, valeur unique et valide (section 3.4).
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  emailAndPassword: {
    enabled: true,
    // Réponse identique pour une adresse déjà prise (T-07), connexion refusée
    // avant vérification (F-001).
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    onExistingUserSignUp: planifierEmailCompteExistant,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    sendVerificationEmail: planifierEmailVerification,
  },
  // haveIBeenPwned : mots de passe compromis (S-10), refus si le service ne
  // répond pas ; aucun interrupteur (décision 2).
  plugins: [twoFactor(), organization(), haveIBeenPwned(), nextCookies()],
} satisfies BetterAuthOptions;

export const auth = betterAuth(optionsAuth);
