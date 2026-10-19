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
// Modifié à l'implémentation : la déconnexion relit la session par
// l'adaptateur interne (findSession), et non plus par auth.api.getSession,
// qui faisait écrire un Set-Cookie d'effacement par nextCookies.
const findSession = vi.fn<(jeton: string) => Promise<unknown>>(async () => null);
// Correctif de la 1.2 : l'ancienne session est révoquée par deleteSession.
const deleteSession = vi.fn<(jeton: string) => Promise<void>>(async () => {});
// 1.3 : le jeton de réinitialisation est lu, sans être consommé, avant
// Better Auth (docs/features/mot-de-passe.md, section 3.3).
const findVerificationValue = vi.fn<(identifiant: string) => Promise<unknown>>(async () => ({
  id: "v1",
  identifier: "reinitialisation:empreinte",
  value: "u1",
  expiresAt: new Date(Date.now() + 60_000),
}));
const contexteAuth = {
  authCookies: { sessionToken: { name: "better-auth.session_token" } },
  internalAdapter: { findSession, deleteSession, findVerificationValue },
};

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
  vi.doMock("./config", () => ({
    auth: { handler: traiter, $context: Promise.resolve(contexteAuth) },
  }));
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
  findSession.mockClear();
  deleteSession.mockClear();
  findVerificationValue.mockClear();
  vi.unstubAllGlobals();
  vi.doUnmock("../env");
  vi.doUnmock("./config");
  vi.doUnmock("../debit/debit");
});

// Modifié en 1.4 : délai de 30 s au lieu de 10 s. Chaque test recharge le
// gestionnaire et tous ses modules (vi.resetModules) ; avec la double
// authentification, le premier dépassait 10 s sous la charge de la suite
// complète (constaté aussi sur main, à 10,1 s seul). Rien de ce qui est
// vérifié ne change.
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
    expect(findSession).not.toHaveBeenCalled();
  }, 30_000);

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
  }, 30_000);

  test("hors production, une autre origine que BETTER_AUTH_URL est refusée", async () => {
    const { traiterRequeteAuth } = await charger(false);

    const reponse = await traiterRequeteAuth(
      post("/sign-up/email", POINTS[0]?.[1], "https://facturation-pme-git-branche.vercel.app"),
    );

    expect(reponse.status).toBe(403);
    expect(traiter).not.toHaveBeenCalled();
  }, 30_000);
});

describe("gestionnaire de /api/auth, liaison de la connexion (1.2)", () => {
  test("limite par compte : verifierDebit(auth.connexion_compte), adresse normalisée comme pour les emails", async () => {
    const { traiterRequeteAuth } = await charger(false);
    await traiterRequeteAuth(post("/sign-in/email", POINTS[3]?.[1]));
    expect(verifierDebit).toHaveBeenCalledTimes(1);
    expect(verifierDebit).toHaveBeenCalledWith("auth.connexion_compte", "awa.kone@exemple.invalid");
  }, 30_000);

  test("limite atteinte : Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(false);
    verifierDebit.mockResolvedValueOnce(false);
    const reponse = await traiterRequeteAuth(post("/sign-in/email", POINTS[3]?.[1]));
    expect(reponse.status).toBe(429);
    expect(traiter).not.toHaveBeenCalled();
  }, 30_000);

  test("déconnexion : la session est relue par l'adaptateur, avec le jeton du cookie reçu", async () => {
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
    expect(findSession).toHaveBeenCalledTimes(1);
    expect(findSession).toHaveBeenCalledWith("jeton");
  }, 30_000);

  test("déconnexion : une session encore lue donne une erreur", async () => {
    const { traiterRequeteAuth } = await charger(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    findSession.mockResolvedValueOnce({ session: { id: "s" }, user: { id: "u" } });
    const reponse = await traiterRequeteAuth(
      new Request(`${BASE}/sign-out`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGINE,
          cookie: "better-auth.session_token=jeton.signature",
        },
        body: "{}",
      }),
    );
    expect(reponse.status).toBe(500);
    vi.restoreAllMocks();
  }, 30_000);
});

describe("gestionnaire de /api/auth, révocation de l'ancienne session (correctif 1.2)", () => {
  function connexion(cookie?: string): Request {
    return new Request(`${BASE}/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGINE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(POINTS[3]?.[1]),
    });
  }

  test("connexion réussie avec un cookie : deleteSession avec le jeton de l'ancienne session", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const reponse = await traiterRequeteAuth(
      connexion("better-auth.session_token=ancien.signature"),
    );
    expect(reponse.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith("ancien");
  }, 30_000);

  test("connexion réussie sans cookie : rien à révoquer", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const reponse = await traiterRequeteAuth(connexion());
    expect(reponse.status).toBe(200);
    expect(deleteSession).not.toHaveBeenCalled();
  }, 30_000);
});

// Fonctionnalité 1.3. Fiche : docs/features/mot-de-passe.md, sections 3.3 et
// 5.
describe("gestionnaire de /api/auth, liaison de la réinitialisation (1.3)", () => {
  const JETON_REINITIALISATION = "aB3dE5fG7hJ9kL1mN2pQ4rS6";
  const DEMANDE = { email: "Awa.Kone+essai@Exemple.invalid" };
  const REINITIALISATION = {
    jeton: JETON_REINITIALISATION,
    motDePasse: "une-phrase-de-passe-neuve",
  };

  // Have I Been Pwned simulé : le mot de passe donné est compromis, tout
  // autre ne l'est pas. Aucun appel réel (garde réseau).
  async function simulerHibp(compromis: string | null) {
    const { createHash } = await import("node:crypto");
    const appels: string[] = [];
    vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
      const url = new URL(entree instanceof Request ? entree.url : entree);
      appels.push(url.hostname);
      if (url.hostname !== "api.pwnedpasswords.com") throw new Error("appel inattendu");
      if (compromis === null) return new Response("0000000000000000000000000000000000A:1");
      const empreinte = createHash("sha1").update(compromis).digest("hex").toUpperCase();
      return new Response(`${empreinte.slice(5)}:12`);
    });
    return appels;
  }

  test("en production : les deux POST répondent comme un chemin fermé, rien n'est appelé", async () => {
    const { traiterRequeteAuth } = await charger(true);
    const ferme = await forme(await traiterRequeteAuth(post("/n-existe-pas", {})));
    for (const [chemin, corps] of [
      ["/request-password-reset", DEMANDE],
      ["/reset-password", REINITIALISATION],
    ] as const) {
      expect(await forme(await traiterRequeteAuth(post(chemin, corps))), chemin).toEqual(ferme);
    }
    expect(traiter).not.toHaveBeenCalled();
    expect(verifierDebit).not.toHaveBeenCalled();
    expect(findVerificationValue).not.toHaveBeenCalled();
  }, 30_000);

  test("limite de la demande : verifierDebit(auth.reinitialisation_compte), adresse normalisée comme pour les emails", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const reponse = await traiterRequeteAuth(post("/request-password-reset", DEMANDE));
    expect(reponse.status).toBe(200);
    expect(verifierDebit).toHaveBeenCalledTimes(1);
    expect(verifierDebit).toHaveBeenCalledWith(
      "auth.reinitialisation_compte",
      "awa.kone@exemple.invalid",
    );
  }, 30_000);

  test("jeton lu sans être consommé, sous l'identifiant de Better Auth ; puis Have I Been Pwned ; puis Better Auth", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const appels = await simulerHibp(null);
    const reponse = await traiterRequeteAuth(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(200);
    expect(findVerificationValue).toHaveBeenCalledWith(`reset-password:${JETON_REINITIALISATION}`);
    expect(appels).toEqual(["api.pwnedpasswords.com"]);
    expect(traiter).toHaveBeenCalledTimes(1);
  }, 30_000);

  test.each([
    ["jeton absent", null],
    [
      "jeton expiré",
      {
        id: "v1",
        identifier: "reinitialisation:x",
        value: "u1",
        expiresAt: new Date(Date.now() - 1_000),
      },
    ],
  ])(
    "%s : lien_invalide, ni Have I Been Pwned ni Better Auth",
    async (_nom, ligne) => {
      const { traiterRequeteAuth } = await charger(false);
      const appels = await simulerHibp(null);
      findVerificationValue.mockResolvedValueOnce(ligne);
      const reponse = await traiterRequeteAuth(post("/reset-password", REINITIALISATION));
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ ok: false, raison: "lien_invalide" });
      expect(appels).toEqual([]);
      expect(traiter).not.toHaveBeenCalled();
    },
    10_000,
  );

  test("mot de passe compromis : mot_de_passe_compromis, Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(false);
    await simulerHibp(REINITIALISATION.motDePasse);
    const reponse = await traiterRequeteAuth(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
    expect(traiter).not.toHaveBeenCalled();
  }, 30_000);

  test("Have I Been Pwned en panne : erreur, Better Auth jamais appelé", async () => {
    const { traiterRequeteAuth } = await charger(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const reponse = await traiterRequeteAuth(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(500);
    expect(traiter).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  }, 30_000);

  test("vérification réussie avec un cookie : deleteSession avec le jeton de l'ancienne session (report de la 1.2)", async () => {
    const { traiterRequeteAuth } = await charger(false);
    const reponse = await traiterRequeteAuth(
      new Request(`${BASE}/verify-email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGINE,
          cookie: "better-auth.session_token=ancien.signature",
        },
        body: JSON.stringify({ jeton: JETON }),
      }),
    );
    expect(reponse.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith("ancien");
  }, 30_000);
});
