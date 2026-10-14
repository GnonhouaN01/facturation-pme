import { afterEach, describe, expect, test, vi } from "vitest";

import { creerTraitementAuth, DUREE_PLANCHER_MS, type Horloge } from "./points-entree";

// Le gestionnaire des points d'entrée ouverts : réponses de Better Auth
// traduites en une liste fermée, erreurs attrapées, durée plancher (T-07).
// Fiche : docs/features/inscription.md, sections 2.2 et 4.4. Connexion et
// déconnexion (1.2) : durée plancher, déconnexion vérifiée, identifiant
// d'incident dans toute réponse « erreur ». Fiche : docs/features/connexion.md,
// tests 7 à 9.

const ORIGINE = "http://localhost:3000";
const JETON =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U";

const INSCRIPTION = {
  nom: "Awa Koné",
  email: "awa@exemple.invalid",
  motDePasse: "une-phrase-de-passe-solide",
};

const IMMEDIATE: Horloge = { maintenant: () => 0, attendre: async () => {} };

function post(chemin: string, corps: unknown): Request {
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE },
    body: JSON.stringify(corps),
  });
}

function avec(
  reponse: Response | (() => Promise<Response>),
  horloge: Horloge = IMMEDIATE,
  options: {
    limite?: () => Promise<boolean>;
    sessionLisible?: (entetes: Headers) => Promise<boolean>;
  } = {},
) {
  const traiter = vi.fn(async () => (typeof reponse === "function" ? reponse() : reponse.clone()));
  return creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: false,
    limiterCompte: options.limite ?? (async () => true),
    sessionEncoreLisible: options.sessionLisible ?? (async () => false),
    horloge,
  });
}

function erreurBetterAuth(statut: number, code: string): Response {
  return Response.json({ code, message: `Message de Better Auth : ${code}` }, { status: statut });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("traduction des réponses de Better Auth", () => {
  test("inscription réussie : { ok: true }, sans l'utilisateur ni le jeton de Better Auth", async () => {
    const gerer = avec(
      Response.json({
        token: null,
        user: { id: "u1", email: INSCRIPTION.email, name: INSCRIPTION.nom },
      }),
    );
    const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    expect(reponse.headers.get("content-type")).toMatch(/^application\/json/u);
    expect(reponse.headers.get("cache-control")).toBe("no-store");
    expect(reponse.headers.get("set-cookie")).toBeNull();
  });

  test.each([
    [400, "PASSWORD_TOO_SHORT", 400, "mot_de_passe_trop_court"],
    [400, "PASSWORD_COMPROMISED", 400, "mot_de_passe_compromis"],
    [400, "INVALID_EMAIL", 400, "invalide"],
    [422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", 400, "invalide"],
  ] as const)(
    "Better Auth %s %s : %s %s, sans son message",
    async (statut, code, attendu, raison) => {
      const gerer = avec(erreurBetterAuth(statut, code));
      const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
      expect(reponse.status).toBe(attendu);
      const texte = await reponse.text();
      expect(texte).toBe(JSON.stringify({ ok: false, raison }));
      expect(texte).not.toContain("Message de Better Auth");
    },
  );

  test("429 de Better Auth : trop_de_requetes, sans X-Retry-After", async () => {
    const gerer = avec(
      new Response(JSON.stringify({ message: "Too many requests" }), {
        status: 429,
        headers: { "X-Retry-After": "3600" },
      }),
    );
    const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(reponse.headers.get("x-retry-after")).toBeNull();
    expect(reponse.headers.get("retry-after")).toBeNull();
  });

  test("renvoi : { ok: true }", async () => {
    const gerer = avec(Response.json({ status: true }));
    const reponse = await gerer(post("/send-verification-email", { email: INSCRIPTION.email }));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
  });

  test("vérification réussie : { ok: true } et le cookie de session de Better Auth", async () => {
    const entetes = new Headers();
    entetes.append(
      "set-cookie",
      "better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax",
    );
    entetes.append("content-type", "application/json");
    const gerer = avec(
      new Response(JSON.stringify({ status: true, user: null }), { status: 200, headers: entetes }),
    );
    const reponse = await gerer(post("/verify-email", { jeton: JETON }));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    expect(reponse.headers.getSetCookie()).toEqual([
      "better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax",
    ]);
  });

  test.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND"])(
    "vérification refusée par Better Auth (%s) : lien_invalide, sans cookie",
    async (code) => {
      const gerer = avec(erreurBetterAuth(401, code));
      const reponse = await gerer(post("/verify-email", { jeton: JETON }));
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ ok: false, raison: "lien_invalide" });
      expect(reponse.headers.get("set-cookie")).toBeNull();
    },
  );

  test("seul le cookie de /verify-email est gardé : jamais sur l'inscription", async () => {
    const gerer = avec(
      new Response("{}", { status: 200, headers: { "set-cookie": "x=y; Path=/", "x-autre": "1" } }),
    );
    const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
    expect(reponse.headers.get("set-cookie")).toBeNull();
    expect(reponse.headers.get("x-autre")).toBeNull();
  });

  // Modifié en 1.2 : le cas 500 INTERNAL_SERVER_ERROR est sorti du tableau
  // ci-dessus, la réponse « erreur » portant désormais un identifiant
  // d'incident (test 9 de docs/features/connexion.md, plus bas).
  test("exception de Better Auth : 500 erreur, une ligne [auth] sans contenu", async () => {
    const lignes: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs.map(String).join(" "));
    });
    const gerer = avec(async () => {
      throw new Error(`Failed query: select ... params: ${INSCRIPTION.email}`);
    });
    const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
    expect(reponse.status).toBe(500);
    // 1.2 : l'incident s'ajoute au corps (dette de PLAN.md, section 7).
    expect(await reponse.json()).toMatchObject({ ok: false, raison: "erreur" });
    expect(lignes.join("\n")).toMatch(/^\[auth\]/u);
    expect(lignes.join("\n")).not.toContain(INSCRIPTION.email);
    expect(lignes.join("\n")).not.toContain("Failed query");
  });
});

describe("durée plancher (T-07)", () => {
  function horloge(instants: number[]) {
    const attentes: number[] = [];
    let i = 0;
    const h: Horloge = {
      maintenant: () => instants[Math.min(i++, instants.length - 1)] ?? 0,
      attendre: async (ms) => {
        attentes.push(ms);
      },
    };
    return { h, attentes };
  }

  test("la durée plancher vaut 800 ms", () => {
    expect(DUREE_PLANCHER_MS).toBe(800);
  });

  test.each([
    ["/sign-up/email", INSCRIPTION],
    ["/send-verification-email", { email: INSCRIPTION.email }],
  ] as const)("%s, réponse en 100 ms : retenue 700 ms de plus", async (chemin, corps) => {
    const { h, attentes } = horloge([1_000, 1_100]);
    const gerer = avec(Response.json({ status: true }), h);
    await gerer(post(chemin, corps));
    expect(attentes).toEqual([700]);
  });

  test("réponse en 900 ms : aucune attente de plus", async () => {
    const { h, attentes } = horloge([1_000, 1_900]);
    const gerer = avec(Response.json({ status: true }), h);
    await gerer(post("/sign-up/email", INSCRIPTION));
    expect(attentes.filter((ms) => ms > 0)).toEqual([]);
  });

  test("refus de validation : retenu aussi (le chemin suivi ne se mesure pas)", async () => {
    const { h, attentes } = horloge([1_000, 1_010]);
    const gerer = avec(Response.json({ status: true }), h);
    await gerer(post("/sign-up/email", { ...INSCRIPTION, motDePasse: "court" }));
    expect(attentes).toEqual([790]);
  });

  test("vérification : aucune durée plancher (aucune existence de compte à cacher)", async () => {
    const { h, attentes } = horloge([1_000, 1_010]);
    const gerer = avec(Response.json({ status: true }), h);
    await gerer(post("/verify-email", { jeton: JETON }));
    expect(attentes.filter((ms) => ms > 0)).toEqual([]);
  });
});

// Fonctionnalité 1.2. Fiche : docs/features/connexion.md, tests 7 à 9.

const CONNEXION = { email: "awa@exemple.invalid", motDePasse: "une-phrase-de-passe-solide" };
const COOKIE_SESSION = "better-auth.session_token=jeton.signature; Path=/; HttpOnly; SameSite=Lax";
const EFFACEMENT = "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function avecCookies(statut: number, corps: unknown, cookies: readonly string[]): Response {
  const entetes = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) entetes.append("set-cookie", cookie);
  return new Response(JSON.stringify(corps), { status: statut, headers: entetes });
}

function postAvec(chemin: string, corps: unknown, entetes: Record<string, string>): Request {
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE, ...entetes },
    body: JSON.stringify(corps),
  });
}

describe("durée plancher de la connexion (T-07)", () => {
  function horloge(instants: number[]) {
    const attentes: number[] = [];
    let i = 0;
    const h: Horloge = {
      maintenant: () => instants[Math.min(i++, instants.length - 1)] ?? 0,
      attendre: async (ms) => {
        attentes.push(ms);
      },
    };
    return { h, attentes };
  }

  test.each([
    [
      "identifiants incorrects",
      avecCookies(401, { code: "INVALID_EMAIL_OR_PASSWORD" }, []),
      CONNEXION,
    ],
    ["compte non vérifié", avecCookies(403, { code: "EMAIL_NOT_VERIFIED" }, []), CONNEXION],
    ["succès", avecCookies(200, { token: "t" }, [COOKIE_SESSION]), CONNEXION],
    ["entrée invalide", Response.json({}), { ...CONNEXION, rememberMe: true }],
  ] as const)("%s, en 100 ms : retenue 700 ms de plus", async (_nom, reponse, corps) => {
    const { h, attentes } = horloge([1_000, 1_100]);
    const gerer = avec(reponse, h);
    await gerer(post("/sign-in/email", corps));
    expect(attentes).toEqual([700]);
  });

  test("limite par compte atteinte : retenue aussi", async () => {
    const { h, attentes } = horloge([1_000, 1_005]);
    const gerer = avec(Response.json({}), h, { limite: async () => false });
    const reponse = await gerer(post("/sign-in/email", CONNEXION));
    expect(reponse.status).toBe(429);
    expect(attentes).toEqual([795]);
  });

  test("déconnexion : aucune durée plancher", async () => {
    const { h, attentes } = horloge([1_000, 1_010]);
    const gerer = avec(avecCookies(200, { success: true }, [EFFACEMENT]), h);
    await gerer(post("/sign-out", {}));
    expect(attentes.filter((ms) => ms > 0)).toEqual([]);
  });
});

describe("déconnexion vérifiée côté serveur (T-03)", () => {
  test("session relue absente : { ok: true } et les cookies d'effacement de Better Auth", async () => {
    const relues: Headers[] = [];
    const gerer = avec(avecCookies(200, { success: true }, [EFFACEMENT]), IMMEDIATE, {
      sessionLisible: async (entetes) => {
        relues.push(entetes);
        return false;
      },
    });
    const reponse = await gerer(
      postAvec("/sign-out", {}, { cookie: "better-auth.session_token=jeton.signature" }),
    );
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    expect(reponse.headers.getSetCookie()).toEqual([EFFACEMENT]);
    // La relecture se fait avec le cookie reçu.
    expect(relues).toHaveLength(1);
    expect(relues[0]?.get("cookie")).toBe("better-auth.session_token=jeton.signature");
  });

  test.each([
    ["session encore lisible (suppression avalée par Better Auth)", async () => true],
    [
      "relecture en échec (base en panne)",
      async () => {
        throw new Error("Failed query: select ... params: jeton");
      },
    ],
  ] as const)("%s : erreur avec incident, cookie gardé", async (_nom, sessionLisible) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gerer = avec(avecCookies(200, { success: true }, [EFFACEMENT]), IMMEDIATE, {
      sessionLisible,
    });
    const reponse = await gerer(
      postAvec("/sign-out", {}, { cookie: "better-auth.session_token=jeton.signature" }),
    );
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  test("le cookie reçu n'est transmis à Better Auth que pour la déconnexion", async () => {
    const recues: Request[] = [];
    const reponse = avecCookies(200, { token: "t" }, [COOKIE_SESSION]);
    const gerer = creerTraitementAuth({
      traiter: async (requete) => {
        recues.push(requete);
        return reponse.clone();
      },
      origine: ORIGINE,
      estProduction: false,
      limiterCompte: async () => true,
      sessionEncoreLisible: async () => false,
      horloge: IMMEDIATE,
    });
    const cookie = { cookie: "better-auth.session_token=jeton.signature" };
    await gerer(postAvec("/sign-in/email", CONNEXION, cookie));
    await gerer(postAvec("/sign-up/email", INSCRIPTION, cookie));
    await gerer(postAvec("/sign-out", {}, cookie));
    expect(recues.map((r) => [new URL(r.url).pathname, r.headers.get("cookie")])).toEqual([
      ["/api/auth/sign-in/email", null],
      ["/api/auth/sign-up/email", null],
      ["/api/auth/sign-out", "better-auth.session_token=jeton.signature"],
    ]);
  });

  test("sans cookie : { ok: true } (rien à fermer)", async () => {
    const gerer = avec(avecCookies(200, { success: true }, [EFFACEMENT]));
    const reponse = await gerer(post("/sign-out", {}));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
  });
});

describe("identifiant d'incident dans toute réponse « erreur » (S-85, dette de PLAN.md)", () => {
  const CAS = [
    [
      "exception de Better Auth",
      "/sign-up/email",
      INSCRIPTION,
      () =>
        avec(async () => {
          throw new Error("Failed query");
        }),
    ],
    [
      "statut 500 de Better Auth",
      "/sign-up/email",
      INSCRIPTION,
      () => avec(Response.json({ code: "INTERNAL_SERVER_ERROR" }, { status: 500 })),
    ],
    [
      "renvoi, statut 5xx",
      "/send-verification-email",
      { email: INSCRIPTION.email },
      () => avec(Response.json({ code: "INTERNAL_SERVER_ERROR" }, { status: 502 })),
    ],
    [
      "vérification, statut 503",
      "/verify-email",
      { jeton: JETON },
      () => avec(new Response(null, { status: 503 })),
    ],
    [
      "limite par compte en échec",
      "/sign-in/email",
      CONNEXION,
      () =>
        avec(Response.json({}), IMMEDIATE, {
          limite: async () => {
            throw new Error("base en panne");
          },
        }),
    ],
    [
      "connexion, 200 inattendu",
      "/sign-in/email",
      CONNEXION,
      () => avec(avecCookies(200, { token: "t" }, [])),
    ],
    [
      "déconnexion non vérifiée",
      "/sign-out",
      {},
      () =>
        avec(avecCookies(200, { success: true }, [EFFACEMENT]), IMMEDIATE, {
          sessionLisible: async () => true,
        }),
    ],
  ] as const;

  test.each(CAS)(
    "%s : { ok: false, raison: erreur, incident }, égal à celui de l'unique ligne [auth]",
    async (_nom, chemin, corps, fabrique) => {
      const lignes: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
        lignes.push(valeurs.map(String).join(" "));
      });
      const reponse = await fabrique()(post(chemin, corps));
      expect(reponse.status).toBe(500);
      const lu = (await reponse.json()) as Record<string, unknown>;
      expect(Object.keys(lu).sort()).toEqual(["incident", "ok", "raison"]);
      expect(lu.ok).toBe(false);
      expect(lu.raison).toBe("erreur");
      expect(lu.incident).toMatch(UUID);
      expect(lignes).toEqual([
        `[auth] ${JSON.stringify({ niveau: "error", incident: lu.incident })}`,
      ]);
    },
  );

  test("deux erreurs : deux incidents différents", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gerer = avec(async () => {
      throw new Error("panne");
    });
    const a = (await (await gerer(post("/sign-up/email", INSCRIPTION))).json()) as {
      incident: string;
    };
    const b = (await (await gerer(post("/sign-up/email", INSCRIPTION))).json()) as {
      incident: string;
    };
    expect(a.incident).not.toBe(b.incident);
  });

  test("aucun autre refus ne porte d'incident", async () => {
    const gerer = avec(Response.json({ code: "PASSWORD_COMPROMISED" }, { status: 400 }));
    const reponse = await gerer(post("/sign-up/email", INSCRIPTION));
    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
  });
});
