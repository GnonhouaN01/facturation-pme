import { afterEach, describe, expect, test, vi } from "vitest";

// Liaison du gestionnaire de /api/auth à l'application : auth.handler,
// l'origine de BETTER_AUTH_URL, et la production lue de la configuration
// (VERCEL_ENV). En production, les trois points d'entrée de l'inscription
// reçoivent la réponse d'un chemin fermé, octet pour octet, sans que Better
// Auth soit appelé (décision 1) ; ailleurs, ils l'atteignent. Fiche :
// docs/features/inscription.md, section 2.3, tests 11a et 16. Connexion et
// déconnexion (1.2) : fermées en production aussi ; hors production, la
// limite par compte est liée à verifierDebit (auth.connexion_compte, adresse
// normalisée comme pour les emails) et la déconnexion relit la session par
// auth.api.getSession. Fiche : docs/features/connexion.md, sections 1.3, 3 et
// 4.2.

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
  [
    "/sign-in/email",
    { email: "Awa.Kone+essai@Exemple.invalid", motDePasse: "une-phrase-de-passe" },
  ],
  ["/sign-out", {}],
];

const COOKIE_SESSION = "better-auth.session_token=jeton.signature; Path=/; HttpOnly";

const traiter = vi.fn<(requete: Request) => Promise<Response>>(
  async () =>
    new Response(JSON.stringify({ status: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": COOKIE_SESSION },
    }),
);
const verifierDebit = vi.fn<(nom: string, valeur: string) => Promise<boolean>>(async () => true);
const getSession = vi.fn<(options: { headers: Headers }) => Promise<unknown>>(async () => null);

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
  vi.doMock("./config", () => ({ auth: { handler: traiter, api: { getSession } } }));
  vi.doMock("../debit/debit", () => ({ verifierDebit }));
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
  verifierDebit.mockClear();
  getSession.mockClear();
  vi.doUnmock("../env");
  vi.doUnmock("./config");
  vi.doUnmock("../debit/debit");
});

describe("gestionnaire de /api/auth, liaison", () => {
  // Modifié en 1.2 : cinq POST au lieu de trois (connexion et déconnexion).
  test("en production : les cinq POST des comptes répondent comme un chemin fermé, Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(true);
    const ferme = await forme(await traiterRequeteAuth(post("/n-existe-pas", {})));

    for (const [chemin, corps] of POINTS) {
      expect(await forme(await traiterRequeteAuth(post(chemin, corps))), chemin).toEqual(ferme);
    }
    expect(ferme).toEqual({ statut: 404, entetes: [], corps: "" });
    expect(traiter).not.toHaveBeenCalled();
    expect(verifierDebit).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  }, 10_000);

  test("témoin, hors production : chacun atteint Better Auth, avec l'origine de BETTER_AUTH_URL", async () => {
    const { traiterRequeteAuth } = await charger(false);

    for (const [chemin, corps] of POINTS) {
      const reponse = await traiterRequeteAuth(post(chemin, corps));
      expect(reponse.status, chemin).toBe(200);
    }
    expect(traiter).toHaveBeenCalledTimes(5);
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

describe("gestionnaire de /api/auth, liaison de la connexion (1.2)", () => {
  test("limite par compte : verifierDebit(auth.connexion_compte), adresse normalisée comme pour les emails", async () => {
    const { traiterRequeteAuth } = await charger(false);
    await traiterRequeteAuth(post("/sign-in/email", POINTS[3]?.[1]));
    expect(verifierDebit).toHaveBeenCalledTimes(1);
    expect(verifierDebit).toHaveBeenCalledWith("auth.connexion_compte", "awa.kone@exemple.invalid");
  }, 10_000);

  test("limite atteinte : Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(false);
    verifierDebit.mockResolvedValueOnce(false);
    const reponse = await traiterRequeteAuth(post("/sign-in/email", POINTS[3]?.[1]));
    expect(reponse.status).toBe(429);
    expect(traiter).not.toHaveBeenCalled();
  }, 10_000);

  test("déconnexion : la session est relue par auth.api.getSession avec le cookie reçu", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const requete = new Request(`${BASE}/sign-out`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.session_token=jeton.signature",
      },
      body: "{}",
    });
    const reponse = await traiterRequeteAuth(requete);
    expect(reponse.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0].headers.get("cookie")).toBe(
      "better-auth.session_token=jeton.signature",
    );
  }, 10_000);

  test("déconnexion : une session encore lue donne une erreur", async () => {
    const { traiterRequeteAuth } = await charger(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValueOnce({ session: { id: "s" }, user: { id: "u" } });
    const reponse = await traiterRequeteAuth(post("/sign-out", {}));
    expect(reponse.status).toBe(500);
    vi.restoreAllMocks();
  }, 10_000);
});
