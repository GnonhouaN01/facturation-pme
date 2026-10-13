import { createHash, randomUUID } from "node:crypto";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, test, vi } from "vitest";

import { optionsAuth } from "./config";
import { creerTraitementAuth } from "./points-entree";

// S-10 et décision 2 : mots de passe compromis par Have I Been Pwned, refus
// si le service ne répond pas, et aucun appel au vrai service depuis un test.
// Base en mémoire (adaptateur de Better Auth) : l'inscription atteint le
// hachage, donc la recherche. Fiche : docs/features/inscription.md,
// section 5.2.

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

const ORIGINE = "http://localhost:3000";
const HOTE_HIBP = "api.pwnedpasswords.com";
const MOT_DE_PASSE = "une-phrase-de-passe-solide";

function instance() {
  const options = optionsAuth as BetterAuthOptions;
  const auth = betterAuth({
    ...options,
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
      twoFactor: [],
      organization: [],
      member: [],
      invitation: [],
    }),
    // Ni débit ni email : seul le contrôle du mot de passe est en cause.
    rateLimit: {
      ...options.rateLimit,
      customStorage: { consume: async () => ({ allowed: true, retryAfter: null }) },
    },
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      onExistingUserSignUp: async () => {},
    },
    emailVerification: { ...options.emailVerification, sendVerificationEmail: async () => {} },
  });
  return creerTraitementAuth({
    traiter: (requete) => auth.handler(requete),
    origine: ORIGINE,
    estProduction: false,
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
}

function inscription(motDePasse = MOT_DE_PASSE): Request {
  return new Request(`${ORIGINE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE },
    body: JSON.stringify({ nom: "Awa", email: `awa-${randomUUID()}@exemple.invalid`, motDePasse }),
  });
}

// Simule le service pour son seul hôte ; tout autre appel lève. Renvoie la
// liste des adresses demandées.
function simulerHibp(reponse: (url: URL) => Promise<Response>): string[] {
  const demandes: string[] = [];
  vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
    const url = new URL(entree instanceof Request ? entree.url : entree);
    if (url.hostname !== HOTE_HIBP) throw new Error(`appel inattendu vers ${url.hostname}`);
    demandes.push(url.pathname);
    return reponse(url);
  });
  return demandes;
}

function suffixeSha1(motDePasse: string): { prefixe: string; suffixe: string } {
  const empreinte = createHash("sha1").update(motDePasse).digest("hex").toUpperCase();
  return { prefixe: empreinte.slice(0, 5), suffixe: empreinte.slice(5) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Have I Been Pwned : mot de passe compromis (S-10)", () => {
  test("mot de passe présent dans la liste : mot_de_passe_compromis", async () => {
    const { prefixe, suffixe } = suffixeSha1(MOT_DE_PASSE);
    const demandes = simulerHibp(
      async () => new Response(`${suffixe}:42\r\n0000000000000000000000000000000000A:1\r\n`),
    );

    const reponse = await instance()(inscription());

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
    // Seul le préfixe de 5 caractères de l'empreinte part (anonymat par préfixe).
    expect(demandes).toEqual([`/range/${prefixe}`]);
  });

  test("témoin : absent de la liste, inscription acceptée", async () => {
    simulerHibp(async () => new Response("0000000000000000000000000000000000A:1\r\n"));
    const reponse = await instance()(inscription());
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
  });
});

describe("Have I Been Pwned indisponible : inscription refusée (décision 2)", () => {
  test("le service ne répond pas (exception réseau) : erreur", async () => {
    const demandes = simulerHibp(async () => {
      throw new TypeError("fetch failed");
    });
    const reponse = await instance()(inscription());
    expect(demandes).toHaveLength(1);
    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toEqual({ ok: false, raison: "erreur" });
  });

  test.each([503, 500, 429])("le service répond %i : erreur", async (statut) => {
    simulerHibp(async () => new Response("indisponible", { status: statut }));
    const reponse = await instance()(inscription());
    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toEqual({ ok: false, raison: "erreur" });
  });
});

describe("garde réseau : aucun test n'appelle le vrai service", () => {
  test("fetch est enveloppé par la garde réseau des tests", () => {
    expect((globalThis.fetch as unknown as { gardeReseau?: unknown }).gardeReseau).toBe(true);
  });

  test("un appel non simulé vers le service est refusé, sans réseau", async () => {
    expect((globalThis.fetch as unknown as { gardeReseau?: unknown }).gardeReseau).toBe(true);
    await expect(fetch(`https://${HOTE_HIBP}/range/00000`)).rejects.toThrow(/Garde réseau/u);
  });

  test("sans simulation, l'inscription est refusée, jamais acceptée par un appel réel", async () => {
    expect((globalThis.fetch as unknown as { gardeReseau?: unknown }).gardeReseau).toBe(true);
    const reponse = await instance()(inscription());
    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toEqual({ ok: false, raison: "erreur" });
  });
});
