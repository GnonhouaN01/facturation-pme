import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { dependancesProfilInertes } from "../db/outils-test/profil";

import type { DependancesDoubleAuth, EtatLigne } from "./double-authentification";
import type {
  DependancesNouvelleAuthentification,
  SessionNouvelleAuthentification,
} from "./nouvelle-authentification";
import { creerTraitementAuth, reponseInexistante } from "./points-entree";

// Tests d'attaque du point de la nouvelle authentification (1.6),
// POST /api/auth/verify-password composé par notre passerelle : comptes
// fermés en production, origine (S-81), entrée falsifiée, sans session,
// limite par utilisateur avant le mot de passe (T-01), ordre des contrôles,
// aucune preuve posée sur un refus, preuve liée à la session de la requête,
// anti-rejeu du code, remplacement du second facteur en cours, corps de
// Better Auth jamais transmis, journal sans secret. Better Auth et toutes les
// dépendances sont des espions. Fiche :
// docs/features/nouvelle-authentification.md, section 2, test 2.

const ORIGINE = "http://localhost:3000";
const CHEMIN = "/verify-password";
const URL_POINT = `${ORIGINE}/api/auth${CHEMIN}`;
const SESSION = "better-auth.session_token";
const COOKIE_RECU = [
  `${SESSION}=jeton-session-a.signature-a`,
  "better-auth.two_factor=attente-b.signature-b",
  "autre=valeur",
].join("; ");

const MOT_DE_PASSE = "phrase-de-passe-du-titulaire";
const CODE = "123456";
const CODE_SECOURS = "abcde-fghjk";
const ID_SESSION = "0b6f3c1e-6d1f-4f5e-9a63-2a4b7c8d9e10";
const ID_UTILISATEUR = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const SESSION_AVEC_CODE: SessionNouvelleAuthentification = {
  utilisateurId: ID_UTILISATEUR,
  sessionId: ID_SESSION,
  doubleAuthentification: true,
  jeton: "jeton-session-a",
};

let etapes: string[];

beforeEach(() => {
  etapes = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Better Auth : le code vérifié avec la session répond le jeton et
// l'utilisateur, jamais transmis.
function betterAuthReussit(): Response {
  return new Response(
    JSON.stringify({ token: "jeton-session-a", user: { id: ID_UTILISATEUR, name: "Awa" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function betterAuthRefuse(code: string, statut = 401): () => Response {
  return () =>
    new Response(JSON.stringify({ code, message: "message de Better Auth" }), {
      status: statut,
      headers: { "content-type": "application/json" },
    });
}

function fausseNouvelleAuth(session: SessionNouvelleAuthentification | null) {
  return {
    lireSession: vi.fn<DependancesNouvelleAuthentification["lireSession"]>(async () => {
      etapes.push("session");
      return session;
    }),
    limiter: vi.fn<DependancesNouvelleAuthentification["limiter"]>(async () => {
      etapes.push("limite");
      return true;
    }),
    motDePasseValide: vi.fn<DependancesNouvelleAuthentification["motDePasseValide"]>(async () => {
      etapes.push("mot_de_passe");
      return true;
    }),
    enregistrerPreuve: vi.fn<DependancesNouvelleAuthentification["enregistrerPreuve"]>(async () => {
      etapes.push("preuve");
    }),
  };
}

// La double authentification : seules l'état de la ligne, la tranche, l'empreinte
// d'un code de secours et l'email servent ; toute autre dépendance lève.
function fausseDoubleAuth(etat: EtatLigne) {
  const inattendue = () => {
    throw new Error("dépendance de double authentification inattendue");
  };
  const espions = {
    etatLigne: vi.fn<DependancesDoubleAuth["etatLigne"]>(async () => {
      etapes.push("etat");
      return etat;
    }),
    reserverTranche: vi.fn<DependancesDoubleAuth["reserverTranche"]>(async () => {
      etapes.push("tranche");
      return "reservee";
    }),
    empreinteCodeSecours: vi.fn<DependancesDoubleAuth["empreinteCodeSecours"]>(
      (code) => `empreinte-${code}`,
    ),
    notifier: vi.fn<DependancesDoubleAuth["notifier"]>(() => {}),
  };
  const dependances: DependancesDoubleAuth = {
    lireSession: async () => inattendue(),
    utilisateurDuDefi: async () => inattendue(),
    limiterConnexion: async () => inattendue(),
    limiterGestion: async () => inattendue(),
    motDePasseValide: async () => inattendue(),
    aRoleExigeant: async () => inattendue(),
    preparerRemplacement: async () => inattendue(),
    revoquerAutresSessions: async () => inattendue(),
    matriceQr: () => inattendue(),
    ...espions,
  };
  return { dependances, espions };
}

function traitement(
  options: {
    estProduction?: boolean;
    session?: SessionNouvelleAuthentification | null;
    etat?: EtatLigne;
    reponse?: () => Response;
  } = {},
) {
  const appels: Request[] = [];
  const traiter = vi.fn(async (requete: Request) => {
    etapes.push("better_auth");
    appels.push(requete.clone());
    return (options.reponse ?? betterAuthReussit)();
  });
  const nouvelleAuth = fausseNouvelleAuth(
    options.session === undefined ? SESSION_AVEC_CODE : options.session,
  );
  const doubleAuth = fausseDoubleAuth(options.etat ?? "active");
  const gerer = creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: options.estProduction ?? false,
    limiterCompte: async () => true,
    sessionEncoreLisible: async () => false,
    revoquerSession: async () => {},
    limiterReinitialisation: async () => true,
    jetonReinitialisationValide: async () => true,
    motDePasseCompromis: async () => false,
    doubleAuth: doubleAuth.dependances,
    profil: dependancesProfilInertes(),
    nouvelleAuthentification: nouvelleAuth,
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
  return { gerer, traiter, appels, nouvelleAuth, doubleAuth: doubleAuth.espions };
}

const ENTETES: Record<string, string> = {
  "content-type": "application/json",
  origin: ORIGINE,
  cookie: COOKIE_RECU,
  "x-forwarded-for": "203.0.113.7",
};

function post(corps: unknown, entetes: Record<string, string> = ENTETES): Request {
  return new Request(URL_POINT, {
    method: "POST",
    headers: entetes,
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

async function lire(reponse: Response) {
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

type Espions = ReturnType<typeof traitement>;

function rienPose(espions: Espions) {
  expect(espions.nouvelleAuth.enregistrerPreuve).not.toHaveBeenCalled();
}

function rienAppele(espions: Espions) {
  for (const [nom, espion] of Object.entries(espions.nouvelleAuth)) {
    expect(espion, nom).not.toHaveBeenCalled();
  }
  for (const [nom, espion] of Object.entries(espions.doubleAuth)) {
    expect(espion, nom).not.toHaveBeenCalled();
  }
  expect(espions.traiter).not.toHaveBeenCalled();
}

const CORPS = { motDePasse: MOT_DE_PASSE, code: CODE };

describe("comptes fermés en production, méthode, origine (T-55, S-81)", () => {
  test("en production : réponse inexistante, octet pour octet, rien n'est appelé", async () => {
    const espions = traitement({ estProduction: true });
    const recue = await espions.gerer(post(CORPS));
    const attendue = reponseInexistante();
    expect(recue.status).toBe(attendue.status);
    expect([...recue.headers.entries()]).toEqual([...attendue.headers.entries()]);
    expect(await recue.text()).toBe(await attendue.text());
    rienAppele(espions);
  });

  test("témoin hors production : le point répond", async () => {
    const { gerer } = traitement();
    expect(await lire(await gerer(post(CORPS)))).toEqual({ statut: 200, corps: { ok: true } });
  });

  test("en GET : réponse inexistante", async () => {
    const espions = traitement();
    const recue = await espions.gerer(new Request(URL_POINT, { headers: { origin: ORIGINE } }));
    expect(recue.status).toBe(404);
    expect(await recue.text()).toBe("");
    rienAppele(espions);
  });

  test.each([
    ["sans Origin", { "content-type": "application/json", cookie: COOKIE_RECU }],
    [
      "Origin étrangère",
      {
        "content-type": "application/json",
        cookie: COOKIE_RECU,
        origin: "https://exemple.invalid",
      },
    ],
    ["Origin null", { "content-type": "application/json", cookie: COOKIE_RECU, origin: "null" }],
    ["Sec-Fetch-Site cross-site", { ...ENTETES, "sec-fetch-site": "cross-site" }],
  ])("%s : refuse, rien n'est appelé", async (_nom, entetes) => {
    const espions = traitement();
    expect(await lire(await espions.gerer(post(CORPS, entetes)))).toEqual({
      statut: 403,
      corps: { ok: false, raison: "refuse" },
    });
    rienAppele(espions);
  });
});

describe("entrée falsifiée : refusée avant toute dépendance", () => {
  test.each([
    ["password (nom de Better Auth)", { password: MOT_DE_PASSE, code: CODE }],
    ["mot de passe absent", { code: CODE }],
    ["mot de passe vide", { motDePasse: "", code: CODE }],
    ["mot de passe de 129 caractères", { motDePasse: "x".repeat(129), code: CODE }],
    ["code non texte", { motDePasse: MOT_DE_PASSE, code: 123456 }],
    ["code de 21 caractères", { motDePasse: MOT_DE_PASSE, code: "1".repeat(21) }],
    ["session désignée", { ...CORPS, session: ID_SESSION }],
    ["utilisateur désigné", { ...CORPS, utilisateurId: ID_UTILISATEUR }],
    ["durée demandée", { ...CORPS, duree: 3600 }],
    ["trustDevice", { ...CORPS, trustDevice: true }],
    ["JSON invalide", "{motDePasse"],
  ])("%s : invalide", async (_nom, corps) => {
    const espions = traitement();
    expect(await lire(await espions.gerer(post(corps)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "invalide" },
    });
    rienAppele(espions);
  });
});

describe("sans session valable : connexion_requise, rien n'est compté ni posé", () => {
  test("sans cookie de session", async () => {
    const espions = traitement();
    const { cookie: _cookie, ...sansCookie } = ENTETES;
    void _cookie;
    expect(
      await lire(await espions.gerer(post(CORPS, { ...sansCookie, cookie: "autre=1" }))),
    ).toEqual({
      statut: 401,
      corps: { ok: false, raison: "connexion_requise" },
    });
    expect(espions.nouvelleAuth.limiter).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("cookie forgé, session expirée ou inconnue (lecture nulle)", async () => {
    const espions = traitement({ session: null });
    expect(await lire(await espions.gerer(post(CORPS)))).toEqual({
      statut: 401,
      corps: { ok: false, raison: "connexion_requise" },
    });
    expect(espions.nouvelleAuth.limiter).not.toHaveBeenCalled();
    expect(espions.nouvelleAuth.motDePasseValide).not.toHaveBeenCalled();
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });
});

describe("T-01 : limite par utilisateur, avant le mot de passe", () => {
  test("limite atteinte : trop_de_requetes, ni mot de passe ni code vérifiés, rien posé", async () => {
    const espions = traitement();
    espions.nouvelleAuth.limiter.mockResolvedValueOnce(false);
    expect(await lire(await espions.gerer(post(CORPS)))).toEqual({
      statut: 429,
      corps: { ok: false, raison: "trop_de_requetes" },
    });
    expect(espions.nouvelleAuth.limiter).toHaveBeenCalledWith(ID_UTILISATEUR);
    expect(espions.nouvelleAuth.motDePasseValide).not.toHaveBeenCalled();
    expect(espions.doubleAuth.reserverTranche).not.toHaveBeenCalled();
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("un essai refusé (mot de passe faux) est compté", async () => {
    const espions = traitement();
    espions.nouvelleAuth.motDePasseValide.mockResolvedValueOnce(false);
    await espions.gerer(post(CORPS));
    expect(espions.nouvelleAuth.limiter).toHaveBeenCalledTimes(1);
  });
});

describe("forme du code selon le second facteur", () => {
  test.each([
    ["second facteur actif, code absent", SESSION_AVEC_CODE, { motDePasse: MOT_DE_PASSE }],
    [
      "second facteur actif, code ni de l'application ni de secours",
      SESSION_AVEC_CODE,
      { motDePasse: MOT_DE_PASSE, code: "12345" },
    ],
    [
      "second facteur inactif, code présent",
      { ...SESSION_AVEC_CODE, doubleAuthentification: false },
      CORPS,
    ],
  ])("%s : invalide, mot de passe non vérifié, rien posé", async (_nom, session, corps) => {
    const espions = traitement({ session });
    expect(await lire(await espions.gerer(post(corps)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "invalide" },
    });
    expect(espions.nouvelleAuth.motDePasseValide).not.toHaveBeenCalled();
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("remplacement du second facteur en cours : refuse, code jamais vérifié, rien posé", async () => {
    const espions = traitement({ etat: "a_confirmer" });
    expect(await lire(await espions.gerer(post(CORPS)))).toEqual({
      statut: 403,
      corps: { ok: false, raison: "refuse" },
    });
    expect(espions.doubleAuth.reserverTranche).not.toHaveBeenCalled();
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });
});

describe("mot de passe, puis code : aucune preuve sur un refus", () => {
  test("mot de passe faux : mot_de_passe_incorrect, code non vérifié", async () => {
    const espions = traitement();
    espions.nouvelleAuth.motDePasseValide.mockResolvedValueOnce(false);
    expect(await lire(await espions.gerer(post(CORPS)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "mot_de_passe_incorrect" },
    });
    expect(espions.nouvelleAuth.motDePasseValide).toHaveBeenCalledWith(
      ID_UTILISATEUR,
      MOT_DE_PASSE,
    );
    expect(espions.doubleAuth.reserverTranche).not.toHaveBeenCalled();
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("code faux chez Better Auth : code_incorrect, message jamais transmis", async () => {
    const espions = traitement({ reponse: betterAuthRefuse("INVALID_CODE") });
    const recue = await espions.gerer(post(CORPS));
    const texte = await recue.text();
    expect(recue.status).toBe(400);
    expect(JSON.parse(texte)).toEqual({ ok: false, raison: "code_incorrect" });
    expect(texte).not.toContain("message de Better Auth");
    rienPose(espions);
  });

  test("code de l'application rejoué (tranche déjà utilisée) : code_incorrect, Better Auth non appelé", async () => {
    const espions = traitement();
    espions.doubleAuth.reserverTranche.mockResolvedValueOnce("deja_utilisee");
    expect(await lire(await espions.gerer(post(CORPS)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "code_incorrect" },
    });
    expect(espions.traiter).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("code de secours inconnu : code_incorrect, rien posé, aucun email", async () => {
    const espions = traitement({ reponse: betterAuthRefuse("INVALID_BACKUP_CODE") });
    expect(
      await lire(await espions.gerer(post({ motDePasse: MOT_DE_PASSE, code: CODE_SECOURS }))),
    ).toEqual({ statut: 400, corps: { ok: false, raison: "code_incorrect" } });
    expect(espions.doubleAuth.notifier).not.toHaveBeenCalled();
    rienPose(espions);
  });

  test("limite par adresse IP de Better Auth sur le code : trop_de_requetes, rien posé", async () => {
    const espions = traitement({ reponse: betterAuthRefuse("TOO_MANY_REQUESTS", 429) });
    expect((await espions.gerer(post(CORPS))).status).toBe(429);
    rienPose(espions);
  });
});

describe("succès : preuve posée pour la session de la requête", () => {
  test("code de l'application : ordre des contrôles, appel interne, réponse sans cookie ni corps de Better Auth", async () => {
    const espions = traitement();
    const recue = await espions.gerer(post(CORPS));
    const texte = await recue.text();

    expect(recue.status).toBe(200);
    expect(JSON.parse(texte)).toEqual({ ok: true });
    expect(recue.headers.getSetCookie()).toEqual([]);
    expect(texte).not.toContain("jeton-session-a");
    expect(etapes).toEqual([
      "session",
      "limite",
      "etat",
      "mot_de_passe",
      "tranche",
      "better_auth",
      "preuve",
    ]);
    expect(espions.nouvelleAuth.enregistrerPreuve).toHaveBeenCalledTimes(1);
    expect(espions.nouvelleAuth.enregistrerPreuve).toHaveBeenCalledWith(ID_UTILISATEUR, ID_SESSION);
    expect(espions.doubleAuth.reserverTranche).toHaveBeenCalledWith(ID_UTILISATEUR, CODE);

    const [appel] = espions.appels;
    expect(new URL(appel?.url ?? "").pathname).toBe("/api/auth/two-factor/verify-totp");
    expect(await appel?.json()).toEqual({ code: CODE });
    // Le seul cookie de session : ni l'attente de connexion, ni un autre.
    expect(appel?.headers.get("cookie")).toBe(`${SESSION}=jeton-session-a.signature-a`);
  });

  test("code de secours : son empreinte seule part vers Better Auth ; preuve posée ; email", async () => {
    const espions = traitement();
    const recue = await espions.gerer(post({ motDePasse: MOT_DE_PASSE, code: "ABCDE FGHJK" }));
    expect(await lire(recue)).toEqual({ statut: 200, corps: { ok: true } });
    const [appel] = espions.appels;
    expect(new URL(appel?.url ?? "").pathname).toBe("/api/auth/two-factor/verify-backup-code");
    expect(await appel?.json()).toEqual({ code: `empreinte-${CODE_SECOURS}` });
    expect(espions.doubleAuth.reserverTranche).not.toHaveBeenCalled();
    expect(espions.doubleAuth.notifier).toHaveBeenCalledWith(
      "compte.code_secours_utilise",
      ID_UTILISATEUR,
    );
    expect(espions.nouvelleAuth.enregistrerPreuve).toHaveBeenCalledWith(ID_UTILISATEUR, ID_SESSION);
  });

  test("second facteur inactif : mot de passe seul, Better Auth jamais appelé", async () => {
    const espions = traitement({
      session: { ...SESSION_AVEC_CODE, doubleAuthentification: false },
    });
    expect(await lire(await espions.gerer(post({ motDePasse: MOT_DE_PASSE })))).toEqual({
      statut: 200,
      corps: { ok: true },
    });
    expect(espions.traiter).not.toHaveBeenCalled();
    expect(espions.doubleAuth.etatLigne).not.toHaveBeenCalled();
    expect(espions.nouvelleAuth.enregistrerPreuve).toHaveBeenCalledWith(ID_UTILISATEUR, ID_SESSION);
  });

  test("la preuve vient de la session lue, jamais d'une valeur reçue", async () => {
    const espions = traitement();
    await espions.gerer(post(CORPS));
    expect(espions.nouvelleAuth.lireSession).toHaveBeenCalledTimes(1);
    const [entetes] = espions.nouvelleAuth.lireSession.mock.calls[0] ?? [];
    expect(entetes?.get("cookie")).toBe(COOKIE_RECU);
  });
});

describe("pannes et journal (S-85, T-39)", () => {
  test("preuve impossible à poser : erreur avec incident", async () => {
    const espions = traitement();
    espions.nouvelleAuth.enregistrerPreuve.mockRejectedValueOnce(new Error("panne"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { statut, corps } = await lire(await espions.gerer(post(CORPS)));
    expect(statut).toBe(500);
    expect(corps).toEqual({ ok: false, raison: "erreur", incident: expect.any(String) });
  });

  test("ni mot de passe, ni code, ni session, ni jeton dans le journal technique", async () => {
    const journal = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    const succes = traitement();
    // Témoins : chaque passage atteint bien le point (sans eux, un point
    // absent passerait à vide).
    expect((await succes.gerer(post(CORPS))).status).toBe(200);
    const panne = traitement();
    panne.nouvelleAuth.enregistrerPreuve.mockRejectedValueOnce(
      new Error(`${MOT_DE_PASSE} ${CODE} ${ID_SESSION}`),
    );
    expect((await panne.gerer(post(CORPS))).status).toBe(500);
    const faux = traitement({ reponse: betterAuthRefuse("INVALID_BACKUP_CODE") });
    expect((await faux.gerer(post({ motDePasse: MOT_DE_PASSE, code: CODE_SECOURS }))).status).toBe(
      400,
    );

    const ecrit = inspect(
      journal.map((espion) => espion.mock.calls),
      { depth: Infinity },
    );
    for (const secret of [MOT_DE_PASSE, CODE, CODE_SECOURS, ID_SESSION, "jeton-session-a"]) {
      expect(ecrit).not.toContain(secret);
    }
  });
});
