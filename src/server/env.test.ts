import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Chargement réel de src/server/env.ts : une configuration d'envoi invalide
// fait échouer le chargement, exactement comme une DATABASE_URL invalide
// (src/instrumentation.ts l'importe au lancement : une configuration refusée
// fait échouer chaque requête). Et la configuration de Vercel après la PR 2
// se charge : production avec les variables Gmail, prévisualisation sans
// variable d'envoi. Valeurs factices. Fiche :
// docs/features/envoi-emails.md, section 2.2 et « Découpage en PR » ;
// décision 1 du relecteur sur la phase rouge.

const BASE = {
  DATABASE_URL:
    "postgresql://app_facturation:mdp-factice@base.exemple.test/facturation?sslmode=verify-full",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://facturation.exemple.test",
} as const;

// Toute variable lue par env.ts, effacée avant chaque cas : le résultat ne
// dépend pas de l'environnement du poste ou du job de CI.
const LUES = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "EMAIL_TRANSPORT",
  "EMAIL_DESTINATAIRES_AUTORISES",
  "EMAIL_DOSSIER",
  "GMAIL_UTILISATEUR",
  "GMAIL_MOT_DE_PASSE_APPLICATION",
] as const;

function poser(variables: Partial<Record<(typeof LUES)[number], string>>): void {
  for (const nom of LUES) vi.stubEnv(nom, variables[nom]);
}

async function charger() {
  vi.resetModules();
  return import("./env");
}

async function erreurDeChargement(): Promise<Error> {
  try {
    await charger();
  } catch (erreur) {
    return erreur as Error;
  }
  throw new Error("Le chargement de env.ts aurait dû échouer.");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env.ts : chargement", () => {
  test("témoin : configuration valide, env et configurationEmail exportés", async () => {
    poser({ ...BASE, NODE_ENV: "test" });

    const charge = await charger();

    expect(charge.env.BETTER_AUTH_URL).toBe(BASE.BETTER_AUTH_URL);
    expect(charge.configurationEmail).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: false,
      gmail: null,
    });
  });

  test("témoin : DATABASE_URL invalide, le chargement échoue", async () => {
    poser({ ...BASE, NODE_ENV: "test", DATABASE_URL: "pas-une-adresse" });

    const erreur = await erreurDeChargement();

    expect(erreur.message).toMatch(/^- DATABASE_URL : /mu);
  });

  test.each([
    ["EMAIL_TRANSPORT inconnue", { EMAIL_TRANSPORT: "valeur-piege-42" }, "EMAIL_TRANSPORT"],
    ["EMAIL_TRANSPORT vide", { EMAIL_TRANSPORT: "" }, "EMAIL_TRANSPORT"],
    [
      "EMAIL_DESTINATAIRES_AUTORISES invalide",
      { EMAIL_DESTINATAIRES_AUTORISES: "valeur-piege-42" },
      "EMAIL_DESTINATAIRES_AUTORISES",
    ],
    [
      "fichier sur Vercel",
      { EMAIL_TRANSPORT: "fichier", VERCEL: "1", VERCEL_ENV: "preview" },
      "EMAIL_TRANSPORT",
    ],
  ] as const)(
    "%s : le chargement échoue, comme pour DATABASE_URL, sans la valeur",
    async (_nom, variables, nomVariable) => {
      poser({ ...BASE, NODE_ENV: "production", ...variables });

      const erreur = await erreurDeChargement();

      expect(erreur.message).toMatch(new RegExp(`^- ${nomVariable} : `, "mu"));
      expect(erreur.message).not.toContain("valeur-piege-42");
    },
  );

  test("après la PR 2 : Vercel production sans aucune variable d'envoi, le chargement échoue", async () => {
    poser({
      ...BASE,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_URL: "facturation-abc123.vercel.app",
    });

    const erreur = await erreurDeChargement();

    expect(erreur.message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
  });

  test("après la PR 2 : Vercel preview sans aucune variable d'envoi, env.ts se charge (memoire)", async () => {
    poser({
      ...BASE,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "facturation-abc123.vercel.app",
    });

    const charge = await charger();

    expect(charge.configurationEmail).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: false,
      gmail: null,
    });
  });

  // Configuration de Vercel au 2026-10-13 : variables Gmail posées en
  // production seulement, EMAIL_TRANSPORT absente : smtp.
  test("après la PR 2 : production avec les variables Gmail, sans EMAIL_TRANSPORT, env.ts se charge (smtp)", async () => {
    poser({
      ...BASE,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_URL: "facturation-abc123.vercel.app",
      GMAIL_UTILISATEUR: "facturation.factice@gmail.com",
      GMAIL_MOT_DE_PASSE_APPLICATION: "abcdefghijklmnop",
    });

    const charge = await charger();

    expect(charge.configurationEmail).toStrictEqual({
      transport: "smtp",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: true,
      gmail: { utilisateur: "facturation.factice@gmail.com", motDePasse: "abcdefghijklmnop" },
    });
  });
});

// PR 2 : chargement réel de env.ts avec la règle corrigée (section 2.2).
describe("env.ts : chargement, PR 2", () => {
  const GMAIL = {
    GMAIL_UTILISATEUR: "facturation.factice@gmail.com",
    GMAIL_MOT_DE_PASSE_APPLICATION: "abcdefghijklmnop",
  } as const;
  const PRODUCTION = {
    ...BASE,
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "facturation-abc123.vercel.app",
  } as const;

  test("production, variables Gmail, EMAIL_TRANSPORT absente : se charge, smtp", async () => {
    poser({ ...PRODUCTION, ...GMAIL });

    const charge = await charger();

    expect(charge.configurationEmail.transport).toBe("smtp");
    expect(charge.configurationEmail.estProduction).toBe(true);
  });

  test("production sans variable Gmail : le chargement échoue, variables nommées", async () => {
    poser({ ...PRODUCTION });

    const erreur = await erreurDeChargement();

    expect(erreur.message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
    expect(erreur.message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
  });

  test("production, mot de passe mal formé : le chargement échoue, sans la valeur", async () => {
    poser({ ...PRODUCTION, ...GMAIL, GMAIL_MOT_DE_PASSE_APPLICATION: "valeur-piege-42" });

    const erreur = await erreurDeChargement();

    expect(erreur.message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
    expect(erreur.message).not.toContain("valeur-piege-42");
    expect(erreur.message).not.toContain(GMAIL.GMAIL_UTILISATEUR);
  });

  test("prévisualisation sans aucune variable d'envoi : se charge, memoire", async () => {
    poser({ ...PRODUCTION, VERCEL_ENV: "preview" });

    const charge = await charger();

    expect(charge.configurationEmail.transport).toBe("memoire");
  });
});
