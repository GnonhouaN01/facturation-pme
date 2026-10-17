import { describe, expect, test, vi } from "vitest";

import { auth } from "./config";
import { creerTraitementAuth, POINTS_ENTREE_OUVERTS, reponseInexistante } from "./points-entree";

// Tests d'attaque de la liste fermée des points d'entrée de /api/auth : T-55
// (points d'entrée natifs fermés), S-81 (origine), entrée falsifiée,
// inscription fermée en production (décision 1), jeton de vérification
// jamais dans l'adresse reçue (décision 3). Better Auth est remplacé par un
// espion : un point d'entrée fermé ne doit jamais l'atteindre. Fiche :
// docs/features/inscription.md, sections 2 et 4.3. Connexion et déconnexion
// (1.2) : réponse unique pour les trois échecs (T-07), corps de Better Auth
// jamais transmis (S-82), limite par compte, comptes fermés en production.
// Fiche : docs/features/connexion.md, tests 1 à 6. Mot de passe oublié
// (1.3) : deux points de plus, GET /reset-password/:token toujours fermé,
// réponse unique de la demande (T-07), entrée falsifiée, limite par adresse
// email. Fiche : docs/features/mot-de-passe.md, tests 1 à 5. Ouverture
// (1.3, PR 2) : les sept POST se comportent en production comme ailleurs,
// et une requête sans Origin est refusée avant toute lecture du corps.
// Fiche : docs/features/mot-de-passe.md, section 11, test 23.

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
  // 1.3 (docs/features/mot-de-passe.md, section 2).
  "/request-password-reset": { email: "awa@exemple.invalid" },
  "/reset-password": { jeton: "aB3dE5fG7hJ9kL1mN2pQ4rS6", motDePasse: "une-phrase-de-passe-neuve" },
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
    limiteReinitialisation?: () => Promise<boolean>;
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
  // 1.3 : limite par adresse email de la demande, contrôles de la
  // réinitialisation avant la consommation du jeton.
  const limiterReinitialisation = vi.fn<(adresse: string) => Promise<boolean>>(
    options.limiteReinitialisation ?? (async () => true),
  );
  const jetonReinitialisationValide = vi.fn<(jeton: string) => Promise<boolean>>(async () => true);
  const motDePasseCompromis = vi.fn<(motDePasse: string) => Promise<boolean>>(async () => false);
  const dependances = {
    traiter,
    origine: ORIGINE,
    limiterCompte,
    sessionEncoreLisible,
    revoquerSession,
    limiterReinitialisation,
    jetonReinitialisationValide,
    motDePasseCompromis,
    horloge: { maintenant: () => 0, attendre: async () => {} },
    // 1.3, PR 2 : l'ancienne dépendance de production, glissée hors du type
    // si le test la demande ; le gestionnaire ne la lit plus (test 23).
    ...(options.estProduction === undefined ? {} : { estProduction: options.estProduction }),
  };
  const gerer = creerTraitementAuth(dependances);
  return {
    traiter,
    gerer,
    limiterCompte,
    sessionEncoreLisible,
    revoquerSession,
    limiterReinitialisation,
    jetonReinitialisationValide,
    motDePasseCompromis,
  };
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
  // Modifié en 1.3 : sept points au lieu de cinq (docs/features/mot-de-passe.md,
  // section 2.1).
  test("les points d'entrée ouverts sont exactement les sept des fiches 1.1 à 1.3, en POST", () => {
    expect(OUVERTS).toEqual([
      "/request-password-reset",
      "/reset-password",
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

  test("chaque point d'entrée déclaré, en GET et en POST, hors des sept ouverts : réponse inexistante, Better Auth jamais appelé", async () => {
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

// 1.3, PR 2 : les comptes sont ouverts en production (décision 1 de la 1.1
// levée). Remplace « comptes fermés en production » de la 1.1 et de la 1.2.
describe("comptes ouverts en production (1.3, PR 2)", () => {
  test.each(OUVERTS)(
    "%s : même avec estProduction vrai dans les dépendances, transmis à Better Auth comme hors production",
    async (chemin) => {
      const production = traitement({ estProduction: true });
      const ailleurs = traitement({ estProduction: false });
      const recue = await production.gerer(post(chemin, CORPS_VALIDES[chemin]));
      const temoin = await ailleurs.gerer(post(chemin, CORPS_VALIDES[chemin]));
      expect(recue.status).toBe(200);
      expect(await empreinte(recue)).toEqual(await empreinte(temoin));
      expect(production.traiter).toHaveBeenCalledTimes(1);
      expect(ailleurs.traiter).toHaveBeenCalledTimes(1);
    },
  );

  // Ce que le contrôle après déploiement envoie en production : un POST sans
  // Origin. Ici avec un corps valide : refusé avant toute lecture, rien
  // n'est créé, rien n'est compté, rien n'est envoyé.
  test.each(OUVERTS)(
    "%s sans Origin, corps valide : 403 refuse, corps non lu, aucune dépendance appelée",
    async (chemin) => {
      const outils = traitement({ estProduction: true });
      const recue = post(chemin, CORPS_VALIDES[chemin], { "content-type": "application/json" });
      const reponse = await outils.gerer(recue);
      expect(reponse.status).toBe(403);
      expect(await reponse.json()).toEqual({ ok: false, raison: "refuse" });
      expect(reponse.headers.getSetCookie()).toEqual([]);
      expect(recue.bodyUsed).toBe(false);
      expect(outils.traiter).not.toHaveBeenCalled();
      expect(outils.limiterCompte).not.toHaveBeenCalled();
      expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
      expect(outils.jetonReinitialisationValide).not.toHaveBeenCalled();
      expect(outils.motDePasseCompromis).not.toHaveBeenCalled();
      expect(outils.sessionEncoreLisible).not.toHaveBeenCalled();
      expect(outils.revoquerSession).not.toHaveBeenCalled();
    },
  );
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
// jamais de l'existence d'un compte.
describe("révocation de l'ancienne session : jamais hors d'une connexion réussie", () => {
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
// Fonctionnalité 1.3 : mot de passe oublié. Fiche :
// docs/features/mot-de-passe.md, sections 2, 3 et 5, tests 1 à 5.

const JETON_REINITIALISATION = "aB3dE5fG7hJ9kL1mN2pQ4rS6";
const DEMANDE = CORPS_VALIDES["/request-password-reset"] as Record<string, unknown>;
const REINITIALISATION = CORPS_VALIDES["/reset-password"] as Record<string, unknown>;

describe("T-55 (1.3) : ce qui reste fermé autour de la réinitialisation", () => {
  test.each([
    [
      "lien de Better Auth, jeton dans le chemin",
      "GET",
      `/reset-password/${JETON_REINITIALISATION}`,
    ],
    [
      "lien de Better Auth avec callbackURL",
      "GET",
      `/reset-password/${JETON_REINITIALISATION}?callbackURL=%2F`,
    ],
    ["GET de la réinitialisation", "GET", "/reset-password"],
    ["GET de la demande", "GET", "/request-password-reset"],
    ["POST sur le chemin du lien", "POST", `/reset-password/${JETON_REINITIALISATION}`],
    ["vérification du mot de passe (serveur)", "POST", "/verify-password"],
    ["changement du mot de passe", "POST", "/change-password"],
    ["ancien chemin de la demande", "POST", "/forget-password"],
  ] as const)("%s : réponse inexistante, rien n'est appelé", async (_nom, methode, chemin) => {
    const attendue = await inexistante();
    const outils = traitement();
    const recue =
      methode === "POST"
        ? await outils.gerer(post(chemin, REINITIALISATION))
        : await outils.gerer(requete("GET", chemin));
    expect(await empreinte(recue)).toEqual(attendue);
    expect(outils.traiter).not.toHaveBeenCalled();
    expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
    expect(outils.jetonReinitialisationValide).not.toHaveBeenCalled();
    expect(outils.motDePasseCompromis).not.toHaveBeenCalled();
  });
});

describe("S-81 et entrée falsifiée (1.3) : refusées avant tout appel", () => {
  test.each([
    ["Origin absente", { "content-type": "application/json" }],
    [
      "Origin étrangère",
      {
        "content-type": "application/json",
        origin: "https://attaquant.exemple",
      },
    ],
    ["Origin null", { "content-type": "application/json", origin: "null" }],
    [
      "Sec-Fetch-Site cross-site",
      {
        "content-type": "application/json",
        origin: ORIGINE,
        "sec-fetch-site": "cross-site",
      },
    ],
  ] as const)("%s : 403 sur les deux points, rien n'est appelé", async (_nom, entetes) => {
    for (const [chemin, corps] of [
      ["/request-password-reset", DEMANDE],
      ["/reset-password", REINITIALISATION],
    ] as const) {
      const outils = traitement();
      const reponse = await outils.gerer(post(chemin, corps, { ...entetes }));
      expect(reponse.status, chemin).toBe(403);
      expect(await reponse.json()).toEqual({ ok: false, raison: "refuse" });
      expect(outils.traiter).not.toHaveBeenCalled();
      expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
      expect(outils.jetonReinitialisationValide).not.toHaveBeenCalled();
      expect(outils.motDePasseCompromis).not.toHaveBeenCalled();
    }
  });

  test.each([
    [
      "demande : redirectTo",
      "/request-password-reset",
      { ...DEMANDE, redirectTo: "https://attaquant.exemple" },
    ],
    ["demande : callbackURL", "/request-password-reset", { ...DEMANDE, callbackURL: "/" }],
    ["demande : champ inconnu", "/request-password-reset", { ...DEMANDE, role: "proprietaire" }],
    [
      "demande : adresse hors de la règle de la porte",
      "/request-password-reset",
      { email: "Awa <awa@exemple.invalid>" },
    ],
    [
      "demande : deux adresses",
      "/request-password-reset",
      { email: "a@exemple.invalid,b@exemple.invalid" },
    ],
    ["demande : adresse absente", "/request-password-reset", {}],
    [
      "réinitialisation : noms de Better Auth",
      "/reset-password",
      {
        token: JETON_REINITIALISATION,
        newPassword: "une-phrase-de-passe-neuve",
      },
    ],
    [
      "réinitialisation : champ inconnu",
      "/reset-password",
      { ...REINITIALISATION, email: "awa@exemple.invalid" },
    ],
    [
      "réinitialisation : callbackURL",
      "/reset-password",
      { ...REINITIALISATION, callbackURL: "/" },
    ],
    [
      "réinitialisation : jeton de 23 caractères",
      "/reset-password",
      { ...REINITIALISATION, jeton: JETON_REINITIALISATION.slice(1) },
    ],
    [
      "réinitialisation : jeton de 25 caractères",
      "/reset-password",
      { ...REINITIALISATION, jeton: `${JETON_REINITIALISATION}a` },
    ],
    [
      "réinitialisation : jeton avec un tiret",
      "/reset-password",
      { ...REINITIALISATION, jeton: `${JETON_REINITIALISATION.slice(1)}-` },
    ],
    [
      "réinitialisation : jeton avec un souligné",
      "/reset-password",
      { ...REINITIALISATION, jeton: `${JETON_REINITIALISATION.slice(1)}_` },
    ],
    // L'empreinte stockée en base (SHA-256 en base64url, 43 caractères)
    // présentée comme jeton (section 3.2).
    [
      "réinitialisation : empreinte présentée comme jeton",
      "/reset-password",
      {
        ...REINITIALISATION,
        jeton: "Qm9uam91ci1sZS1tb25kZS1lbXByZWludGUtZmFjdGljZQ",
      },
    ],
    [
      "réinitialisation : jeton préfixé comme en base",
      "/reset-password",
      {
        ...REINITIALISATION,
        jeton: `reinitialisation:${JETON_REINITIALISATION}`,
      },
    ],
    [
      "réinitialisation : jeton de vérification (JWT)",
      "/reset-password",
      { ...REINITIALISATION, jeton: JETON },
    ],
    [
      "réinitialisation : mot de passe de 129 caractères",
      "/reset-password",
      { ...REINITIALISATION, motDePasse: "a".repeat(129) },
    ],
    [
      "réinitialisation : mot de passe non textuel",
      "/reset-password",
      { ...REINITIALISATION, motDePasse: 123456789012 },
    ],
    [
      "réinitialisation : jeton absent",
      "/reset-password",
      { motDePasse: "une-phrase-de-passe-neuve" },
    ],
  ] as const)("%s : 400 invalide, rien n'est appelé", async (_nom, chemin, corps) => {
    const outils = traitement();
    const reponse = await outils.gerer(post(chemin, corps));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "invalide" });
    expect(outils.traiter).not.toHaveBeenCalled();
    expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
    expect(outils.limiterCompte).not.toHaveBeenCalled();
    expect(outils.jetonReinitialisationValide).not.toHaveBeenCalled();
    expect(outils.motDePasseCompromis).not.toHaveBeenCalled();
  });

  test.each(["/request-password-reset", "/reset-password"])(
    "%s : données dans l'adresse, autre type que JSON, ou corps de plus de 4 Kio : refusés",
    async (chemin) => {
      const outils = traitement();
      const corps = JSON.stringify(CORPS_VALIDES[chemin]);
      const lourd = `${corps.slice(0, -1)}${" ".repeat(4097 - Buffer.byteLength(corps))}}`;
      for (const recue of [
        await outils.gerer(
          requete("POST", `${chemin}?token=${JETON_REINITIALISATION}`, {
            corps,
          }),
        ),
        await outils.gerer(
          requete("POST", chemin, {
            corps,
            entetes: { "content-type": "text/plain", origin: ORIGINE },
          }),
        ),
        await outils.gerer(requete("POST", chemin, { corps: lourd })),
      ]) {
        expect(recue.status).toBe(400);
      }
      expect(outils.traiter).not.toHaveBeenCalled();
      expect(outils.jetonReinitialisationValide).not.toHaveBeenCalled();
    },
  );

  test("demande : seule l'adresse validée parvient à Better Auth, sans cookie ni redirectTo", async () => {
    const outils = traitement();
    await outils.gerer(
      post("/request-password-reset", DEMANDE, {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.session_token=ancienne",
        "x-forwarded-for": "203.0.113.9",
      }),
    );
    const interne = outils.traiter.mock.calls[0]?.[0];
    if (!interne) throw new Error("Better Auth non appelé");
    expect(interne.method).toBe("POST");
    expect(new URL(interne.url).pathname).toBe("/api/auth/request-password-reset");
    expect(new URL(interne.url).search).toBe("");
    expect(await interne.json()).toEqual({ email: "awa@exemple.invalid" });
    expect(interne.headers.get("cookie")).toBeNull();
    expect(interne.headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  test("réinitialisation : le jeton et le mot de passe parviennent à Better Auth dans le corps, sous ses noms", async () => {
    const outils = traitement();
    await outils.gerer(
      post("/reset-password", REINITIALISATION, {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.session_token=ancienne",
      }),
    );
    const interne = outils.traiter.mock.calls[0]?.[0];
    if (!interne) throw new Error("Better Auth non appelé");
    expect(interne.method).toBe("POST");
    expect(new URL(interne.url).pathname).toBe("/api/auth/reset-password");
    expect(new URL(interne.url).search).toBe("");
    expect(await interne.json()).toEqual({
      token: JETON_REINITIALISATION,
      newPassword: "une-phrase-de-passe-neuve",
    });
    expect(interne.headers.get("cookie")).toBeNull();
  });
});

describe("T-07 (1.3) : une seule réponse pour toute demande", () => {
  test("compte trouvé ou non (corps de Better Auth différents) : même statut, mêmes en-têtes, mêmes octets, { ok: true }", async () => {
    const empreintes = [];
    for (const corps of [
      {
        status: true,
        message: "If this email exists in our system, check your email for the reset link",
      },
      { status: true },
      { status: true, message: "autre", user: { id: "u1" } },
    ]) {
      const { gerer } = traitement({
        // Un Set-Cookie de Better Auth n'est jamais transmis.
        reponse: reponseBetterAuth(200, corps, [COOKIE_SESSION]),
      });
      const reponse = await gerer(post("/request-password-reset", DEMANDE));
      expect(reponse.headers.getSetCookie()).toEqual([]);
      empreintes.push(await empreinte(reponse));
    }
    expect(empreintes[0]?.statut).toBe(200);
    expect(Buffer.from(empreintes[0]?.corps ?? "", "hex").toString()).toBe(
      JSON.stringify({ ok: true }),
    );
    for (const recue of empreintes) expect(recue).toEqual(empreintes[0]);
  });

  test("réinitialisation réussie : { ok: true }, aucun cookie, rien du corps de Better Auth", async () => {
    const { gerer } = traitement({
      reponse: reponseBetterAuth(200, { status: true, user: { id: "u1" } }, [COOKIE_SESSION]),
    });
    const reponse = await gerer(post("/reset-password", REINITIALISATION));
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });
});

describe("limite par adresse email de la demande (S-11, T-43) : auth.reinitialisation_compte", () => {
  test("appelée une fois avec l'adresse validée, avant Better Auth ; la limite de connexion jamais", async () => {
    const outils = traitement();
    await outils.gerer(post("/request-password-reset", DEMANDE));
    expect(outils.limiterReinitialisation).toHaveBeenCalledTimes(1);
    expect(outils.limiterReinitialisation).toHaveBeenCalledWith("awa@exemple.invalid");
    expect(outils.limiterCompte).not.toHaveBeenCalled();
    expect(outils.traiter).toHaveBeenCalledTimes(1);
    expect(outils.limiterReinitialisation.mock.invocationCallOrder[0]).toBeLessThan(
      outils.traiter.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("limite atteinte : 429 trop_de_requetes, Better Auth jamais appelé", async () => {
    const outils = traitement({ limiteReinitialisation: async () => false });
    const reponse = await outils.gerer(post("/request-password-reset", DEMANDE));
    expect(reponse.status).toBe(429);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: false, raison: "trop_de_requetes" }));
    expect(outils.traiter).not.toHaveBeenCalled();
  });

  test("compteur en panne : erreur avec incident, Better Auth jamais appelé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outils = traitement({
      limiteReinitialisation: async () => {
        throw new Error("base en panne");
      },
    });
    const reponse = await outils.gerer(post("/request-password-reset", DEMANDE));
    expect(reponse.status).toBe(500);
    const corps = (await reponse.json()) as Record<string, unknown>;
    expect(corps.raison).toBe("erreur");
    expect(corps.incident).toMatch(UUID);
    expect(outils.traiter).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test("la connexion compte toujours sa propre limite, jamais celle de la demande", async () => {
    const outils = traitement();
    await outils.gerer(post("/sign-in/email", CONNEXION));
    expect(outils.limiterCompte).toHaveBeenCalledTimes(1);
    expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
  });

  test.each([
    "/reset-password",
    "/sign-up/email",
    "/send-verification-email",
    "/verify-email",
    "/sign-out",
  ])("%s : la limite de la demande n'est jamais comptée", async (chemin) => {
    const outils = traitement();
    await outils.gerer(post(chemin, CORPS_VALIDES[chemin]));
    expect(outils.limiterReinitialisation).not.toHaveBeenCalled();
  });
});
