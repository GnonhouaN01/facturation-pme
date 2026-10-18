import { createHash } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CHEMINS_INTERNES_DOUBLE_AUTH,
  empreinteAttenteDoubleAuth,
  extraireCookie,
  identifiantAttente,
  jetonDuSetCookie,
  lireActivation,
  nomCookieAttente,
  nomCookieSession,
  POINTS_DOUBLE_AUTH,
  PREFIXE_EMPREINTE_ATTENTE,
  type DependancesDoubleAuth,
  type SessionGestion,
} from "./double-authentification";
import { creerTraitementAuth } from "./points-entree";

// La passerelle de la double authentification (1.4) : traduction des
// réponses de Better Auth en une liste fermée, ordre des contrôles de la
// connexion et de la gestion, effets après un succès (sessions, emails), et
// fonctions de lecture des cookies et des réponses. Fiche :
// docs/features/double-authentification.md, sections 2, 3, 6, 8 et 10,
// tests 6 à 9 et 12.

const ORIGINE = "http://localhost:3000";
const SESSION = "better-auth.session_token";
const ATTENTE = "better-auth.two_factor";
const URI =
  "otpauth://totp/Facturation%20PME:awa%40exemple.invalid?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPJQWEY3E&issuer=Facturation+PME&digits=6&period=30";
const CODES = Array.from({ length: 10 }, (_v, i) => `abcd${"abcdefghjk"[i]}-fghjk`);
const MOT_DE_PASSE = "une-phrase-de-passe-solide";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type Journal = { appels: string[] };

function deps(
  journal: Journal,
  surcharges: Partial<DependancesDoubleAuth> = {},
  session: SessionGestion | null = {
    utilisateurId: "u-a",
    doubleAuthentification: true,
    jeton: "jeton-a",
  },
): DependancesDoubleAuth {
  const note =
    <A extends unknown[], R>(nom: string, f: (...args: A) => R) =>
    (...args: A): R => {
      journal.appels.push(nom);
      return f(...args);
    };
  return {
    lireSession: note("lireSession", async () => session),
    etatLigne: note("etatLigne", async () =>
      session?.doubleAuthentification ? ("active" as const) : ("a_confirmer" as const),
    ),
    utilisateurDuDefi: note("utilisateurDuDefi", async () => "u-b"),
    limiterConnexion: note("limiterConnexion", async () => true),
    limiterGestion: note("limiterGestion", async () => true),
    reserverTranche: note("reserverTranche", async () => "reservee" as const),
    motDePasseValide: note("motDePasseValide", async () => true),
    aRoleExigeant: note("aRoleExigeant", async () => false),
    preparerRemplacement: note("preparerRemplacement", async () => {}),
    revoquerAutresSessions: note("revoquerAutresSessions", async () => {}),
    empreinteCodeSecours: note("empreinteCodeSecours", (code: string) => `cs1:e-${code}`),
    matriceQr: note("matriceQr", () => ["1"]),
    notifier: note("notifier", () => {}),
    ...surcharges,
  };
}

function reponse(statut: number, corps: unknown, cookies: string[] = []): Response {
  const entetes = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) entetes.append("set-cookie", cookie);
  return new Response(JSON.stringify(corps), { status: statut, headers: entetes });
}

const NOUVELLE_SESSION = `${SESSION}=jeton-neuf.sig; Path=/; HttpOnly; SameSite=Lax`;

// Réponses de Better Auth par chemin interne ; journal des appels.
function betterAuth(
  journal: Journal,
  par: Partial<Record<string, () => Response>> = {},
): (requete: Request) => Promise<Response> {
  return async (requete) => {
    const chemin = new URL(requete.url).pathname.replace("/api/auth", "");
    journal.appels.push(`BA ${chemin} ${await requete.clone().text()}`);
    const surcharge = par[chemin];
    if (surcharge) return surcharge();
    if (chemin === "/two-factor/enable") {
      return reponse(200, { method: "totp", totpURI: URI, backupCodes: CODES });
    }
    if (chemin === "/two-factor/generate-backup-codes") {
      return reponse(200, { status: true, backupCodes: CODES });
    }
    return reponse(200, { token: "jeton-neuf", user: { id: "u" } }, [
      NOUVELLE_SESSION,
      `${ATTENTE}=; Max-Age=0; Path=/`,
    ]);
  };
}

function gerer(
  journal: Journal,
  options: {
    deps?: Partial<DependancesDoubleAuth>;
    session?: SessionGestion | null;
    betterAuth?: Partial<Record<string, () => Response>>;
    revoquer?: () => Promise<void>;
  } = {},
) {
  return creerTraitementAuth({
    traiter: betterAuth(journal, options.betterAuth),
    origine: ORIGINE,
    estProduction: false,
    limiterCompte: async () => true,
    sessionEncoreLisible: async () => false,
    revoquerSession: async () => {
      journal.appels.push("revoquerSession");
      await options.revoquer?.();
    },
    limiterReinitialisation: async () => true,
    jetonReinitialisationValide: async () => true,
    motDePasseCompromis: async () => false,
    doubleAuth: deps(journal, options.deps, options.session),
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
}

function post(
  chemin: string,
  corps: unknown,
  cookie = `${SESSION}=jeton-a.sig; ${ATTENTE}=attente-b.sig`,
) {
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE, cookie },
    body: JSON.stringify(corps),
  });
}

function nouveauJournal(): Journal {
  return { appels: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fonctions de lecture", () => {
  test("noms des cookies : préfixe __Secure- en https, comme Better Auth", () => {
    expect(nomCookieSession("http://localhost:3000")).toBe(SESSION);
    expect(nomCookieAttente("http://localhost:3000")).toBe(ATTENTE);
    expect(nomCookieSession("https://facturation.exemple.ci")).toBe(`__Secure-${SESSION}`);
    expect(nomCookieAttente("https://facturation.exemple.ci")).toBe(`__Secure-${ATTENTE}`);
  });

  test("extraireCookie : la paire exacte, par son nom, telle que reçue", () => {
    const entete = `a=1; ${ATTENTE}=x%2Ey.sig; x${ATTENTE}=non; ${ATTENTE}_b=non`;
    expect(extraireCookie(entete, ATTENTE)).toBe(`${ATTENTE}=x%2Ey.sig`);
    expect(extraireCookie(entete, SESSION)).toBeNull();
    expect(extraireCookie(null, ATTENTE)).toBeNull();
    expect(extraireCookie(`${ATTENTE}=`, ATTENTE)).toBeNull();
  });

  test("identifiantAttente : la valeur avant la signature, décodée ; mal formée : null", () => {
    expect(identifiantAttente(`${ATTENTE}=2fa-abc.signature`)).toBe("2fa-abc");
    expect(identifiantAttente(`${ATTENTE}=2fa-abc%2Esuite.signature`)).toBe("2fa-abc.suite");
    expect(identifiantAttente(`${ATTENTE}=sanssignature`)).toBeNull();
    expect(identifiantAttente(`${ATTENTE}=%E0%A4%A.sig`)).toBeNull();
    expect(identifiantAttente(`${ATTENTE}=.sig`)).toBeNull();
  });

  test("jetonDuSetCookie : le jeton du cookie de session posé, sinon null", () => {
    expect(jetonDuSetCookie([`${ATTENTE}=; Max-Age=0`, NOUVELLE_SESSION], SESSION)).toBe(
      "jeton-neuf",
    );
    expect(jetonDuSetCookie([`${SESSION}=; Max-Age=0`], SESSION)).toBeNull();
    expect(jetonDuSetCookie([], SESSION)).toBeNull();
  });

  test("empreinte de l'attente : préfixe double-auth:, SHA-256 en base64url, ni 2fa- ni l'identifiant", async () => {
    const identifiant = "2fa-abcdefghijklmnopqrst";
    const empreinte = await empreinteAttenteDoubleAuth(identifiant);
    expect(PREFIXE_EMPREINTE_ATTENTE).toBe("double-auth:");
    expect(empreinte).toBe(
      `double-auth:${createHash("sha256").update(identifiant).digest("base64url")}`,
    );
    expect(empreinte).not.toContain("abcdefghij");
    expect(await empreinteAttenteDoubleAuth(`2fa-attempts-${identifiant}`)).not.toBe(empreinte);
    expect(await empreinteAttenteDoubleAuth(identifiant)).toBe(empreinte);
  });

  test("lireActivation : matrice, clé groupée par 4, codes ; hors forme : null", () => {
    const matrice = vi.fn(() => ["10", "01"]);
    expect(lireActivation({ totpURI: URI, backupCodes: CODES }, matrice)).toEqual({
      qr: ["10", "01"],
      cle: "MFRG GZDF MZTW Q2LK NNWG 23TP OBYX E43U OV3H O6DZ PJQW EY3E",
      codes: CODES,
    });
    expect(matrice).toHaveBeenCalledWith(URI);
    expect(lireActivation({ totpURI: URI }, matrice)).toBeNull();
    expect(lireActivation(null, matrice)).toBeNull();
    expect(
      lireActivation({ totpURI: "otpauth://hotp/x?secret=MFRG", backupCodes: CODES }, matrice),
    ).toBeNull();
  });

  test("points et chemins internes : la liste fermée de la fiche", () => {
    expect(Object.keys(POINTS_DOUBLE_AUTH).sort()).toEqual([
      "/two-factor/confirm-enable",
      "/two-factor/disable",
      "/two-factor/enable",
      "/two-factor/generate-backup-codes",
      "/two-factor/replace",
      "/two-factor/verify-backup-code",
      "/two-factor/verify-totp",
    ]);
    expect([...CHEMINS_INTERNES_DOUBLE_AUTH].sort()).toEqual([
      "/two-factor/disable",
      "/two-factor/enable",
      "/two-factor/generate-backup-codes",
      "/two-factor/verify-backup-code",
      "/two-factor/verify-totp",
    ]);
  });
});

describe("traduction des réponses de Better Auth", () => {
  test.each([
    ["/two-factor/verify-totp", 401, "INVALID_CODE", 400, "code_incorrect"],
    ["/two-factor/verify-backup-code", 401, "INVALID_BACKUP_CODE", 400, "code_incorrect"],
    ["/two-factor/verify-backup-code", 409, "CONFLICT", 400, "code_incorrect"],
    ["/two-factor/verify-totp", 400, "TOTP_NOT_ENABLED", 400, "code_incorrect"],
    ["/two-factor/verify-totp", 401, "INVALID_TWO_FACTOR_COOKIE", 400, "connexion_expiree"],
    [
      "/two-factor/verify-totp",
      400,
      "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
      400,
      "connexion_expiree",
    ],
    ["/two-factor/verify-totp", 429, "ACCOUNT_TEMPORARILY_LOCKED", 429, "trop_de_requetes"],
    ["/two-factor/verify-backup-code", 429, "", 429, "trop_de_requetes"],
  ] as const)(
    "connexion, %s %i %s : %i %s, sans son message ni cookie",
    async (chemin, statut, code, attendu, raison) => {
      const journal = nouveauJournal();
      const corps =
        chemin === "/two-factor/verify-totp" ? { code: "123456" } : { code: "abcde-fghjk" };
      const recue = await gerer(journal, {
        betterAuth: {
          [chemin]: () =>
            reponse(statut, { code, message: "Message de Better Auth" }, [NOUVELLE_SESSION]),
        },
      })(post(chemin, corps));
      expect(recue.status).toBe(attendu);
      const texte = await recue.text();
      expect(texte).toBe(JSON.stringify({ ok: false, raison }));
      expect(recue.headers.getSetCookie()).toEqual([]);
    },
  );

  test.each([
    [500, "INTERNAL_SERVER_ERROR"],
    [400, "TOTP_ALREADY_ENABLED"],
    [400, "CODE_INCONNU"],
  ])("activation, Better Auth %i %s : erreur avec incident", async (statut, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      session: { utilisateurId: "u-a", doubleAuthentification: false, jeton: "jeton-a" },
      betterAuth: { "/two-factor/enable": () => reponse(statut, { code }) },
    })(post("/two-factor/enable", { motDePasse: MOT_DE_PASSE }));
    expect(recue.status).toBe(500);
    const lu = (await recue.json()) as Record<string, unknown>;
    expect(lu.raison).toBe("erreur");
    expect(lu.incident).toMatch(UUID);
  });

  test("gestion, Better Auth 400 INVALID_PASSWORD (mot de passe changé entre-temps) : mot_de_passe_incorrect", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      session: { utilisateurId: "u-a", doubleAuthentification: false, jeton: "jeton-a" },
      betterAuth: { "/two-factor/enable": () => reponse(400, { code: "INVALID_PASSWORD" }) },
    })(post("/two-factor/enable", { motDePasse: MOT_DE_PASSE }));
    expect(await recue.json()).toEqual({ ok: false, raison: "mot_de_passe_incorrect" });
  });

  test("exception d'une dépendance : erreur avec incident, une ligne [auth] sans valeur reçue", async () => {
    const lignes: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...v: unknown[]) => {
      lignes.push(v.map(String).join(" "));
    });
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      deps: {
        reserverTranche: async () => {
          throw new Error("panne avec le code 123456 et u-b");
        },
      },
    })(post("/two-factor/verify-totp", { code: "123456" }));
    expect(recue.status).toBe(500);
    const { incident } = (await recue.json()) as { incident: string };
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain(incident);
    expect(lignes.join()).not.toMatch(/123456|u-b|panne/u);
  });
});

describe("ordre des contrôles de la connexion (section 2.1)", () => {
  test("code de l'application : attente, limite par compte, tranche, Better Auth, puis révocation de l'ancienne session", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal)(post("/two-factor/verify-totp", { code: "123456" }));
    expect(recue.status).toBe(200);
    expect(journal.appels).toEqual([
      "utilisateurDuDefi",
      "limiterConnexion",
      "reserverTranche",
      'BA /two-factor/verify-totp {"code":"123456"}',
      "revoquerSession",
    ]);
  });

  test("l'attente est lue sous l'identifiant du cookie, l'utilisateur de l'attente est compté", async () => {
    const journal = nouveauJournal();
    const utilisateurDuDefi = vi.fn(async () => "u-b");
    const limiterConnexion = vi.fn(async () => true);
    const reserverTranche = vi.fn(async () => "reservee" as const);
    await gerer(journal, { deps: { utilisateurDuDefi, limiterConnexion, reserverTranche } })(
      post("/two-factor/verify-totp", { code: "654321" }),
    );
    expect(utilisateurDuDefi).toHaveBeenCalledWith("attente-b");
    expect(limiterConnexion).toHaveBeenCalledWith("u-b");
    expect(reserverTranche).toHaveBeenCalledWith("u-b", "654321");
  });

  test("attente inconnue ou expirée : connexion_expiree, rien d'autre", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, { deps: { utilisateurDuDefi: async () => null } })(
      post("/two-factor/verify-totp", { code: "123456" }),
    );
    expect(await recue.json()).toEqual({ ok: false, raison: "connexion_expiree" });
    expect(journal.appels).toEqual([]);
  });

  test("limite par compte atteinte : trop_de_requetes, alerte au titulaire, ni tranche ni Better Auth", async () => {
    const journal = nouveauJournal();
    const notifier = vi.fn();
    const recue = await gerer(journal, {
      deps: { limiterConnexion: async () => false, notifier },
    })(post("/two-factor/verify-totp", { code: "123456" }));
    expect(recue.status).toBe(429);
    expect(await recue.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(notifier).toHaveBeenCalledWith("compte.double_auth_tentatives", "u-b");
    expect(journal.appels.filter((a) => a.startsWith("BA ") || a === "reserverTranche")).toEqual(
      [],
    );
  });

  test("décision 4 : code déjà accepté (tranche refusée) : code_incorrect, Better Auth jamais appelé", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      deps: { reserverTranche: async () => "deja_utilisee" },
    })(post("/two-factor/verify-totp", { code: "123456" }));
    expect(recue.status).toBe(400);
    expect(await recue.json()).toEqual({ ok: false, raison: "code_incorrect" });
    expect(journal.appels.some((a) => a.startsWith("BA "))).toBe(false);
  });

  test("code faux (aucune tranche) : Better Auth appelé, qui compte l'échec", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      deps: { reserverTranche: async () => "aucune" },
      betterAuth: { "/two-factor/verify-totp": () => reponse(401, { code: "INVALID_CODE" }) },
    })(post("/two-factor/verify-totp", { code: "123456" }));
    expect(await recue.json()).toEqual({ ok: false, raison: "code_incorrect" });
    expect(journal.appels).toContain('BA /two-factor/verify-totp {"code":"123456"}');
    expect(journal.appels).not.toContain("revoquerSession");
  });

  test("code de secours : normalisé, son empreinte (jamais le code) envoyée ; aucune tranche ; notification", async () => {
    const journal = nouveauJournal();
    const notifier = vi.fn();
    const recue = await gerer(journal, { deps: { notifier } })(
      post("/two-factor/verify-backup-code", { code: " ABCDE fghjk " }),
    );
    expect(recue.status).toBe(200);
    expect(journal.appels).toEqual([
      "utilisateurDuDefi",
      "limiterConnexion",
      "empreinteCodeSecours",
      'BA /two-factor/verify-backup-code {"code":"cs1:e-abcde-fghjk"}',
      "revoquerSession",
    ]);
    expect(notifier).toHaveBeenCalledWith("compte.code_secours_utilise", "u-b");
  });

  test("code de secours faux : aucune notification, aucune révocation", async () => {
    const journal = nouveauJournal();
    const notifier = vi.fn();
    await gerer(journal, {
      deps: { notifier },
      betterAuth: {
        "/two-factor/verify-backup-code": () => reponse(401, { code: "INVALID_BACKUP_CODE" }),
      },
    })(post("/two-factor/verify-backup-code", { code: "abcde-fghjk" }));
    expect(notifier).not.toHaveBeenCalled();
    expect(journal.appels).not.toContain("revoquerSession");
  });

  test("révocation de l'ancienne session en échec : erreur avec incident, aucun cookie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      revoquer: async () => {
        throw new Error("panne");
      },
    })(post("/two-factor/verify-totp", { code: "123456" }));
    expect(recue.status).toBe(500);
    expect(recue.headers.getSetCookie()).toEqual([]);
  });
});

describe("ordre des contrôles de la gestion (section 2.1)", () => {
  const GESTION_AVEC_CODE = [
    "/two-factor/replace",
    "/two-factor/generate-backup-codes",
    "/two-factor/disable",
  ] as const;

  test("sans session : connexion_requise, rien d'autre", async () => {
    for (const chemin of [
      ...GESTION_AVEC_CODE,
      "/two-factor/enable",
      "/two-factor/confirm-enable",
    ]) {
      const journal = nouveauJournal();
      const corps =
        chemin === "/two-factor/enable"
          ? { motDePasse: MOT_DE_PASSE }
          : chemin === "/two-factor/confirm-enable"
            ? { code: "123456" }
            : { motDePasse: MOT_DE_PASSE, code: "123456" };
      const recue = await gerer(journal, { session: null })(post(chemin, corps));
      expect(recue.status, chemin).toBe(401);
      expect(await recue.json()).toEqual({ ok: false, raison: "connexion_requise" });
      expect(journal.appels).toEqual(["lireSession"]);
    }
  });

  test("désactivation : session, limite, état, rôle, mot de passe, code (tranche puis Better Auth), opération, sessions, email", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal)(
      post("/two-factor/disable", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(recue.status).toBe(200);
    expect(journal.appels).toEqual([
      "lireSession",
      "limiterGestion",
      "etatLigne",
      "aRoleExigeant",
      "motDePasseValide",
      "reserverTranche",
      'BA /two-factor/verify-totp {"code":"123456"}',
      `BA /two-factor/disable {"password":"${MOT_DE_PASSE}"}`,
      "revoquerAutresSessions",
      "notifier",
    ]);
  });

  test("limite de gestion atteinte : trop_de_requetes avant tout mot de passe ou code", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, { deps: { limiterGestion: async () => false } })(
      post("/two-factor/disable", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(await recue.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(journal.appels).toEqual(["lireSession", "limiterGestion"]);
  });

  test("désactivation par un Propriétaire ou un Comptable : double_authentification_obligatoire, mot de passe jamais vérifié", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, { deps: { aRoleExigeant: async () => true } })(
      post("/two-factor/disable", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(recue.status).toBe(403);
    expect(await recue.json()).toEqual({
      ok: false,
      raison: "double_authentification_obligatoire",
    });
    expect(journal.appels).not.toContain("motDePasseValide");
    expect(journal.appels.some((a) => a.startsWith("BA "))).toBe(false);
  });

  test.each(GESTION_AVEC_CODE)(
    "%s, mauvais mot de passe : mot_de_passe_incorrect, code jamais vérifié (un code de secours n'est pas brûlé)",
    async (chemin) => {
      const journal = nouveauJournal();
      const recue = await gerer(journal, { deps: { motDePasseValide: async () => false } })(
        post(chemin, { motDePasse: MOT_DE_PASSE, code: "abcde-fghjk" }),
      );
      expect(recue.status).toBe(400);
      expect(await recue.json()).toEqual({ ok: false, raison: "mot_de_passe_incorrect" });
      expect(journal.appels.some((a) => a.startsWith("BA "))).toBe(false);
      expect(journal.appels).not.toContain("empreinteCodeSecours");
    },
  );

  test.each(GESTION_AVEC_CODE)(
    "%s, code faux : code_incorrect, opération jamais appelée",
    async (chemin) => {
      const journal = nouveauJournal();
      const recue = await gerer(journal, {
        betterAuth: { "/two-factor/verify-totp": () => reponse(401, { code: "INVALID_CODE" }) },
      })(post(chemin, { motDePasse: MOT_DE_PASSE, code: "123456" }));
      expect(await recue.json()).toEqual({ ok: false, raison: "code_incorrect" });
      expect(journal.appels.filter((a) => a.startsWith("BA "))).toEqual([
        'BA /two-factor/verify-totp {"code":"123456"}',
      ]);
      expect(journal.appels).not.toContain("preparerRemplacement");
    },
  );

  test.each(GESTION_AVEC_CODE)(
    "%s, code de l'application déjà accepté : code_incorrect, Better Auth jamais appelé",
    async (chemin) => {
      const journal = nouveauJournal();
      const recue = await gerer(journal, {
        deps: { reserverTranche: async () => "deja_utilisee" },
      })(post(chemin, { motDePasse: MOT_DE_PASSE, code: "123456" }));
      expect(await recue.json()).toEqual({ ok: false, raison: "code_incorrect" });
      expect(journal.appels.some((a) => a.startsWith("BA "))).toBe(false);
    },
  );

  test("code de secours en gestion : son empreinte vérifiée par Better Auth (consommé), sans tranche", async () => {
    const journal = nouveauJournal();
    await gerer(journal)(
      post("/two-factor/generate-backup-codes", { motDePasse: MOT_DE_PASSE, code: "abcde-fghjk" }),
    );
    expect(journal.appels).not.toContain("reserverTranche");
    expect(journal.appels).toContain(
      'BA /two-factor/verify-backup-code {"code":"cs1:e-abcde-fghjk"}',
    );
  });

  test("remplacement : préparation seulement après mot de passe et code justes, puis activation", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal)(
      post("/two-factor/replace", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(recue.status).toBe(200);
    const suite = journal.appels.filter((a) => a.startsWith("BA ") || a === "preparerRemplacement");
    expect(suite).toEqual([
      'BA /two-factor/verify-totp {"code":"123456"}',
      "preparerRemplacement",
      `BA /two-factor/enable {"password":"${MOT_DE_PASSE}","method":"totp"}`,
    ]);
    // Le remplacement n'est confirmé (sessions, email) qu'au code de la
    // nouvelle application.
    expect(journal.appels).not.toContain("revoquerAutresSessions");
    expect(journal.appels).not.toContain("notifier");
  });

  test("activation : mot de passe vérifié avant Better Auth ; corps interne { password, method: totp }", async () => {
    const journal = nouveauJournal();
    await gerer(journal, {
      session: { utilisateurId: "u-a", doubleAuthentification: false, jeton: "jeton-a" },
    })(post("/two-factor/enable", { motDePasse: MOT_DE_PASSE }));
    expect(journal.appels).toEqual([
      "lireSession",
      "limiterGestion",
      "etatLigne",
      "motDePasseValide",
      `BA /two-factor/enable {"password":"${MOT_DE_PASSE}","method":"totp"}`,
      "matriceQr",
    ]);
  });

  test("états : activer un compte déjà protégé, confirmer sans activation en cours, gérer sans second facteur : refuse", async () => {
    const cas: [string, unknown, SessionGestion, DependancesDoubleAuth["etatLigne"]][] = [
      [
        "/two-factor/enable",
        { motDePasse: MOT_DE_PASSE },
        { utilisateurId: "u", doubleAuthentification: true, jeton: "j" },
        async () => "active",
      ],
      [
        "/two-factor/confirm-enable",
        { code: "123456" },
        { utilisateurId: "u", doubleAuthentification: true, jeton: "j" },
        async () => "active",
      ],
      [
        "/two-factor/confirm-enable",
        { code: "123456" },
        { utilisateurId: "u", doubleAuthentification: false, jeton: "j" },
        async () => "aucune",
      ],
      [
        "/two-factor/disable",
        { motDePasse: MOT_DE_PASSE, code: "123456" },
        { utilisateurId: "u", doubleAuthentification: false, jeton: "j" },
        async () => "aucune",
      ],
      [
        "/two-factor/replace",
        { motDePasse: MOT_DE_PASSE, code: "123456" },
        { utilisateurId: "u", doubleAuthentification: false, jeton: "j" },
        async () => "a_confirmer",
      ],
      [
        "/two-factor/generate-backup-codes",
        { motDePasse: MOT_DE_PASSE, code: "123456" },
        { utilisateurId: "u", doubleAuthentification: false, jeton: "j" },
        async () => "aucune",
      ],
    ];
    for (const [chemin, corps, session, etatLigne] of cas) {
      const journal = nouveauJournal();
      const recue = await gerer(journal, { session, deps: { etatLigne } })(post(chemin, corps));
      expect(await recue.json(), chemin).toEqual({ ok: false, raison: "refuse" });
      expect(
        journal.appels.some((a) => a.startsWith("BA ")),
        chemin,
      ).toBe(false);
      expect(journal.appels, chemin).not.toContain("motDePasseValide");
    }
  });
});

describe("après le succès : sessions et emails (sections 8 et 10)", () => {
  test("activation confirmée : autres sessions fermées en gardant la session neuve ; email d'activation", async () => {
    const journal = nouveauJournal();
    const revoquerAutresSessions = vi.fn(async () => {});
    const notifier = vi.fn();
    const recue = await gerer(journal, {
      session: { utilisateurId: "u-a", doubleAuthentification: false, jeton: "jeton-a" },
      deps: { revoquerAutresSessions, notifier },
    })(post("/two-factor/confirm-enable", { code: "123456" }));
    expect(recue.status).toBe(200);
    expect(revoquerAutresSessions).toHaveBeenCalledWith("u-a", "jeton-neuf");
    expect(notifier).toHaveBeenCalledWith("compte.double_auth_activee", "u-a");
  });

  test("remplacement confirmé (second facteur déjà actif, aucun cookie neuf) : la session reçue est gardée ; email de remplacement", async () => {
    const journal = nouveauJournal();
    const revoquerAutresSessions = vi.fn(async () => {});
    const notifier = vi.fn();
    await gerer(journal, {
      session: { utilisateurId: "u-a", doubleAuthentification: true, jeton: "jeton-a" },
      deps: { revoquerAutresSessions, notifier, etatLigne: async () => "a_confirmer" },
      betterAuth: { "/two-factor/verify-totp": () => reponse(200, { token: "jeton-a", user: {} }) },
    })(post("/two-factor/confirm-enable", { code: "123456" }));
    expect(revoquerAutresSessions).toHaveBeenCalledWith("u-a", "jeton-a");
    expect(notifier).toHaveBeenCalledWith("compte.double_auth_remplacee", "u-a");
  });

  test("désactivation : autres sessions fermées en gardant la session neuve ; email de désactivation", async () => {
    const journal = nouveauJournal();
    const revoquerAutresSessions = vi.fn(async () => {});
    const notifier = vi.fn();
    await gerer(journal, { deps: { revoquerAutresSessions, notifier } })(
      post("/two-factor/disable", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(revoquerAutresSessions).toHaveBeenCalledWith("u-a", "jeton-neuf");
    expect(notifier).toHaveBeenCalledWith("compte.double_auth_desactivee", "u-a");
  });

  test("nouveaux codes : aucune session touchée ; email des nouveaux codes", async () => {
    const journal = nouveauJournal();
    const revoquerAutresSessions = vi.fn(async () => {});
    const notifier = vi.fn();
    await gerer(journal, { deps: { revoquerAutresSessions, notifier } })(
      post("/two-factor/generate-backup-codes", { motDePasse: MOT_DE_PASSE, code: "123456" }),
    );
    expect(revoquerAutresSessions).not.toHaveBeenCalled();
    expect(notifier).toHaveBeenCalledWith("compte.codes_secours_regeneres", "u-a");
  });

  test("fermeture des autres sessions en échec : erreur avec incident, aucun cookie, aucun email", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const journal = nouveauJournal();
    const notifier = vi.fn();
    const recue = await gerer(journal, {
      deps: {
        notifier,
        revoquerAutresSessions: async () => {
          throw new Error("panne");
        },
      },
    })(post("/two-factor/disable", { motDePasse: MOT_DE_PASSE, code: "123456" }));
    expect(recue.status).toBe(500);
    expect(recue.headers.getSetCookie()).toEqual([]);
    expect(notifier).not.toHaveBeenCalled();
  });

  test("une notification qui lève ne change pas la réponse", async () => {
    const journal = nouveauJournal();
    const recue = await gerer(journal, {
      deps: {
        notifier: () => {
          throw new Error("planification impossible");
        },
      },
    })(post("/two-factor/generate-backup-codes", { motDePasse: MOT_DE_PASSE, code: "123456" }));
    expect(recue.status).toBe(200);
  });
});
