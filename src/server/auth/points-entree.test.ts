import { afterEach, describe, expect, test, vi } from "vitest";

import { creerTraitementAuth, DUREE_PLANCHER_MS, type Horloge } from "./points-entree";

// Le gestionnaire des points d'entrée ouverts : réponses de Better Auth
// traduites en une liste fermée, erreurs attrapées, durée plancher (T-07).
// Fiche : docs/features/inscription.md, sections 2.2 et 4.4.

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

function avec(reponse: Response | (() => Promise<Response>), horloge: Horloge = IMMEDIATE) {
  const traiter = vi.fn(async () => (typeof reponse === "function" ? reponse() : reponse.clone()));
  return creerTraitementAuth({ traiter, origine: ORIGINE, estProduction: false, horloge });
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
    [500, "INTERNAL_SERVER_ERROR", 500, "erreur"],
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
    expect(await reponse.json()).toEqual({ ok: false, raison: "erreur" });
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
