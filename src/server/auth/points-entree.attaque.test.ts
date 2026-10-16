import { describe, expect, test, vi } from "vitest";

import { auth } from "./config";
import {
  COMPTES_OUVERTS_EN_PRODUCTION,
  creerTraitementAuth,
  POINTS_ENTREE_OUVERTS,
  reponseInexistante,
} from "./points-entree";

// Tests d'attaque de la liste fermée des points d'entrée de /api/auth : T-55
// (points d'entrée natifs fermés), S-81 (origine), entrée falsifiée,
// inscription fermée en production (décision 1), jeton de vérification
// jamais dans l'adresse reçue (décision 3). Better Auth est remplacé par un
// espion : un point d'entrée fermé ne doit jamais l'atteindre. Fiche :
// docs/features/inscription.md, sections 2 et 4.3. Connexion et déconnexion
// (1.2) : réponse unique pour les trois échecs (T-07), corps de Better Auth
// jamais transmis (S-82), limite par compte, comptes fermés en production.
// Fiche : docs/features/connexion.md, tests 1 à 6.

// config.ts charge env.ts : valeurs factices, base sur un port fermé (aucune
// connexion n'est ouverte : seul auth.api est lu).
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
const BASE = `${ORIGINE}/api/auth`;
const JETON =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U";

const CORPS_VALIDES: Readonly<Record<string, unknown>> = {
  "/sign-up/email": {
    nom: "Awa Koné",
    email: "awa@exemple.invalid",
    motDePasse: "une-phrase-de-passe-solide",
  },
  "/send-verification-email": { email: "awa@exemple.invalid" },
  "/verify-email": { jeton: JETON },
  "/sign-in/email": { email: "awa@exemple.invalid", motDePasse: "une-phrase-de-passe-solide" },
  "/sign-out": {},
};

const COOKIE_SESSION = "better-auth.session_token=jeton.signature; Path=/; HttpOnly; SameSite=Lax";

// Réponse de Better Auth par défaut : un succès qui pose le cookie de session
// (exigé par la connexion ; ignoré par l'inscription et le renvoi).
function succes(): Response {
  return new Response(JSON.stringify({ status: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": COOKIE_SESSION },
  });
}

function espion(reponse: () => Response = succes) {
  return vi.fn<(requete: Request) => Promise<Response>>(async () => reponse());
}

function traitement(
  options: {
    estProduction?: boolean;
    reponse?: () => Response;
    limite?: () => Promise<boolean>;
    sessionLisible?: () => Promise<boolean>;
  } = {},
) {
  const traiter = espion(options.reponse);
  const limiterCompte = vi.fn<(adresse: string) => Promise<boolean>>(
    options.limite ?? (async () => true),
  );
  const sessionEncoreLisible = vi.fn<(entetes: Headers) => Promise<boolean>>(
    options.sessionLisible ?? (async () => false),
  );
  // Correctif de la 1.2 : révocation de l'ancienne session à la connexion.
  const revoquerSession = vi.fn<(entetes: Headers) => Promise<void>>(async () => {});
  const gerer = creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: options.estProduction ?? false,
    limiterCompte,
    sessionEncoreLisible,
    revoquerSession,
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
  return { traiter, gerer, limiterCompte, sessionEncoreLisible, revoquerSession };
}

function requete(
  methode: "GET" | "POST",
  chemin: string,
  options: { corps?: string; entetes?: Record<string, string> } = {},
): Request {
  return new Request(`${BASE}${chemin}`, {
    method: methode,
    headers:
      options.entetes ??
      (methode === "POST" ? { "content-type": "application/json", origin: ORIGINE } : {}),
    ...(methode === "POST" ? { body: options.corps ?? "{}" } : {}),
  });
}

function post(chemin: string, corps: unknown, entetes?: Record<string, string>): Request {
  return requete("POST", chemin, { corps: JSON.stringify(corps), ...(entetes ? { entetes } : {}) });
}

// Statut, texte du statut, en-têtes et octets du corps.
async function empreinte(reponse: Response) {
  return {
    statut: reponse.status,
    texte: reponse.statusText,
    entetes: [...reponse.headers.entries()],
    corps: Buffer.from(await reponse.arrayBuffer()).toString("hex"),
  };
}

async function inexistante() {
  const { gerer } = traitement();
  return empreinte(await gerer(requete("GET", "/n-existe-pas")));
}

// Les points d'entrée déclarés par l'instance : chemin de chacun, paramètres
// remplacés par une valeur quelconque.
function cheminsDeclares(): string[] {
  const chemins = new Set<string>();
  for (const point of Object.values(auth.api) as { path?: unknown }[]) {
    if (typeof point.path !== "string") continue;
    chemins.add(point.path.replaceAll(/:[A-Za-z]+/gu, "x"));
  }
  return [...chemins].sort();
}

const OUVERTS = Object.keys(POINTS_ENTREE_OUVERTS).sort();

describe("T-55 : liste fermée des points d'entrée", () => {
  test("les points d'entrée ouverts sont exactement les cinq des fiches 1.1 et 1.2, en POST", () => {
    expect(OUVERTS).toEqual([
      "/send-verification-email",
      "/sign-in/email",
      "/sign-out",
      "/sign-up/email",
      "/verify-email",
    ]);
    for (const point of Object.values(POINTS_ENTREE_OUVERTS)) expect(point.methode).toBe("POST");
  });

  test("chaque point d'entrée ouvert existe dans l'instance de Better Auth", () => {
    const declares = cheminsDeclares();
    for (const chemin of OUVERTS) expect(declares, chemin).toContain(chemin);
  });

  test("la réponse d'un chemin inexistant est reponseInexistante(), octet pour octet", async () => {
    expect(await inexistante()).toEqual(await empreinte(reponseInexistante()));
  });

  test("le module organisation déclare des points d'entrée (le parcours suivant n'est pas vide)", () => {
    expect(
      cheminsDeclares().filter((chemin) => chemin.startsWith("/organization/")).length,
    ).toBeGreaterThan(10);
  });

  test("chaque point d'entrée déclaré, en GET et en POST, hors des cinq ouverts : réponse inexistante, Better Auth jamais appelé", async () => {
    const attendue = await inexistante();
    const { traiter, gerer } = traitement();
    const fautifs: string[] = [];
    for (const chemin of cheminsDeclares()) {
      for (const methode of ["GET", "POST"] as const) {
        if (methode === "POST" && OUVERTS.includes(chemin)) continue;
        const recue = await empreinte(await gerer(requete(methode, chemin)));
        if (JSON.stringify(recue) !== JSON.stringify(attendue))
          fautifs.push(`${methode} ${chemin}`);
      }
    }
    expect(fautifs).toEqual([]);
    expect(traiter).not.toHaveBeenCalled();
  });

  test.each([
    ["GET d'un chemin ouvert", "GET", "/sign-up/email"],
    ["barre finale", "POST", "/sign-up/email/"],
    ["barre encodée", "POST", "/sign-up%2Femail"],
    ["majuscules", "POST", "/Sign-Up/Email"],
    ["chemin vide", "POST", ""],
    ["racine", "POST", "/"],
    ["remontée vers un chemin fermé", "POST", "/organization/../organization/update-member-role"],
    ["mise à jour d'un rôle", "POST", "/organization/update-member-role"],
    ["retrait d'un membre", "POST", "/organization/remove-member"],
    ["invitation", "POST", "/organization/invite-member"],
    ["connexion par un réseau social", "POST", "/sign-in/social"],
    ["lecture de session", "GET", "/get-session"],
  ] as const)("%s : réponse inexistante", async (_nom, methode, chemin) => {
    const attendue = await inexistante();
    const { traiter, gerer } = traitement();
    const corps = CORPS_VALIDES["/sign-up/email"];
    const recue =
      methode === "POST" ? await gerer(post(chemin, corps)) : await gerer(requete("GET", chemin));
    expect(await empreinte(recue)).toEqual(attendue);
    expect(traiter).not.toHaveBeenCalled();
  });

  test("hors de /api/auth : réponse inexistante", async () => {
    const attendue = await inexistante();
    const { traiter, gerer } = traitement();
    const recue = await gerer(
      new Request(`${ORIGINE}/api/autre/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGINE },
        body: JSON.stringify(CORPS_VALIDES["/sign-up/email"]),
      }),
    );
    expect(await empreinte(recue)).toEqual(attendue);
    expect(traiter).not.toHaveBeenCalled();
  });
});

describe("S-81 : origine des POST", () => {
  const CAS = [
    ["Origin absente", { "content-type": "application/json" }],
    [
      "Origin étrangère",
      { "content-type": "application/json", origin: "https://attaquant.exemple" },
    ],
    ["Origin null", { "content-type": "application/json", origin: "null" }],
    [
      "Origin avec un autre port",
      { "content-type": "application/json", origin: "http://localhost:3001" },
    ],
    [
      "Sec-Fetch-Site cross-site",
      { "content-type": "application/json", origin: ORIGINE, "sec-fetch-site": "cross-site" },
    ],
  ] as const;

  test.each(
    OUVERTS.flatMap((chemin) => CAS.map(([nom, entetes]) => [chemin, nom, entetes] as const)),
  )("%s, %s : 403, Better Auth jamais appelé", async (chemin, _nom, entetes) => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(post(chemin, CORPS_VALIDES[chemin], { ...entetes }));
    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toEqual({ ok: false, raison: "refuse" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test("témoin : même origine, transmis à Better Auth", async () => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(post("/sign-up/email", CORPS_VALIDES["/sign-up/email"]));
    expect(reponse.status).toBe(200);
    expect(traiter).toHaveBeenCalledTimes(1);
  });
});

describe("entrée falsifiée : refusée avant Better Auth", () => {
  const INSCRIPTION = CORPS_VALIDES["/sign-up/email"] as Record<string, unknown>;

  test.each([
    [
      "type text/plain",
      "/sign-up/email",
      JSON.stringify(INSCRIPTION),
      { "content-type": "text/plain", origin: ORIGINE },
    ],
    [
      "formulaire encodé",
      "/sign-up/email",
      "nom=a&email=b&motDePasse=c",
      { "content-type": "application/x-www-form-urlencoded", origin: ORIGINE },
    ],
    ["JSON invalide", "/sign-up/email", "{ nom: ", undefined],
    ["tableau", "/sign-up/email", "[]", undefined],
    [
      "champ image",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, image: "https://attaquant.exemple/x.png" }),
      undefined,
    ],
    [
      "champ callbackURL",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, callbackURL: "https://attaquant.exemple" }),
      undefined,
    ],
    [
      "champ rememberMe",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, rememberMe: false }),
      undefined,
    ],
    [
      "champ inconnu",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, role: "proprietaire" }),
      undefined,
    ],
    [
      "noms de champs de Better Auth",
      "/sign-up/email",
      JSON.stringify({
        name: "a",
        email: "a@exemple.invalid",
        password: "une-phrase-de-passe-solide",
      }),
      undefined,
    ],
    ["nom vide", "/sign-up/email", JSON.stringify({ ...INSCRIPTION, nom: "   " }), undefined],
    [
      "nom avec retour à la ligne",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, nom: "Awa\nBcc: x" }),
      undefined,
    ],
    [
      "nom trop long",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, nom: "a".repeat(101) }),
      undefined,
    ],
    [
      "adresse avec retour à la ligne",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, email: "awa@exemple.invalid\r\nBcc: x@exemple.invalid" }),
      undefined,
    ],
    [
      "adresse avec chevrons",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, email: "Awa <awa@exemple.invalid>" }),
      undefined,
    ],
    [
      "deux adresses",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, email: "a@exemple.invalid,b@exemple.invalid" }),
      undefined,
    ],
    [
      "mot de passe trop long",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, motDePasse: "a".repeat(129) }),
      undefined,
    ],
    [
      "mot de passe non textuel",
      "/sign-up/email",
      JSON.stringify({ ...INSCRIPTION, motDePasse: 123456789012 }),
      undefined,
    ],
    [
      "renvoi : champ en trop",
      "/send-verification-email",
      JSON.stringify({ email: "a@exemple.invalid", callbackURL: "/" }),
      undefined,
    ],
    [
      "renvoi : adresse invalide",
      "/send-verification-email",
      JSON.stringify({ email: "pas une adresse" }),
      undefined,
    ],
    [
      "vérification : jeton hors format",
      "/verify-email",
      JSON.stringify({ jeton: "abc" }),
      undefined,
    ],
    [
      "vérification : jeton avec retour à la ligne",
      "/verify-email",
      JSON.stringify({ jeton: `${JETON}\n` }),
      undefined,
    ],
    [
      "vérification : jeton trop long",
      "/verify-email",
      JSON.stringify({ jeton: `${"a".repeat(600)}.${"b".repeat(300)}.${"c".repeat(200)}` }),
      undefined,
    ],
    [
      "vérification : champ token de Better Auth",
      "/verify-email",
      JSON.stringify({ token: JETON }),
      undefined,
    ],
  ] as const)("%s : 400 invalide", async (_nom, chemin, corps, entetes) => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(
      requete("POST", chemin, { corps, ...(entetes ? { entetes: { ...entetes } } : {}) }),
    );
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "invalide" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test("corps de plus de 4 Kio : 400 invalide", async () => {
    const { traiter, gerer } = traitement();
    const corps = JSON.stringify(INSCRIPTION);
    // Des espaces avant l'accolade finale : un JSON valide, de 4 097 octets.
    const lourd = `${corps.slice(0, -1)}${" ".repeat(4097 - Buffer.byteLength(corps))}}`;
    expect(Buffer.byteLength(lourd)).toBe(4097);
    const reponse = await gerer(requete("POST", "/sign-up/email", { corps: lourd }));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "invalide" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test("témoin : corps de 4 Kio exactement, accepté", async () => {
    const { traiter, gerer } = traitement();
    const corps = JSON.stringify(INSCRIPTION);
    const juste = `${corps.slice(0, -1)}${" ".repeat(4096 - Buffer.byteLength(corps))}}`;
    expect(Buffer.byteLength(juste)).toBe(4096);
    const reponse = await gerer(requete("POST", "/sign-up/email", { corps: juste }));
    expect(reponse.status).toBe(200);
    expect(traiter).toHaveBeenCalledTimes(1);
  });

  test("mot de passe de 11 caractères : mot_de_passe_trop_court, avant Better Auth", async () => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(
      post("/sign-up/email", { ...INSCRIPTION, motDePasse: "a".repeat(11) }),
    );
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_trop_court" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test("seuls les champs validés parviennent à Better Auth, sous ses noms", async () => {
    const { traiter, gerer } = traitement();
    await gerer(post("/sign-up/email", INSCRIPTION));
    const transmise = traiter.mock.calls[0]?.[0];
    expect(transmise).toBeInstanceOf(Request);
    expect(await transmise?.json()).toEqual({
      name: "Awa Koné",
      email: "awa@exemple.invalid",
      password: "une-phrase-de-passe-solide",
    });
  });
});

describe("décision 1 : comptes fermés en production (inscription 1.1, connexion 1.2)", () => {
  test("la constante est à false jusqu'à la 1.3", () => {
    expect(COMPTES_OUVERTS_EN_PRODUCTION).toBe(false);
  });

  test.each(OUVERTS)(
    "production, %s avec un corps valide : réponse inexistante, octet pour octet, Better Auth jamais appelé",
    async (chemin) => {
      const attendue = await inexistante();
      const { traiter, gerer } = traitement({ estProduction: true });
      const recue = await gerer(post(chemin, CORPS_VALIDES[chemin]));
      expect(await empreinte(recue)).toEqual(attendue);
      expect(traiter).not.toHaveBeenCalled();
    },
  );

  test("production : même réponse qu'un point d'entrée fermé (organisation)", async () => {
    const { gerer } = traitement({ estProduction: true });
    const fermee = await empreinte(await gerer(post("/organization/update-member-role", {})));
    const inscription = await empreinte(
      await gerer(post("/sign-up/email", CORPS_VALIDES["/sign-up/email"])),
    );
    expect(inscription).toEqual(fermee);
  });

  test.each(OUVERTS)("témoin hors production, %s : transmis à Better Auth", async (chemin) => {
    const { traiter, gerer } = traitement({ estProduction: false });
    const reponse = await gerer(post(chemin, CORPS_VALIDES[chemin]));
    expect(reponse.status).toBe(200);
    expect(traiter).toHaveBeenCalledTimes(1);
  });
});

describe("décision 3 : le jeton de vérification n'est jamais dans une adresse reçue", () => {
  test("GET /verify-email?token=<jeton valide> : réponse inexistante, Better Auth jamais appelé", async () => {
    const attendue = await inexistante();
    const { traiter, gerer } = traitement();
    const recue = await gerer(requete("GET", `/verify-email?token=${JETON}&callbackURL=%2F`));
    expect(await empreinte(recue)).toEqual(attendue);
    expect(traiter).not.toHaveBeenCalled();
  });

  test("POST /verify-email avec le jeton dans l'adresse plutôt que le corps : refusé", async () => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(requete("POST", `/verify-email?token=${JETON}`, { corps: "{}" }));
    expect(reponse.status).toBe(400);
    expect(traiter).not.toHaveBeenCalled();
  });

  test("POST /verify-email, jeton dans le corps : Better Auth reçoit un appel interne, sans callbackURL", async () => {
    const { traiter, gerer } = traitement();
    const reponse = await gerer(
      post(
        "/verify-email",
        { jeton: JETON },
        {
          "content-type": "application/json",
          origin: ORIGINE,
          "x-forwarded-for": "203.0.113.9",
          cookie: "better-auth.session_token=autre",
        },
      ),
    );
    expect(reponse.status).toBe(200);
    const interne = traiter.mock.calls[0]?.[0];
    if (!interne) throw new Error("Better Auth non appelé");
    const adresse = new URL(interne.url);
    expect(interne.method).toBe("GET");
    expect(adresse.pathname).toBe("/api/auth/verify-email");
    expect([...adresse.searchParams.keys()]).toEqual(["token"]);
    expect(adresse.searchParams.get("token")).toBe(JETON);
    // L'adresse IP suit, pour la limite auth.verification ; le cookie non.
    expect(interne.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(interne.headers.get("cookie")).toBeNull();
  });
});

// Fonctionnalité 1.2 : connexion et déconnexion. Fiche :
// docs/features/connexion.md, sections 1 à 3, tests 1 à 6.

const CONNEXION = CORPS_VALIDES["/sign-in/email"] as Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function reponseBetterAuth(statut: number, corps: unknown, cookies: readonly string[] = []) {
  return () => {
    const entetes = new Headers({ "content-type": "application/json" });
    for (const cookie of cookies) entetes.append("set-cookie", cookie);
    return new Response(JSON.stringify(corps), { status: statut, headers: entetes });
  };
}

describe("T-55 et S-82 (1.2) : ce qui reste fermé", () => {
  test.each([
    ["lecture de session, GET", "GET", "/get-session"],
    ["lecture de session, POST", "POST", "/get-session"],
    ["connexion par un réseau social", "POST", "/sign-in/social"],
    ["GET de la connexion", "GET", "/sign-in/email"],
    ["GET de la déconnexion", "GET", "/sign-out"],
    ["liste des sessions (1.5)", "GET", "/list-sessions"],
    ["révocation d'une session (1.5)", "POST", "/revoke-session"],
    ["révocation des autres sessions (1.5)", "POST", "/revoke-other-sessions"],
    ["mise à jour de la session", "POST", "/update-session"],
  ] as const)(
    "%s : réponse inexistante, Better Auth jamais appelé",
    async (_nom, methode, chemin) => {
      const attendue = await inexistante();
      const { traiter, gerer, limiterCompte } = traitement();
      const recue =
        methode === "POST" ? await gerer(post(chemin, {})) : await gerer(requete("GET", chemin));
      expect(await empreinte(recue)).toEqual(attendue);
      expect(traiter).not.toHaveBeenCalled();
      expect(limiterCompte).not.toHaveBeenCalled();
    },
  );
});

describe("T-07 : une seule réponse pour les échecs de la connexion", () => {
  const ECHECS = [
    ["adresse inconnue ou mauvais mot de passe", 401, { code: "INVALID_EMAIL_OR_PASSWORD" }],
    ["compte non vérifié, bon mot de passe", 403, { code: "EMAIL_NOT_VERIFIED" }],
    ["refus sans code", 401, {}],
    ["adresse refusée par Better Auth", 400, { code: "INVALID_EMAIL" }],
  ] as const;

  test.each(ECHECS)(
    "%s : 401 identifiants_incorrects, sans cookie ni message de Better Auth",
    async (_nom, statut, corps) => {
      const { gerer } = traitement({
        // Un Set-Cookie sur un refus n'est jamais transmis.
        reponse: reponseBetterAuth(statut, { ...corps, message: "Message de Better Auth" }, [
          COOKIE_SESSION,
        ]),
      });
      const reponse = await gerer(post("/sign-in/email", CONNEXION));
      expect(reponse.status).toBe(401);
      expect(await reponse.text()).toBe(
        JSON.stringify({ ok: false, raison: "identifiants_incorrects" }),
      );
      expect(reponse.headers.getSetCookie()).toEqual([]);
    },
  );

  test("les quatre échecs : même statut, mêmes en-têtes, mêmes octets", async () => {
    const empreintes = [];
    for (const [, statut, corps] of ECHECS) {
      const { gerer } = traitement({ reponse: reponseBetterAuth(statut, corps) });
      empreintes.push(await empreinte(await gerer(post("/sign-in/email", CONNEXION))));
    }
    for (const recue of empreintes) expect(recue).toEqual(empreintes[0]);
  });
});

describe("S-82 : le corps de la connexion n'est jamais transmis", () => {
  test("succès : exactement { ok: true } et le cookie de session, sans jeton ni utilisateur", async () => {
    const { gerer } = traitement({
      reponse: reponseBetterAuth(
        200,
        {
          redirect: false,
          token: "jeton-de-session-en-clair",
          user: { id: "u1", email: "awa@exemple.invalid" },
        },
        [COOKIE_SESSION],
      ),
    });
    const reponse = await gerer(post("/sign-in/email", CONNEXION));
    expect(reponse.status).toBe(200);
    const texte = await reponse.text();
    expect(texte).toBe(JSON.stringify({ ok: true }));
    expect(texte).not.toContain("jeton-de-session-en-clair");
    expect(reponse.headers.getSetCookie()).toEqual([COOKIE_SESSION]);
  });

  test.each([
    ["200 sans cookie de session", reponseBetterAuth(200, { token: "t" })],
    [
      "200 avec un autre cookie seulement",
      reponseBetterAuth(200, { token: "t" }, ["better-auth.dont_remember=x; Path=/"]),
    ],
    [
      "200 avec un cookie de session vide",
      reponseBetterAuth(200, { token: "t" }, ["better-auth.session_token=; Max-Age=0; Path=/"]),
    ],
    [
      "200 avec twoFactorRedirect (1.4)",
      reponseBetterAuth(200, { twoFactorRedirect: true }, [
        COOKIE_SESSION,
        "better-auth.two_factor=x; Path=/",
      ]),
    ],
  ] as const)("%s : erreur avec incident, aucun cookie", async (_nom, reponse) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer } = traitement({ reponse });
    const recue = await gerer(post("/sign-in/email", CONNEXION));
    expect(recue.status).toBe(500);
    const corps = (await recue.json()) as Record<string, unknown>;
    expect(Object.keys(corps).sort()).toEqual(["incident", "ok", "raison"]);
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(recue.headers.getSetCookie()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("entrée falsifiée : connexion et déconnexion, refusées avant Better Auth", () => {
  test.each([
    ["rememberMe", "/sign-in/email", { ...CONNEXION, rememberMe: false }],
    ["callbackURL", "/sign-in/email", { ...CONNEXION, callbackURL: "https://attaquant.exemple" }],
    ["champ inconnu", "/sign-in/email", { ...CONNEXION, role: "proprietaire" }],
    [
      "noms de champs de Better Auth",
      "/sign-in/email",
      { email: "awa@exemple.invalid", password: "une-phrase-de-passe-solide" },
    ],
    [
      "mot de passe de 129 caractères",
      "/sign-in/email",
      { ...CONNEXION, motDePasse: "a".repeat(129) },
    ],
    ["mot de passe vide", "/sign-in/email", { ...CONNEXION, motDePasse: "" }],
    ["mot de passe non textuel", "/sign-in/email", { ...CONNEXION, motDePasse: 12 }],
    [
      "adresse hors de la règle de la porte",
      "/sign-in/email",
      { ...CONNEXION, email: "Awa <awa@exemple.invalid>" },
    ],
    [
      "adresse avec retour à la ligne",
      "/sign-in/email",
      { ...CONNEXION, email: "awa@exemple.invalid\r\nBcc: x@exemple.invalid" },
    ],
    ["adresse absente", "/sign-in/email", { motDePasse: "une-phrase-de-passe-solide" }],
    ["déconnexion avec un champ", "/sign-out", { callbackURL: "https://attaquant.exemple" }],
    ["déconnexion avec null", "/sign-out", null],
  ] as const)(
    "%s : 400 invalide, ni Better Auth ni la limite par compte",
    async (_nom, chemin, corps) => {
      const { traiter, gerer, limiterCompte } = traitement();
      const reponse = await gerer(post(chemin, corps));
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ ok: false, raison: "invalide" });
      expect(traiter).not.toHaveBeenCalled();
      expect(limiterCompte).not.toHaveBeenCalled();
    },
  );

  test.each(["/sign-in/email", "/sign-out"])(
    "%s : données dans l'adresse, autre type que JSON, ou corps de plus de 4 Kio : refusés",
    async (chemin) => {
      const { traiter, gerer } = traitement();
      const corps = JSON.stringify(CORPS_VALIDES[chemin]);
      const lourd = `${corps.slice(0, -1)}${" ".repeat(4097 - Buffer.byteLength(corps))}}`;
      for (const recue of [
        await gerer(requete("POST", `${chemin}?callbackURL=%2F`, { corps })),
        await gerer(
          requete("POST", chemin, {
            corps,
            entetes: { "content-type": "text/plain", origin: ORIGINE },
          }),
        ),
        await gerer(requete("POST", chemin, { corps: lourd })),
      ]) {
        expect(recue.status).toBe(400);
      }
      expect(traiter).not.toHaveBeenCalled();
    },
  );

  test("seuls l'adresse et le mot de passe parviennent à Better Auth, sous ses noms, sans cookie", async () => {
    const { traiter, gerer } = traitement();
    await gerer(
      post("/sign-in/email", CONNEXION, {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.session_token=ancienne",
        "x-forwarded-for": "203.0.113.9",
      }),
    );
    const interne = traiter.mock.calls[0]?.[0];
    if (!interne) throw new Error("Better Auth non appelé");
    expect(interne.method).toBe("POST");
    expect(new URL(interne.url).pathname).toBe("/api/auth/sign-in/email");
    expect(new URL(interne.url).search).toBe("");
    expect(await interne.json()).toEqual({
      email: "awa@exemple.invalid",
      password: "une-phrase-de-passe-solide",
    });
    expect(interne.headers.get("cookie")).toBeNull();
    expect(interne.headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });
});

describe("limite par compte (S-11, T-01) : auth.connexion_compte", () => {
  test("appelée une fois avec l'adresse validée, avant Better Auth", async () => {
    const { traiter, gerer, limiterCompte } = traitement();
    await gerer(post("/sign-in/email", CONNEXION));
    expect(limiterCompte).toHaveBeenCalledTimes(1);
    expect(limiterCompte).toHaveBeenCalledWith("awa@exemple.invalid");
    expect(traiter).toHaveBeenCalledTimes(1);
    expect(limiterCompte.mock.invocationCallOrder[0]).toBeLessThan(
      traiter.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("limite atteinte : 429 trop_de_requetes, Better Auth jamais appelé", async () => {
    const { traiter, gerer } = traitement({ limite: async () => false });
    const reponse = await gerer(post("/sign-in/email", CONNEXION));
    expect(reponse.status).toBe(429);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: false, raison: "trop_de_requetes" }));
    expect(reponse.headers.getSetCookie()).toEqual([]);
    expect(traiter).not.toHaveBeenCalled();
  });

  test("compteur en panne : erreur avec incident, Better Auth jamais appelé (fermé par défaut)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { traiter, gerer } = traitement({
      limite: async () => {
        throw new Error("base en panne");
      },
    });
    const reponse = await gerer(post("/sign-in/email", CONNEXION));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(traiter).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test.each(["/sign-out", "/sign-up/email", "/send-verification-email", "/verify-email"])(
    "%s : la limite par compte n'est jamais comptée",
    async (chemin) => {
      const { gerer, limiterCompte } = traitement();
      await gerer(post(chemin, CORPS_VALIDES[chemin]));
      expect(limiterCompte).not.toHaveBeenCalled();
    },
  );
});

// Correctif de la 1.2 : la révocation ne dépend que du succès de la connexion,
// jamais de l'existence d'un compte. Production : rien n'est appelé.
describe("révocation de l'ancienne session : jamais hors d'une connexion réussie", () => {
  test("production : connexion fermée, aucune révocation", async () => {
    const { gerer, revoquerSession } = traitement({ estProduction: true });
    await gerer(
      post("/sign-in/email", CONNEXION, {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.session_token=ancien.signature",
      }),
    );
    expect(revoquerSession).not.toHaveBeenCalled();
  });

  test("origine refusée : aucune révocation (une page tierce ne déconnecte personne)", async () => {
    const { gerer, revoquerSession } = traitement();
    await gerer(
      post("/sign-in/email", CONNEXION, {
        "content-type": "application/json",
        origin: "https://attaquant.exemple",
        cookie: "better-auth.session_token=ancien.signature",
      }),
    );
    expect(revoquerSession).not.toHaveBeenCalled();
  });
});
