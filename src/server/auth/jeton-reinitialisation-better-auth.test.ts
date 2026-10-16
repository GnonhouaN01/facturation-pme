import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, test, vi } from "vitest";

import { JETON_REINITIALISATION } from "@/schemas/regles-compte";

import { empreinteJetonReinitialisation } from "./reinitialisation";

// Le jeton de réinitialisation tel que le produit la version installée de
// Better Auth (generateId(24)) : 24 caractères [A-Za-z0-9], la forme
// qu'admettent notre schéma et notre brique d'email. Et, avec notre réglage
// storeIdentifier, la ligne stockée ne porte que l'empreinte. Ce test fige
// le comportement de la version installée, sans base : une mise à jour qui
// le change fait échouer la suite (comme le test de l'adresse IP de la 1.1).
// Fiche : docs/features/mot-de-passe.md, sections 1 et 3.2, test 13.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@127.0.0.1:1/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "http://localhost:3000",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
    gmail: null,
  },
}));

type Ligne = Record<string, unknown>;

async function demander(options: { hache: boolean }) {
  const base: Record<string, Ligne[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const jetons: string[] = [];
  const auth = betterAuth({
    secret: "secret-factice-de-trente-deux-caracteres",
    baseURL: "http://localhost:3000",
    database: memoryAdapter(base),
    logger: { disabled: true },
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ token }) => {
        jetons.push(token);
      },
    },
    ...(options.hache
      ? {
          verification: {
            storeIdentifier: {
              default: "plain" as const,
              overrides: { "reset-password:": { hash: empreinteJetonReinitialisation } },
            },
          },
        }
      : {}),
  });
  await auth.api.signUpEmail({
    body: { name: "Awa", email: "awa@exemple.invalid", password: "une-phrase-de-passe-solide" },
  });
  const avant = Date.now();
  await auth.api.requestPasswordReset({ body: { email: "awa@exemple.invalid" } });
  return { jetons, lignes: base.verification ?? [], avant };
}

describe("jeton de réinitialisation de Better Auth 1.7.7", () => {
  test("24 caractères [A-Za-z0-9], la forme de notre schéma ; un jeton neuf à chaque demande", async () => {
    const a = await demander({ hache: false });
    const b = await demander({ hache: false });
    const [jetonA] = a.jetons;
    const [jetonB] = b.jetons;
    expect(jetonA).toMatch(/^[A-Za-z0-9]{24}$/u);
    expect(jetonA).toMatch(JETON_REINITIALISATION);
    expect(jetonB).not.toBe(jetonA);
  });

  test("sans notre réglage : identifiant en clair reset-password:<jeton> (le défaut que S-15 refuse)", async () => {
    const { jetons, lignes } = await demander({ hache: false });
    expect(lignes.map((l) => l.identifier)).toContain(`reset-password:${jetons[0]}`);
  });

  test("avec notre réglage : seule l'empreinte est stockée, durée de 30 minutes, valeur l'utilisateur", async () => {
    const { jetons, lignes, avant } = await demander({ hache: true });
    const jeton = jetons[0] ?? "";
    expect(lignes).toHaveLength(1);
    const [ligne] = lignes;
    expect(ligne?.identifier).toBe(await empreinteJetonReinitialisation(`reset-password:${jeton}`));
    expect(JSON.stringify(lignes)).not.toContain(jeton);
    const expire = new Date(ligne?.expiresAt as Date).getTime();
    expect(expire - avant).toBeGreaterThan(29 * 60 * 1000);
    expect(expire - avant).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);
  });
});
