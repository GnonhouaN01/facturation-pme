import { randomUUID } from "node:crypto";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

import { adaptateurSur, basePanne, cookieSessionSigne } from "../db/outils-test/panne";

import { optionsAuth } from "./config";
import { creerTraitementAuth } from "./points-entree";

// T-39 : base en panne pendant une lecture de Better Auth. Aucun jeton de
// session, aucune adresse, aucune requête SQL ne doit paraître dans ce
// qu'écrit le processus (console et flux standard). Sans base réelle : la
// base vise un port fermé. Fiche : docs/features/inscription.md, section 1.3.

const ORIGINE = "http://localhost:3000";
const SECRET = "secret-factice-de-trente-deux-caracteres";

// config.ts charge env.ts : valeurs factices, base sur un port fermé.
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

const base = basePanne();
afterAll(() => base.fermer());

// Tout ce que le processus écrit pendant le test : console et flux standard.
// Rien n'est affiché : la sortie est gardée pour être inspectée.
function capturer(): () => string {
  const morceaux: string[] = [];
  const garder = (...valeurs: unknown[]) => {
    morceaux.push(
      valeurs.map((valeur) => (typeof valeur === "string" ? valeur : inspecter(valeur))).join(" "),
    );
  };
  for (const methode of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, methode).mockImplementation(garder);
  }
  for (const flux of [process.stdout, process.stderr]) {
    vi.spyOn(flux, "write").mockImplementation((morceau: string | Uint8Array) => {
      morceaux.push(typeof morceau === "string" ? morceau : Buffer.from(morceau).toString("utf8"));
      return true;
    });
  }
  return () => morceaux.join("\n");
}

// Rendu complet d'une valeur, comme le ferait la console : message, pile,
// cause et propriétés propres.
function inspecter(valeur: unknown): string {
  if (valeur instanceof Error) {
    const proprietes = Object.getOwnPropertyNames(valeur).map((nom) => {
      const champ = (valeur as unknown as Record<string, unknown>)[nom];
      return `${nom}=${typeof champ === "string" ? champ : (JSON.stringify(champ, null, 0) ?? String(champ))}`;
    });
    return [
      valeur.name,
      valeur.message,
      valeur.stack ?? "",
      inspecter(valeur.cause),
      ...proprietes,
    ].join("\n");
  }
  try {
    return JSON.stringify(valeur) ?? String(valeur);
  } catch {
    return String(valeur);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// Le débit n'est pas l'objet de ce test : un stockage qui accepte tout, pour
// que la requête atteigne la lecture en base du point d'entrée.
const toutAccepter = {
  consume: async () => ({ allowed: true, retryAfter: null }),
};

function instance(options: BetterAuthOptions) {
  return betterAuth({
    ...options,
    database: adaptateurSur(base.db),
    rateLimit: { ...options.rateLimit, customStorage: toutAccepter },
  });
}

// Configuration par défaut de Better Auth pour le journal et les erreurs :
// le témoin qui montre la fuite.
function optionsParDefaut(): BetterAuthOptions {
  const { logger, onAPIError, ...reste } = optionsAuth as BetterAuthOptions;
  void logger;
  void onAPIError;
  return reste;
}

const INTERDITS_COMMUNS = [
  "Failed query",
  "params:",
  "select ",
  "SERVER_ERROR",
  "base_injoignable",
];

function cookie(valeur: string): Headers {
  return new Headers({ cookie: `better-auth.session_token=${valeur}` });
}

function inscription(email: string, motDePasse: string): Request {
  return new Request(`${ORIGINE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE },
    body: JSON.stringify({ nom: "Victime", email, motDePasse }),
  });
}

describe("T-39 : lecture de session pendant une panne de la base", { timeout: 30_000 }, () => {
  test("témoin : avec le journal par défaut de Better Auth, le jeton paraît", async () => {
    const auth = instance(optionsParDefaut());
    const { jeton, valeur } = cookieSessionSigne(SECRET);
    const lire = capturer();

    await auth.api.getSession({ headers: cookie(valeur) }).catch(() => null);

    expect(lire()).toContain(jeton);
  });

  test("configuration de l'application : ni jeton, ni requête, ni paramètres", async () => {
    const auth = instance(optionsAuth as BetterAuthOptions);
    const { jeton, valeur } = cookieSessionSigne(SECRET);
    const lire = capturer();

    await auth.api.getSession({ headers: cookie(valeur) }).catch(() => null);

    const sortie = lire();
    expect(sortie).not.toContain(jeton);
    for (const interdit of INTERDITS_COMMUNS) expect(sortie).not.toContain(interdit);
  });
});

describe("T-39 : inscription pendant une panne de la base", { timeout: 30_000 }, () => {
  const MOT_DE_PASSE = "Mot-de-passe-factice-du-test-39";

  test("témoin : par le routeur de Better Auth seul, l'adresse saisie paraît", async () => {
    const auth = instance(optionsParDefaut());
    const email = `victime-${randomUUID()}@exemple.invalid`;
    const lire = capturer();

    await auth.handler(
      new Request(`${ORIGINE}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGINE },
        body: JSON.stringify({ name: "Victime", email, password: MOT_DE_PASSE }),
      }),
    );

    expect(lire()).toContain(email);
  });

  test("configuration de l'application, par notre gestionnaire : réponse fixe, rien au journal", async () => {
    const auth = instance(optionsAuth as BetterAuthOptions);
    const traiter = creerTraitementAuth({
      traiter: (requete) => auth.handler(requete),
      origine: ORIGINE,
      estProduction: false,
      horloge: { maintenant: () => 0, attendre: async () => {} },
    });
    const email = `victime-${randomUUID()}@exemple.invalid`;
    const lire = capturer();

    const reponse = await traiter(inscription(email, MOT_DE_PASSE));

    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toEqual({ ok: false, raison: "erreur" });
    const sortie = lire();
    expect(sortie).not.toContain(email);
    expect(sortie).not.toContain(MOT_DE_PASSE);
    for (const interdit of INTERDITS_COMMUNS) expect(sortie).not.toContain(interdit);
    // Une ligne fixe garde le signal, sans contenu.
    expect(sortie).toMatch(/\[auth\]/u);
  });
});
