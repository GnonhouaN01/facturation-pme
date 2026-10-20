import { afterEach, describe, expect, test, vi } from "vitest";

import { dependancesProfilInertes } from "../db/outils-test/profil";
import { dependancesNouvelleAuthentificationInertes } from "../db/outils-test/nouvelle-authentification";

import type { DependancesDoubleAuth, SessionGestion } from "./double-authentification";
import { creerTraitementAuth, reponseInexistante } from "./points-entree";

// Tests d'attaque des sept points de la double authentification (1.4) :
// origine (S-81), entrée falsifiée (trustDevice, disableSession, method,
// issuer, champ inconnu, code hors forme), séparation des cookies (un
// navigateur connecté au compte A ne fait jamais vérifier le code d'une
// connexion en attente de B), corps de Better Auth jamais transmis (S-82),
// comptes fermés en production. Better Auth et toutes les dépendances sont
// des espions. Fiche : docs/features/double-authentification.md, tests 2 à 5.

const ORIGINE = "http://localhost:3000";
const BASE = `${ORIGINE}/api/auth`;
const SESSION = "better-auth.session_token";
const ATTENTE = "better-auth.two_factor";
const COOKIE_RECU = [
  `${SESSION}=jeton-session-a.signature-a`,
  `${ATTENTE}=attente-b.signature-b`,
  "better-auth.trust_device=confiance.signature",
  "better-auth.dont_remember=true.signature",
  "autre=valeur",
].join("; ");

const URI =
  "otpauth://totp/Facturation%20PME:awa%40exemple.invalid?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPJQWEY3E&issuer=Facturation+PME&digits=6&period=30";
const CODES = [
  "abcde-fghjk",
  "mnpqr-stuvw",
  "xyz23-45678",
  "9abcd-efghj",
  "kmnpq-rstuv",
  "wxyz2-34567",
  "89abc-defgh",
  "jkmnp-qrstu",
  "vwxyz-23456",
  "789ab-cdefg",
];

const CORPS_DOUBLE_AUTH: Readonly<Record<string, Record<string, unknown>>> = {
  "/two-factor/verify-totp": { code: "123456" },
  "/two-factor/verify-backup-code": { code: "abcde-fghjk" },
  "/two-factor/enable": { motDePasse: "une-phrase-de-passe-solide" },
  "/two-factor/confirm-enable": { code: "123456" },
  "/two-factor/replace": { motDePasse: "une-phrase-de-passe-solide", code: "123456" },
  "/two-factor/generate-backup-codes": { motDePasse: "une-phrase-de-passe-solide", code: "123456" },
  "/two-factor/disable": { motDePasse: "une-phrase-de-passe-solide", code: "123456" },
};
const CHEMINS = Object.keys(CORPS_DOUBLE_AUTH);
const CONNEXION = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];
const GESTION = CHEMINS.filter((chemin) => !CONNEXION.includes(chemin));

// Réponse de Better Auth selon le chemin interne appelé : succès de chaque
// point, avec le jeton et l'utilisateur dans le corps (que la passerelle ne
// doit jamais transmettre), et un cookie de session neuf quand Better Auth
// en pose un.
function betterAuthReussit(requete: Request): Response {
  const chemin = new URL(requete.url).pathname.replace("/api/auth", "");
  const entetes = new Headers({ "content-type": "application/json" });
  if (chemin === "/two-factor/enable") {
    return new Response(JSON.stringify({ method: "totp", totpURI: URI, backupCodes: CODES }), {
      status: 200,
      headers: entetes,
    });
  }
  if (chemin === "/two-factor/generate-backup-codes") {
    return new Response(JSON.stringify({ status: true, backupCodes: CODES }), {
      status: 200,
      headers: entetes,
    });
  }
  entetes.append(
    "set-cookie",
    `${SESSION}=jeton-neuf.signature-neuve; Path=/; HttpOnly; SameSite=Lax`,
  );
  entetes.append("set-cookie", `${ATTENTE}=; Max-Age=0; Path=/`);
  entetes.append("set-cookie", "better-auth.trust_device=pose; Max-Age=2592000; Path=/");
  entetes.append("set-cookie", "better-auth.dont_remember=; Max-Age=0; Path=/");
  return new Response(
    JSON.stringify({ token: "jeton-neuf", user: { id: "u-a", email: "awa@exemple.invalid" } }),
    { status: 200, headers: entetes },
  );
}

function fauxDoubleAuth(
  session: SessionGestion | null = {
    utilisateurId: "u-a",
    doubleAuthentification: true,
    jeton: "jeton-session-a",
  },
) {
  const deps = {
    lireSession: vi.fn<DependancesDoubleAuth["lireSession"]>(async () => session),
    etatLigne: vi.fn<DependancesDoubleAuth["etatLigne"]>(async () =>
      session?.doubleAuthentification ? "active" : "a_confirmer",
    ),
    utilisateurDuDefi: vi.fn<DependancesDoubleAuth["utilisateurDuDefi"]>(async () => "u-b"),
    limiterConnexion: vi.fn<DependancesDoubleAuth["limiterConnexion"]>(async () => true),
    limiterGestion: vi.fn<DependancesDoubleAuth["limiterGestion"]>(async () => true),
    reserverTranche: vi.fn<DependancesDoubleAuth["reserverTranche"]>(async () => "reservee"),
    motDePasseValide: vi.fn<DependancesDoubleAuth["motDePasseValide"]>(async () => true),
    aRoleExigeant: vi.fn<DependancesDoubleAuth["aRoleExigeant"]>(async () => false),
    preparerRemplacement: vi.fn<DependancesDoubleAuth["preparerRemplacement"]>(async () => {}),
    revoquerAutresSessions: vi.fn<DependancesDoubleAuth["revoquerAutresSessions"]>(async () => {}),
    empreinteCodeSecours: vi.fn<DependancesDoubleAuth["empreinteCodeSecours"]>(
      (code) => `cs1:empreinte-de-${code}`,
    ),
    matriceQr: vi.fn<DependancesDoubleAuth["matriceQr"]>(() => ["10", "01"]),
    notifier: vi.fn<DependancesDoubleAuth["notifier"]>(() => {}),
  };
  return deps;
}

function traitement(
  options: {
    estProduction?: boolean;
    session?: SessionGestion | null;
    reponse?: (requete: Request) => Response;
  } = {},
) {
  const appels: Request[] = [];
  const traiter = vi.fn(async (requete: Request) => {
    appels.push(requete.clone());
    return (options.reponse ?? betterAuthReussit)(requete);
  });
  const doubleAuth = fauxDoubleAuth(options.session === undefined ? undefined : options.session);
  const revoquerSession = vi.fn(async () => {});
  const gerer = creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: options.estProduction ?? false,
    limiterCompte: async () => true,
    sessionEncoreLisible: async () => false,
    revoquerSession,
    limiterReinitialisation: async () => true,
    jetonReinitialisationValide: async () => true,
    motDePasseCompromis: async () => false,
    doubleAuth,
    profil: dependancesProfilInertes(),
    nouvelleAuthentification: dependancesNouvelleAuthentificationInertes(),
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
  return { gerer, traiter, appels, doubleAuth, revoquerSession };
}

function post(
  chemin: string,
  corps: unknown,
  entetes: Record<string, string> = { "content-type": "application/json", origin: ORIGINE },
  suffixe = "",
): Request {
  return new Request(`${BASE}${chemin}${suffixe}`, {
    method: "POST",
    headers: entetes,
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

function avecCookie(chemin: string, corps: unknown = CORPS_DOUBLE_AUTH[chemin]): Request {
  return post(chemin, corps, {
    "content-type": "application/json",
    origin: ORIGINE,
    cookie: COOKIE_RECU,
    "x-forwarded-for": "203.0.113.7",
    "user-agent": "Navigateur d'essai",
  });
}

function aucuneDependanceAppelee(doubleAuth: ReturnType<typeof fauxDoubleAuth>) {
  for (const [nom, espion] of Object.entries(doubleAuth)) {
    expect(espion, nom).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("comptes fermés en production (décision 1 de la 1.1)", () => {
  test.each(CHEMINS)(
    "%s : réponse inexistante, octet pour octet, rien n'est appelé",
    async (chemin) => {
      const { gerer, traiter, doubleAuth } = traitement({ estProduction: true });
      const recue = await gerer(avecCookie(chemin));
      const attendue = reponseInexistante();
      expect(recue.status).toBe(attendue.status);
      expect([...recue.headers.entries()]).toEqual([...attendue.headers.entries()]);
      expect(await recue.text()).toBe(await attendue.text());
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(doubleAuth);
    },
  );

  test.each(CHEMINS)("%s : témoin hors production, le point répond", async (chemin) => {
    const { gerer } = traitement();
    const recue = await gerer(avecCookie(chemin));
    expect(recue.status).not.toBe(404);
  });

  test.each(CHEMINS)("%s : en GET, réponse inexistante", async (chemin) => {
    const { gerer, traiter } = traitement();
    const recue = await gerer(
      new Request(`${BASE}${chemin}`, { headers: { cookie: COOKIE_RECU } }),
    );
    expect(recue.status).toBe(404);
    expect(traiter).not.toHaveBeenCalled();
  });
});

describe("S-81 : origine des sept POST", () => {
  const CAS = [
    ["Origin absente", { "content-type": "application/json" }],
    [
      "Origin étrangère",
      { "content-type": "application/json", origin: "https://attaquant.exemple" },
    ],
    ["Origin null", { "content-type": "application/json", origin: "null" }],
    [
      "Sec-Fetch-Site: cross-site",
      { "content-type": "application/json", origin: ORIGINE, "sec-fetch-site": "cross-site" },
    ],
  ] as const;

  for (const chemin of CHEMINS) {
    test.each(CAS)(`${chemin}, %s : refuse, rien n'est appelé`, async (_nom, entetes) => {
      const { gerer, traiter, doubleAuth } = traitement();
      const recue = await gerer(
        post(chemin, CORPS_DOUBLE_AUTH[chemin], { ...entetes, cookie: COOKIE_RECU }),
      );
      expect(recue.status).toBe(403);
      expect(await recue.json()).toEqual({ ok: false, raison: "refuse" });
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(doubleAuth);
    });
  }
});

describe("entrée falsifiée : refusée avant toute dépendance", () => {
  const CHAMPS_INTERDITS: readonly [string, Record<string, unknown>][] = [
    ["trustDevice", { trustDevice: true }],
    ["disableSession", { disableSession: true }],
    ["method: otp", { method: "otp" }],
    ["issuer", { issuer: "Autre service" }],
    ["password (nom de Better Auth)", { password: "une-phrase-de-passe-solide" }],
    ["champ inconnu", { inconnu: 1 }],
    ["organisation", { organisationId: "00000000-0000-4000-8000-000000000000" }],
  ];

  for (const chemin of CHEMINS) {
    test.each(CHAMPS_INTERDITS)(`${chemin}, %s : invalide`, async (_nom, ajout) => {
      const { gerer, traiter, doubleAuth } = traitement();
      const recue = await gerer(avecCookie(chemin, { ...CORPS_DOUBLE_AUTH[chemin], ...ajout }));
      expect(recue.status).toBe(400);
      expect(await recue.json()).toEqual({ ok: false, raison: "invalide" });
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(doubleAuth);
    });
  }

  test.each([
    ["/two-factor/verify-totp", "12345"],
    ["/two-factor/verify-totp", "1234567"],
    ["/two-factor/verify-totp", "12a456"],
    ["/two-factor/verify-totp", " 123456"],
    ["/two-factor/verify-totp", "abcde-fghjk"],
    ["/two-factor/confirm-enable", "12345"],
    ["/two-factor/confirm-enable", "abcde-fghjk"],
    ["/two-factor/verify-backup-code", "abcde-fghj"],
    ["/two-factor/verify-backup-code", "abcde-fghjkm"],
    ["/two-factor/verify-backup-code", "abcde-fghji"],
    ["/two-factor/verify-backup-code", "123456"],
    ["/two-factor/verify-backup-code", "x".repeat(21)],
  ])("%s, code %j : invalide, rien n'est appelé", async (chemin, code) => {
    const { gerer, traiter, doubleAuth } = traitement();
    const recue = await gerer(avecCookie(chemin, { code }));
    expect(await recue.json()).toEqual({ ok: false, raison: "invalide" });
    expect(traiter).not.toHaveBeenCalled();
    aucuneDependanceAppelee(doubleAuth);
  });

  test.each(GESTION.filter((chemin) => chemin !== "/two-factor/confirm-enable"))(
    "%s : mot de passe de 129 caractères, ou vide : invalide",
    async (chemin) => {
      for (const motDePasse of ["x".repeat(129), ""]) {
        const { gerer, traiter } = traitement();
        const recue = await gerer(avecCookie(chemin, { ...CORPS_DOUBLE_AUTH[chemin], motDePasse }));
        expect(await recue.json()).toEqual({ ok: false, raison: "invalide" });
        expect(traiter).not.toHaveBeenCalled();
      }
    },
  );

  test.each(
    GESTION.filter(
      (chemin) => !["/two-factor/enable", "/two-factor/confirm-enable"].includes(chemin),
    ),
  )("%s : code ni de l'application ni de secours : invalide", async (chemin) => {
    const { gerer, traiter } = traitement();
    const recue = await gerer(avecCookie(chemin, { ...CORPS_DOUBLE_AUTH[chemin], code: "12345" }));
    expect(await recue.json()).toEqual({ ok: false, raison: "invalide" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test.each(CHEMINS)(
    "%s : données dans l'adresse, corps de 4 Kio + 1, autre type que JSON : invalide",
    async (chemin) => {
      const cas = [
        post(
          chemin,
          CORPS_DOUBLE_AUTH[chemin],
          { "content-type": "application/json", origin: ORIGINE },
          "?code=123456",
        ),
        post(chemin, JSON.stringify({ ...CORPS_DOUBLE_AUTH[chemin], bourrage: "x".repeat(4097) })),
        post(chemin, "code=123456", {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGINE,
        }),
      ];
      for (const requete of cas) {
        const { gerer, traiter, doubleAuth } = traitement();
        expect(await (await gerer(requete)).json()).toEqual({ ok: false, raison: "invalide" });
        expect(traiter).not.toHaveBeenCalled();
        aucuneDependanceAppelee(doubleAuth);
      }
    },
  );
});

describe("séparation des cookies : un cookie par usage", () => {
  test.each(CONNEXION)(
    "%s (connexion) : seul le cookie d'attente part vers Better Auth",
    async (chemin) => {
      const { gerer, appels } = traitement();
      await gerer(avecCookie(chemin));
      expect(appels).toHaveLength(1);
      expect(appels[0]?.headers.get("cookie")).toBe(`${ATTENTE}=attente-b.signature-b`);
    },
  );

  test.each(GESTION)(
    "%s (gestion) : seul le cookie de session part vers Better Auth",
    async (chemin) => {
      const { gerer, appels } = traitement({
        session: {
          utilisateurId: "u-a",
          // confirm-enable n'existe que pendant une activation en cours.
          doubleAuthentification:
            chemin !== "/two-factor/enable" && chemin !== "/two-factor/confirm-enable",
          jeton: "jeton-session-a",
        },
      });
      await gerer(avecCookie(chemin));
      expect(appels.length).toBeGreaterThan(0);
      for (const appel of appels) {
        const cookie = appel.headers.get("cookie");
        // Chaque appel interne (vérification du code, puis l'opération) porte
        // le cookie de session reçu, et lui seul.
        expect(cookie, new URL(appel.url).pathname).toBe(`${SESSION}=jeton-session-a.signature-a`);
      }
    },
  );

  test("/sign-in/email : aucun cookie transmis, même un cookie d'appareil de confiance", async () => {
    const { gerer, appels } = traitement({
      reponse: () =>
        new Response(JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }), {
          status: 200,
          headers: { "set-cookie": `${ATTENTE}=attente.sig; Max-Age=300; Path=/; HttpOnly` },
        }),
    });
    await gerer(
      avecCookie("/sign-in/email", {
        email: "awa@exemple.invalid",
        motDePasse: "une-phrase-de-passe-solide",
      }),
    );
    expect(appels).toHaveLength(1);
    expect(appels[0]?.headers.get("cookie")).toBeNull();
  });

  test("connexion sans cookie d'attente, avec un cookie de session valide (compte A) : connexion_expiree, Better Auth jamais appelé", async () => {
    const { gerer, traiter, doubleAuth } = traitement();
    const requete = post(
      "/two-factor/verify-totp",
      { code: "123456" },
      {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: `${SESSION}=jeton-session-a.signature-a`,
      },
    );
    expect(await (await gerer(requete)).json()).toEqual({ ok: false, raison: "connexion_expiree" });
    expect(traiter).not.toHaveBeenCalled();
    expect(doubleAuth.lireSession).not.toHaveBeenCalled();
  });

  test("gestion avec le seul cookie d'attente (compte B) : connexion_requise, Better Auth jamais appelé", async () => {
    const { gerer, traiter } = traitement({ session: null });
    const requete = post("/two-factor/disable", CORPS_DOUBLE_AUTH["/two-factor/disable"], {
      "content-type": "application/json",
      origin: ORIGINE,
      cookie: `${ATTENTE}=attente-b.signature-b`,
    });
    const recue = await gerer(requete);
    expect(recue.status).toBe(401);
    expect(await recue.json()).toEqual({ ok: false, raison: "connexion_requise" });
    expect(traiter).not.toHaveBeenCalled();
  });

  test("un cookie de nom voisin n'est pas pris pour le cookie d'attente", async () => {
    const { gerer, traiter } = traitement();
    const requete = post(
      "/two-factor/verify-totp",
      { code: "123456" },
      {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "xbetter-auth.two_factor=a.b; better-auth.two_factor_x=a.b",
      },
    );
    expect(await (await gerer(requete)).json()).toEqual({ ok: false, raison: "connexion_expiree" });
    expect(traiter).not.toHaveBeenCalled();
  });
});

describe("S-82 : corps de Better Auth jamais transmis ; seuls les cookies attendus", () => {
  test.each(CONNEXION)(
    "%s réussi : { ok: true }, cookie de session et effacement de l'attente seulement",
    async (chemin) => {
      const { gerer } = traitement();
      const recue = await gerer(avecCookie(chemin));
      expect(recue.status).toBe(200);
      expect(await recue.text()).toBe(JSON.stringify({ ok: true }));
      expect(recue.headers.getSetCookie()).toEqual([
        `${SESSION}=jeton-neuf.signature-neuve; Path=/; HttpOnly; SameSite=Lax`,
        `${ATTENTE}=; Max-Age=0; Path=/`,
      ]);
    },
  );

  test.each(["/two-factor/enable", "/two-factor/replace"])(
    "%s : exactement { ok, qr, cle, codes }, sans totpURI",
    async (chemin) => {
      const { gerer } = traitement({
        session: {
          utilisateurId: "u-a",
          doubleAuthentification: chemin === "/two-factor/replace",
          jeton: "jeton-session-a",
        },
      });
      const recue = await gerer(avecCookie(chemin));
      const texte = await recue.text();
      expect(JSON.parse(texte)).toEqual({
        ok: true,
        qr: ["10", "01"],
        cle: "MFRG GZDF MZTW Q2LK NNWG 23TP OBYX E43U OV3H O6DZ PJQW EY3E",
        codes: CODES,
      });
      expect(texte).not.toContain("otpauth");
      expect(texte).not.toContain("token");
      expect(recue.headers.getSetCookie()).toEqual([]);
    },
  );

  test("/two-factor/generate-backup-codes : exactement { ok, codes }", async () => {
    const { gerer } = traitement();
    const recue = await gerer(avecCookie("/two-factor/generate-backup-codes"));
    expect(await recue.json()).toEqual({ ok: true, codes: CODES });
  });

  test.each(["/two-factor/confirm-enable", "/two-factor/disable"])(
    "%s : { ok: true } et le seul cookie de session neuf",
    async (chemin) => {
      const { gerer } = traitement({
        session: {
          utilisateurId: "u-a",
          doubleAuthentification: chemin === "/two-factor/disable",
          jeton: "jeton-session-a",
        },
      });
      const recue = await gerer(avecCookie(chemin));
      expect(await recue.text()).toBe(JSON.stringify({ ok: true }));
      expect(recue.headers.getSetCookie()).toEqual([
        `${SESSION}=jeton-neuf.signature-neuve; Path=/; HttpOnly; SameSite=Lax`,
      ]);
    },
  );

  const HORS_FORME: readonly [string, unknown][] = [
    ["neuf codes", { totpURI: URI, backupCodes: CODES.slice(1) }],
    ["un code mal formé", { totpURI: URI, backupCodes: [...CODES.slice(1), "ABCDE-FGHJK"] }],
    ["totpURI absent", { backupCodes: CODES }],
    [
      "totpURI d'un autre schéma",
      { totpURI: "https://exemple.invalid/?secret=MFRG", backupCodes: CODES },
    ],
    ["secret absent", { totpURI: "otpauth://totp/x?issuer=y", backupCodes: CODES }],
    ["secret hors base32", { totpURI: "otpauth://totp/x?secret=abc!", backupCodes: CODES }],
  ];

  test.each(HORS_FORME)(
    "activation, réponse de Better Auth hors forme (%s) : erreur avec incident",
    async (_nom, corps) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { gerer } = traitement({
        session: { utilisateurId: "u-a", doubleAuthentification: false, jeton: "jeton-session-a" },
        reponse: () => Response.json(corps),
      });
      const recue = await gerer(avecCookie("/two-factor/enable"));
      expect(recue.status).toBe(500);
      const lu = (await recue.json()) as Record<string, unknown>;
      expect(Object.keys(lu).sort()).toEqual(["incident", "ok", "raison"]);
      expect(lu.raison).toBe("erreur");
    },
  );

  test("connexion réussie sans cookie de session : erreur avec incident, aucun cookie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer } = traitement({ reponse: () => Response.json({ token: "t", user: {} }) });
    const recue = await gerer(avecCookie("/two-factor/verify-totp"));
    expect(recue.status).toBe(500);
    expect(recue.headers.getSetCookie()).toEqual([]);
  });
});

describe("/sign-in/email d'un compte à second facteur (section 2.2)", () => {
  function demandeCode(cookies: string[]) {
    return () => {
      const entetes = new Headers({ "content-type": "application/json" });
      for (const cookie of cookies) entetes.append("set-cookie", cookie);
      return new Response(JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }), {
        status: 200,
        headers: entetes,
      });
    };
  }
  const CONNEXION_CORPS = {
    email: "awa@exemple.invalid",
    motDePasse: "une-phrase-de-passe-solide",
  };

  test("{ ok: true, etape: \"code\" }, le seul cookie d'attente ; l'effacement du cookie de session n'est pas transmis", async () => {
    const { gerer, revoquerSession } = traitement({
      reponse: demandeCode([
        `${SESSION}=; Max-Age=0; Path=/`,
        `${ATTENTE}=attente.signature; Max-Age=300; Path=/; HttpOnly; SameSite=Lax`,
      ]),
    });
    const recue = await gerer(avecCookie("/sign-in/email", CONNEXION_CORPS));
    expect(recue.status).toBe(200);
    expect(await recue.text()).toBe(JSON.stringify({ ok: true, etape: "code" }));
    expect(recue.headers.getSetCookie()).toEqual([
      `${ATTENTE}=attente.signature; Max-Age=300; Path=/; HttpOnly; SameSite=Lax`,
    ]);
    // L'ancienne session du navigateur n'est révoquée qu'après le code.
    expect(revoquerSession).not.toHaveBeenCalled();
  });

  test("twoFactorRedirect sans cookie d'attente : erreur avec incident, aucun cookie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer } = traitement({ reponse: demandeCode([`${SESSION}=; Max-Age=0; Path=/`]) });
    const recue = await gerer(avecCookie("/sign-in/email", CONNEXION_CORPS));
    expect(recue.status).toBe(500);
    expect(recue.headers.getSetCookie()).toEqual([]);
  });
});
