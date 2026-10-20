import { afterEach, describe, expect, test, vi } from "vitest";

import {
  creerTraitementAuth,
  DUREE_PLANCHER_MS,
  jetonDeSession,
  type Horloge,
} from "./points-entree";
import { dependancesDoubleAuthInertes } from "../db/outils-test/double-auth";
import { dependancesProfilInertes } from "../db/outils-test/profil";

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
    revoquer?: (entetes: Headers) => Promise<void>;
    // 1.3 (docs/features/mot-de-passe.md, sections 3.3 et 5).
    limiteReinitialisation?: (adresse: string) => Promise<boolean>;
    jetonValide?: (jeton: string) => Promise<boolean>;
    compromis?: (motDePasse: string) => Promise<boolean>;
    traiter?: (requete: Request) => Promise<Response>;
  } = {},
) {
  const traiter =
    options.traiter ??
    vi.fn(async () => (typeof reponse === "function" ? reponse() : reponse.clone()));
  return creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: false,
    limiterCompte: options.limite ?? (async () => true),
    sessionEncoreLisible: options.sessionLisible ?? (async () => false),
    revoquerSession: options.revoquer ?? (async () => {}),
    limiterReinitialisation: options.limiteReinitialisation ?? (async () => true),
    jetonReinitialisationValide: options.jetonValide ?? (async () => true),
    motDePasseCompromis: options.compromis ?? (async () => false),
    // 1.4 : jamais atteintes par ces tests.
    doubleAuth: dependancesDoubleAuthInertes(),
    profil: dependancesProfilInertes(),
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
    [
      "session encore lisible (suppression avalée par Better Auth)",
      async (): Promise<boolean> => true,
    ],
    [
      "relecture en échec (base en panne)",
      async (): Promise<boolean> => {
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
      revoquerSession: async () => {},
      limiterReinitialisation: async () => true,
      jetonReinitialisationValide: async () => true,
      motDePasseCompromis: async () => false,
      // 1.4 : jamais atteintes par ces tests.
      doubleAuth: dependancesDoubleAuthInertes(),
      profil: dependancesProfilInertes(),
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

// Ajouté à l'implémentation, avec la relecture par l'adaptateur (section 4.2).
describe("jetonDeSession", () => {
  test.each([
    ["cookie signé", "better-auth.session_token=jeton.signature", "jeton"],
    ["encodé, parmi d'autres", "a=b; better-auth.session_token=je%2Bton.sig%3D; c=d", "je+ton"],
    ["absent", "a=b", null],
    ["sans signature", "better-auth.session_token=jeton", null],
    ["vide", "better-auth.session_token=", null],
    ["encodage invalide", "better-auth.session_token=%E0%A4%A.sig", null],
    ["autre nom qui le contient", "x-better-auth.session_token=jeton.sig", null],
  ] as const)("%s", (_nom, cookie, attendu) => {
    expect(jetonDeSession(cookie, "better-auth.session_token")).toBe(attendu);
  });

  test("aucun en-tête Cookie : null", () => {
    expect(jetonDeSession(null, "better-auth.session_token")).toBeNull();
  });
});

// Correctif de la 1.2 (constat sur la prévisualisation) : une connexion
// réussie révoque en base la session du cookie reçu ; Better Auth 1.7.7 ne le
// fait pas (signInEmail crée une session sans lire l'ancienne). Fiche :
// docs/features/connexion.md, section 4.3.
describe("connexion réussie : l'ancienne session est révoquée", () => {
  const ANCIEN = "better-auth.session_token=ancien.signature";

  test("révoquée avec les en-têtes reçus, après Better Auth, avant la réponse", async () => {
    const ordre: string[] = [];
    const recues: Headers[] = [];
    const gerer = avec(
      async () => {
        ordre.push("better-auth");
        return avecCookies(200, { token: "t" }, [COOKIE_SESSION]);
      },
      IMMEDIATE,
      {
        revoquer: async (entetes) => {
          ordre.push("revocation");
          recues.push(entetes);
        },
      },
    );
    const reponse = await gerer(postAvec("/sign-in/email", CONNEXION, { cookie: ANCIEN }));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.getSetCookie()).toEqual([COOKIE_SESSION]);
    expect(ordre).toEqual(["better-auth", "revocation"]);
    expect(recues[0]?.get("cookie")).toBe(ANCIEN);
  });

  test.each([
    ["identifiants incorrects", avecCookies(401, { code: "INVALID_EMAIL_OR_PASSWORD" }, [])],
    ["compte non vérifié", avecCookies(403, { code: "EMAIL_NOT_VERIFIED" }, [])],
    ["limite de Better Auth", avecCookies(429, {}, [])],
    ["200 sans cookie de session", avecCookies(200, { token: "t" }, [])],
  ] as const)("échec (%s) : rien n'est révoqué", async (_nom, reponse) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const revoquer = vi.fn(async () => {});
    const gerer = avec(reponse, IMMEDIATE, { revoquer });
    await gerer(postAvec("/sign-in/email", CONNEXION, { cookie: ANCIEN }));
    expect(revoquer).not.toHaveBeenCalled();
  });

  test("limite par compte atteinte, entrée invalide : rien n'est révoqué", async () => {
    const revoquer = vi.fn(async () => {});
    const limitee = avec(avecCookies(200, {}, [COOKIE_SESSION]), IMMEDIATE, {
      limite: async () => false,
      revoquer,
    });
    await limitee(postAvec("/sign-in/email", CONNEXION, { cookie: ANCIEN }));
    const invalide = avec(avecCookies(200, {}, [COOKIE_SESSION]), IMMEDIATE, { revoquer });
    await invalide(
      postAvec("/sign-in/email", { ...CONNEXION, rememberMe: true }, { cookie: ANCIEN }),
    );
    expect(revoquer).not.toHaveBeenCalled();
  });

  test("révocation en échec : erreur avec incident, aucun cookie transmis", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gerer = avec(avecCookies(200, { token: "t" }, [COOKIE_SESSION]), IMMEDIATE, {
      revoquer: async () => {
        throw new Error("base en panne");
      },
    });
    const reponse = await gerer(postAvec("/sign-in/email", CONNEXION, { cookie: ANCIEN }));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  // Modifié en 1.3 : /verify-email sort de la liste. Une vérification qui pose
  // un cookie de session révoque désormais l'ancienne session (report de la
  // 1.2, docs/features/mot-de-passe.md, section 8, test 9 plus bas).
  test.each(["/sign-up/email", "/send-verification-email", "/sign-out"])(
    "%s : la révocation de la connexion n'est jamais appelée",
    async (chemin) => {
      const revoquer = vi.fn(async () => {});
      const corps =
        chemin === "/sign-up/email"
          ? INSCRIPTION
          : chemin === "/send-verification-email"
            ? { email: INSCRIPTION.email }
            : chemin === "/verify-email"
              ? { jeton: JETON }
              : {};
      const gerer = avec(avecCookies(200, { status: true }, [COOKIE_SESSION]), IMMEDIATE, {
        revoquer,
      });
      await gerer(postAvec(chemin, corps, { cookie: ANCIEN }));
      expect(revoquer).not.toHaveBeenCalled();
    },
  );
});
// Fonctionnalité 1.3 : mot de passe oublié. Fiche :
// docs/features/mot-de-passe.md, sections 2.3, 3.3 et 8, tests 6 à 9.

const JETON_REINITIALISATION = "aB3dE5fG7hJ9kL1mN2pQ4rS6";
const DEMANDE = { email: "awa@exemple.invalid" };
const REINITIALISATION = {
  jeton: JETON_REINITIALISATION,
  motDePasse: "une-phrase-de-passe-neuve",
};

describe("réinitialisation : contrôles avant la consommation du jeton (section 3.3)", () => {
  function espions(options: { jetonValide?: boolean; compromis?: boolean | Error } = {}) {
    const ordre: string[] = [];
    const jetonValide = vi.fn(async (jeton: string) => {
      ordre.push(`jeton:${jeton}`);
      return options.jetonValide ?? true;
    });
    const compromis = vi.fn(async (motDePasse: string) => {
      ordre.push(`compromis:${motDePasse}`);
      if (options.compromis instanceof Error) throw options.compromis;
      return options.compromis ?? false;
    });
    const traiter = vi.fn(async () => {
      ordre.push("better-auth");
      return Response.json({ status: true });
    });
    return { ordre, jetonValide, compromis, traiter };
  }

  test("ordre : jeton connu, mot de passe compromis, puis Better Auth", async () => {
    const e = espions();
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
      traiter: e.traiter,
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    expect(e.ordre).toEqual([
      `jeton:${JETON_REINITIALISATION}`,
      "compromis:une-phrase-de-passe-neuve",
      "better-auth",
    ]);
  });

  test("mot de passe de 11 caractères : mot_de_passe_trop_court, rien d'autre n'est appelé (jeton intact)", async () => {
    const e = espions();
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
      traiter: e.traiter,
    });
    const reponse = await gerer(
      post("/reset-password", {
        ...REINITIALISATION,
        motDePasse: "a".repeat(11),
      }),
    );
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      ok: false,
      raison: "mot_de_passe_trop_court",
    });
    expect(e.ordre).toEqual([]);
  });

  test("jeton inconnu ou expiré : lien_invalide, Have I Been Pwned et Better Auth jamais appelés", async () => {
    const e = espions({ jetonValide: false });
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
      traiter: e.traiter,
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      ok: false,
      raison: "lien_invalide",
    });
    expect(e.compromis).not.toHaveBeenCalled();
    expect(e.traiter).not.toHaveBeenCalled();
  });

  test("mot de passe compromis : mot_de_passe_compromis, Better Auth jamais appelé (jeton intact)", async () => {
    const e = espions({ compromis: true });
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
      traiter: e.traiter,
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      ok: false,
      raison: "mot_de_passe_compromis",
    });
    expect(e.traiter).not.toHaveBeenCalled();
  });

  test("Have I Been Pwned en panne : erreur avec incident, Better Auth jamais appelé (jeton intact)", async () => {
    const lignes: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs.map(String).join(" "));
    });
    const e = espions({
      compromis: new Error("Failed to check password. Status: 503"),
    });
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
      traiter: e.traiter,
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(e.traiter).not.toHaveBeenCalled();
    expect(lignes.join("\n")).not.toContain("Failed to check");
    expect(lignes.join("\n")).not.toContain(REINITIALISATION.motDePasse);
  });

  test("lecture du jeton en panne : erreur avec incident, sans le jeton au journal", async () => {
    const lignes: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs.map(String).join(" "));
    });
    const traiter = vi.fn(async () => Response.json({ status: true }));
    const gerer = avec(Response.json({}), IMMEDIATE, {
      jetonValide: async () => {
        throw new Error(
          `Failed query: select ... params: reset-password:${JETON_REINITIALISATION}`,
        );
      },
      traiter,
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(500);
    expect(traiter).not.toHaveBeenCalled();
    expect(lignes.join("\n")).not.toContain(JETON_REINITIALISATION);
  });

  test("la demande n'appelle ni la lecture du jeton ni Have I Been Pwned", async () => {
    const e = espions();
    const gerer = avec(Response.json({ status: true }), IMMEDIATE, {
      jetonValide: e.jetonValide,
      compromis: e.compromis,
    });
    // Témoin : la demande atteint bien Better Auth.
    expect((await gerer(post("/request-password-reset", DEMANDE))).status).toBe(200);
    expect(e.jetonValide).not.toHaveBeenCalled();
    expect(e.compromis).not.toHaveBeenCalled();
  });
});

describe("réinitialisation : traduction des réponses de Better Auth (section 2.3)", () => {
  test("200 : { ok: true }, sans cookie", async () => {
    const gerer = avec(avecCookies(200, { status: true }, [COOKIE_SESSION]));
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  test.each([
    [400, "INVALID_TOKEN", 400, "lien_invalide"],
    [400, "USER_NOT_FOUND", 400, "lien_invalide"],
    [400, "PASSWORD_TOO_SHORT", 400, "mot_de_passe_trop_court"],
    [400, "PASSWORD_COMPROMISED", 400, "mot_de_passe_compromis"],
    [400, "PASSWORD_TOO_LONG", 400, "invalide"],
  ] as const)(
    "Better Auth %s %s : %s %s, sans son message",
    async (statut, code, attendu, raison) => {
      const gerer = avec(erreurBetterAuth(statut, code));
      const reponse = await gerer(post("/reset-password", REINITIALISATION));
      expect(reponse.status).toBe(attendu);
      const texte = await reponse.text();
      expect(texte).toBe(JSON.stringify({ ok: false, raison }));
      expect(texte).not.toContain("Message de Better Auth");
    },
  );

  test("429 : trop_de_requetes, sans X-Retry-After", async () => {
    const gerer = avec(new Response("{}", { status: 429, headers: { "X-Retry-After": "900" } }));
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({
      ok: false,
      raison: "trop_de_requetes",
    });
    expect(reponse.headers.get("x-retry-after")).toBeNull();
  });

  test.each([500, 503])("%s : erreur avec incident", async (statut) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gerer = avec(Response.json({ code: "INTERNAL_SERVER_ERROR" }, { status: statut }));
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
  });

  test.each([
    [200, { status: true }, 200, { ok: true }],
    [429, {}, 429, { ok: false, raison: "trop_de_requetes" }],
    [400, { code: "INVALID_EMAIL" }, 400, { ok: false, raison: "invalide" }],
  ] as const)("demande, Better Auth %s : %s", async (statut, corps, attendu, reponseAttendue) => {
    const gerer = avec(avecCookies(statut, corps, []));
    const reponse = await gerer(post("/request-password-reset", DEMANDE));
    expect(reponse.status).toBe(attendu);
    expect(await reponse.json()).toEqual(reponseAttendue);
  });
});

describe("durée plancher de la demande (T-07)", () => {
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
    ["succès", Response.json({ status: true }), DEMANDE, {}],
    ["entrée invalide", Response.json({}), { ...DEMANDE, redirectTo: "/" }, {}],
    [
      "limite par adresse email atteinte",
      Response.json({}),
      DEMANDE,
      { limiteReinitialisation: async () => false },
    ],
    ["limite de Better Auth", avecCookies(429, {}, []), DEMANDE, {}],
  ] as const)("%s, en 100 ms : retenue 700 ms de plus", async (_nom, reponse, corps, options) => {
    const { h, attentes } = horloge([1_000, 1_100]);
    const gerer = avec(reponse, h, options);
    await gerer(post("/request-password-reset", corps));
    expect(attentes).toEqual([700]);
  });

  test("réinitialisation : aucune durée plancher (aucune existence de compte à cacher)", async () => {
    const { h, attentes } = horloge([1_000, 1_010]);
    const gerer = avec(Response.json({ status: true }), h);
    expect((await gerer(post("/reset-password", REINITIALISATION))).status).toBe(200);
    expect(attentes.filter((ms) => ms > 0)).toEqual([]);
  });
});

// Report de la 1.2 (docs/features/connexion.md, « Limites connues ») :
// une vérification d'adresse qui ouvre une session révoque celle du cookie
// reçu. Fiche : docs/features/mot-de-passe.md, section 8, test 9.
describe("vérification réussie : l'ancienne session est révoquée", () => {
  const ANCIEN = "better-auth.session_token=ancien.signature";

  test("nouveau cookie de session : révoquée avec les en-têtes reçus, après Better Auth", async () => {
    const ordre: string[] = [];
    const recues: Headers[] = [];
    const gerer = avec(
      async () => {
        ordre.push("better-auth");
        return avecCookies(200, { status: true }, [COOKIE_SESSION]);
      },
      IMMEDIATE,
      {
        revoquer: async (entetes) => {
          ordre.push("revocation");
          recues.push(entetes);
        },
      },
    );
    const reponse = await gerer(postAvec("/verify-email", { jeton: JETON }, { cookie: ANCIEN }));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.getSetCookie()).toEqual([COOKIE_SESSION]);
    expect(ordre).toEqual(["better-auth", "revocation"]);
    expect(recues[0]?.get("cookie")).toBe(ANCIEN);
  });

  test.each([
    ["lien déjà utilisé, aucun nouveau cookie", avecCookies(200, { status: true }, [])],
    [
      "seul un autre cookie",
      avecCookies(200, { status: true }, ["better-auth.dont_remember=x; Path=/"]),
    ],
    ["lien refusé", avecCookies(401, { code: "TOKEN_EXPIRED" }, [])],
    ["limite de Better Auth", avecCookies(429, {}, [])],
  ] as const)("%s : rien n'est révoqué", async (_nom, reponse) => {
    const revoquer = vi.fn(async () => {});
    const gerer = avec(reponse, IMMEDIATE, { revoquer });
    await gerer(postAvec("/verify-email", { jeton: JETON }, { cookie: ANCIEN }));
    expect(revoquer).not.toHaveBeenCalled();
  });

  test("révocation en échec : erreur avec incident, aucun cookie transmis", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gerer = avec(avecCookies(200, { status: true }, [COOKIE_SESSION]), IMMEDIATE, {
      revoquer: async () => {
        throw new Error("base en panne");
      },
    });
    const reponse = await gerer(postAvec("/verify-email", { jeton: JETON }, { cookie: ANCIEN }));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  test.each(["/request-password-reset", "/reset-password"])(
    "%s : aucune révocation",
    async (chemin) => {
      const revoquer = vi.fn(async () => {});
      const gerer = avec(avecCookies(200, { status: true }, [COOKIE_SESSION]), IMMEDIATE, {
        revoquer,
      });
      const reponse = await gerer(
        postAvec(chemin, chemin === "/reset-password" ? REINITIALISATION : DEMANDE, {
          cookie: ANCIEN,
        }),
      );
      // Témoin : le point est ouvert et réussit.
      expect(reponse.status).toBe(200);
      expect(revoquer).not.toHaveBeenCalled();
    },
  );
});
