import { afterEach, describe, expect, test, vi } from "vitest";

// Liaison du gestionnaire de /api/auth à l'application : auth.handler,
// l'origine de BETTER_AUTH_URL, et la production lue de la configuration
// (VERCEL_ENV). En production, les trois points d'entrée de l'inscription
// reçoivent la réponse d'un chemin fermé, octet pour octet, sans que Better
// Auth soit appelé (décision 1) ; ailleurs, ils l'atteignent. Fiche :
// docs/features/inscription.md, section 2.3, tests 11a et 16.

const ORIGINE = "http://localhost:3000";
const BASE = `${ORIGINE}/api/auth`;
const JETON =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U";

const POINTS: readonly [string, unknown][] = [
  [
    "/sign-up/email",
    { nom: "Awa Koné", email: "awa@exemple.invalid", motDePasse: "une-phrase-de-passe-solide" },
  ],
  ["/send-verification-email", { email: "awa@exemple.invalid" }],
  ["/verify-email", { jeton: JETON }],
];

const traiter = vi.fn<(requete: Request) => Promise<Response>>(async () =>
  Response.json({ status: true }),
);

// Le gestionnaire, chargé avec une configuration factice. Better Auth est
// remplacé par un espion : seul le branchement est vérifié ici.
async function charger(estProduction: boolean) {
  vi.resetModules();
  vi.doMock("../env", () => ({
    env: {
      DATABASE_URL: "postgresql://app_facturation:factice@127.0.0.1:1/factice",
      BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
      BETTER_AUTH_URL: ORIGINE,
    },
    configurationEmail: {
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction,
      gmail: null,
    },
  }));
  vi.doMock("./config", () => ({ auth: { handler: traiter } }));
  return import("./gestionnaire");
}

function post(chemin: string, corps: unknown, origine = ORIGINE): Request {
  return new Request(`${BASE}${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: origine },
    body: JSON.stringify(corps),
  });
}

async function forme(reponse: Response) {
  return {
    statut: reponse.status,
    entetes: [...reponse.headers.entries()],
    corps: await reponse.text(),
  };
}

afterEach(() => {
  traiter.mockClear();
  vi.doUnmock("../env");
  vi.doUnmock("./config");
});

describe("gestionnaire de /api/auth, liaison", () => {
  test("en production : les trois POST de l'inscription répondent comme un chemin fermé, Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(true);
    const ferme = await forme(await traiterRequeteAuth(post("/n-existe-pas", {})));

    for (const [chemin, corps] of POINTS) {
      expect(await forme(await traiterRequeteAuth(post(chemin, corps))), chemin).toEqual(ferme);
    }
    expect(ferme).toEqual({ statut: 404, entetes: [], corps: "" });
    expect(traiter).not.toHaveBeenCalled();
  }, 10_000);

  test("témoin, hors production : chacun atteint Better Auth, avec l'origine de BETTER_AUTH_URL", async () => {
    const { traiterRequeteAuth } = await charger(false);

    for (const [chemin, corps] of POINTS) {
      const reponse = await traiterRequeteAuth(post(chemin, corps));
      expect(reponse.status, chemin).toBe(200);
    }
    expect(traiter).toHaveBeenCalledTimes(3);
    for (const [requete] of traiter.mock.calls) {
      expect(new URL(requete.url).origin).toBe(ORIGINE);
    }
  }, 10_000);

  test("hors production, une autre origine que BETTER_AUTH_URL est refusée", async () => {
    const { traiterRequeteAuth } = await charger(false);

    const reponse = await traiterRequeteAuth(
      post("/sign-up/email", POINTS[0]?.[1], "https://facturation-pme-git-branche.vercel.app"),
    );

    expect(reponse.status).toBe(403);
    expect(traiter).not.toHaveBeenCalled();
  }, 10_000);
});
