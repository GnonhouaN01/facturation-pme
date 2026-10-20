import { afterEach, describe, expect, test, vi } from "vitest";

import { dependancesDoubleAuthInertes } from "../db/outils-test/double-auth";

import { creerTraitementAuth, reponseInexistante } from "./points-entree";
import type { DependancesProfil, SessionProfil } from "./profil";

// Tests d'attaque des quatre points du profil et des sessions (1.5) :
// comptes fermés en production, origine (S-81), entrée falsifiée, sans
// session, autre compte (seules les sessions de l'utilisateur de la session
// sont touchées, même réponse quand rien ne l'est), ordre des contrôles du
// changement du mot de passe, corps de Better Auth jamais transmis (S-82),
// fermeture des autres sessions vérifiée, journal sans secret. Better Auth et
// toutes les dépendances sont des espions. Fiche :
// docs/features/profil-sessions.md, tests 2 à 5 et 10.

const ORIGINE = "http://localhost:3000";
const BASE = `${ORIGINE}/api/auth`;
const SESSION = "better-auth.session_token";
const COOKIE_RECU = [
  `${SESSION}=jeton-session-a.signature-a`,
  "better-auth.two_factor=attente-b.signature-b",
  "better-auth.dont_remember=true.signature",
  "autre=valeur",
].join("; ");

const ID_SESSION = "0b6f3c1e-6d1f-4f5e-9a63-2a4b7c8d9e10";
const MOT_DE_PASSE_ACTUEL = "phrase-actuelle-tres-longue";
const NOUVEAU_MOT_DE_PASSE = "nouvelle-phrase-tres-longue";

const CORPS: Readonly<Record<string, Record<string, unknown>>> = {
  "/revoke-session": { session: ID_SESSION },
  "/revoke-other-sessions": {},
  "/change-password": {
    motDePasseActuel: MOT_DE_PASSE_ACTUEL,
    nouveauMotDePasse: NOUVEAU_MOT_DE_PASSE,
  },
  "/update-user": { nom: "  Awa Koné  " },
};
const CHEMINS = Object.keys(CORPS);

// Succès de /change-password chez Better Auth : le jeton et l'utilisateur
// dans le corps (jamais transmis), le cookie de la session neuve, et des
// cookies que la passerelle ne transmet pas.
function betterAuthReussit(): Response {
  const entetes = new Headers({ "content-type": "application/json" });
  entetes.append(
    "set-cookie",
    `${SESSION}=jeton-neuf.signature-neuve; Path=/; HttpOnly; SameSite=Lax`,
  );
  entetes.append("set-cookie", "better-auth.session_data=donnees; Path=/");
  entetes.append("set-cookie", "better-auth.dont_remember=; Max-Age=0; Path=/");
  return new Response(
    JSON.stringify({
      token: "jeton-neuf",
      user: { id: "u-a", email: "awa@exemple.invalid", name: "Awa" },
    }),
    { status: 200, headers: entetes },
  );
}

function reponse(statut: number, corps: unknown, cookies: string[] = []) {
  return () => {
    const entetes = new Headers({ "content-type": "application/json" });
    for (const cookie of cookies) entetes.append("set-cookie", cookie);
    return new Response(JSON.stringify(corps), { status: statut, headers: entetes });
  };
}

function fauxProfil(
  session: SessionProfil | null = { utilisateurId: "u-a", jeton: "jeton-session-a" },
) {
  return {
    lireSession: vi.fn<DependancesProfil["lireSession"]>(async () => session),
    limiterProfil: vi.fn<DependancesProfil["limiterProfil"]>(async () => true),
    limiterMotDePasse: vi.fn<DependancesProfil["limiterMotDePasse"]>(async () => true),
    motDePasseValide: vi.fn<DependancesProfil["motDePasseValide"]>(async () => true),
    motDePasseCompromis: vi.fn<DependancesProfil["motDePasseCompromis"]>(async () => false),
    revoquerSessionDe: vi.fn<DependancesProfil["revoquerSessionDe"]>(async () => {}),
    revoquerAutresSessions: vi.fn<DependancesProfil["revoquerAutresSessions"]>(async () => {}),
    supprimerJetonsReinitialisation: vi.fn<DependancesProfil["supprimerJetonsReinitialisation"]>(
      async () => {},
    ),
    modifierNom: vi.fn<DependancesProfil["modifierNom"]>(async () => {}),
    notifier: vi.fn<DependancesProfil["notifier"]>(() => {}),
  };
}

type FauxProfil = ReturnType<typeof fauxProfil>;

function traitement(
  options: {
    estProduction?: boolean;
    session?: SessionProfil | null;
    reponse?: () => Response;
    profil?: (faux: FauxProfil) => void;
  } = {},
) {
  const appels: Request[] = [];
  const traiter = vi.fn(async (requete: Request) => {
    appels.push(requete.clone());
    return (options.reponse ?? betterAuthReussit)();
  });
  const profil = fauxProfil(options.session === undefined ? undefined : options.session);
  options.profil?.(profil);
  const revoquerSession = vi.fn(async () => {});
  const motDePasseCompromisReinitialisation = vi.fn(async () => false);
  const gerer = creerTraitementAuth({
    traiter,
    origine: ORIGINE,
    estProduction: options.estProduction ?? false,
    limiterCompte: async () => true,
    sessionEncoreLisible: async () => false,
    revoquerSession,
    limiterReinitialisation: async () => true,
    jetonReinitialisationValide: async () => true,
    motDePasseCompromis: motDePasseCompromisReinitialisation,
    doubleAuth: dependancesDoubleAuthInertes(),
    profil,
    horloge: { maintenant: () => 0, attendre: async () => {} },
  });
  return { gerer, traiter, appels, profil, revoquerSession };
}

function post(
  chemin: string,
  corps: unknown,
  entetes: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    cookie: COOKIE_RECU,
    "x-forwarded-for": "203.0.113.7",
    "user-agent": "Navigateur d'essai",
  },
  suffixe = "",
): Request {
  return new Request(`${BASE}${chemin}${suffixe}`, {
    method: "POST",
    headers: entetes,
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

function aucuneDependanceAppelee(profil: FauxProfil) {
  for (const [nom, espion] of Object.entries(profil)) {
    expect(espion, nom).not.toHaveBeenCalled();
  }
}

async function lire(reponse: Response) {
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("comptes fermés en production (décision 1 de la 1.1)", () => {
  test.each(CHEMINS)(
    "%s : réponse inexistante, octet pour octet, rien n'est appelé",
    async (chemin) => {
      const { gerer, traiter, profil } = traitement({ estProduction: true });
      const recue = await gerer(post(chemin, CORPS[chemin]));
      const attendue = reponseInexistante();
      expect(recue.status).toBe(attendue.status);
      expect([...recue.headers.entries()]).toEqual([...attendue.headers.entries()]);
      expect(await recue.text()).toBe(await attendue.text());
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(profil);
    },
  );

  test.each(CHEMINS)("%s : témoin hors production, le point répond", async (chemin) => {
    const { gerer } = traitement();
    expect((await gerer(post(chemin, CORPS[chemin]))).status).toBe(200);
  });

  test.each(CHEMINS)("%s : en GET, réponse inexistante", async (chemin) => {
    const { gerer, traiter, profil } = traitement();
    const recue = await gerer(new Request(`${BASE}${chemin}`, { headers: { origin: ORIGINE } }));
    expect(recue.status).toBe(404);
    expect(await recue.text()).toBe("");
    expect(traiter).not.toHaveBeenCalled();
    aucuneDependanceAppelee(profil);
  });
});

describe("S-81 : origine des POST", () => {
  const ORIGINES: ReadonlyArray<[string, Record<string, string>]> = [
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
    [
      "Sec-Fetch-Site cross-site",
      {
        "content-type": "application/json",
        cookie: COOKIE_RECU,
        origin: ORIGINE,
        "sec-fetch-site": "cross-site",
      },
    ],
  ];

  for (const chemin of CHEMINS) {
    test.each(ORIGINES)(`${chemin} : %s, refuse, rien n'est appelé`, async (_nom, entetes) => {
      const { gerer, traiter, profil } = traitement();
      expect(await lire(await gerer(post(chemin, CORPS[chemin], entetes)))).toEqual({
        statut: 403,
        corps: { ok: false, raison: "refuse" },
      });
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(profil);
    });
  }
});

describe("entrée falsifiée : refusée avant toute dépendance", () => {
  const FALSIFIES: ReadonlyArray<[string, string, unknown]> = [
    ["jeton au lieu de l'identifiant", "/revoke-session", { token: "jeton-session-b" }],
    ["id au lieu de session", "/revoke-session", { id: ID_SESSION }],
    ["identifiant et jeton", "/revoke-session", { session: ID_SESSION, token: "jeton" }],
    ["identifiant hors forme", "/revoke-session", { session: "jeton-session-b" }],
    ["identifiant vide", "/revoke-session", { session: "" }],
    ["identifiant non texte", "/revoke-session", { session: 7 }],
    ["champ inconnu", "/revoke-other-sessions", { tout: true }],
    ["revokeOtherSessions", "/revoke-other-sessions", { revokeOtherSessions: true }],
    [
      "revokeOtherSessions à faux",
      "/change-password",
      { ...CORPS["/change-password"], revokeOtherSessions: false },
    ],
    [
      "noms de Better Auth",
      "/change-password",
      { currentPassword: MOT_DE_PASSE_ACTUEL, newPassword: NOUVEAU_MOT_DE_PASSE },
    ],
    ["actuel absent", "/change-password", { nouveauMotDePasse: NOUVEAU_MOT_DE_PASSE }],
    [
      "actuel vide",
      "/change-password",
      { motDePasseActuel: "", nouveauMotDePasse: NOUVEAU_MOT_DE_PASSE },
    ],
    [
      "nouveau de 129 caractères",
      "/change-password",
      { motDePasseActuel: MOT_DE_PASSE_ACTUEL, nouveauMotDePasse: "x".repeat(129) },
    ],
    ["name au lieu de nom", "/update-user", { name: "Awa" }],
    ["image", "/update-user", { nom: "Awa", image: "https://exemple.invalid/a.png" }],
    ["email", "/update-user", { nom: "Awa", email: "autre@exemple.invalid" }],
    ["nom vide", "/update-user", { nom: "" }],
    ["nom d'espaces", "/update-user", { nom: "   " }],
    ["nom de 101 caractères", "/update-user", { nom: "a".repeat(101) }],
    ["nom à caractère de contrôle", "/update-user", { nom: "Awa\u0000Koné" }],
    ["nom à retour à la ligne", "/update-user", { nom: "Awa\nKoné" }],
    ["nom non texte", "/update-user", { nom: ["Awa"] }],
  ];

  test.each(FALSIFIES)("%s (%s) : invalide", async (_nom, chemin, corps) => {
    const { gerer, traiter, profil } = traitement();
    expect(await lire(await gerer(post(chemin, corps)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "invalide" },
    });
    expect(traiter).not.toHaveBeenCalled();
    aucuneDependanceAppelee(profil);
  });

  test.each(CHEMINS)(
    "%s : données dans l'adresse, corps trop grand, autre type, JSON invalide",
    async (chemin) => {
      const { gerer, traiter, profil } = traitement();
      const entetes = {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: COOKIE_RECU,
      };
      const refus = [
        await gerer(post(chemin, CORPS[chemin], entetes, `?session=${ID_SESSION}`)),
        await gerer(
          post(chemin, JSON.stringify({ ...CORPS[chemin], r: "x".repeat(4097) }), entetes),
        ),
        await gerer(post(chemin, CORPS[chemin], { ...entetes, "content-type": "text/plain" })),
        await gerer(post(chemin, "{", entetes)),
      ];
      for (const recue of refus) {
        expect(await lire(recue)).toEqual({
          statut: 400,
          corps: { ok: false, raison: "invalide" },
        });
      }
      expect(traiter).not.toHaveBeenCalled();
      aucuneDependanceAppelee(profil);
    },
  );
});

describe("sans session : connexion_requise, rien d'autre", () => {
  test.each(CHEMINS)(
    "%s : session absente, expirée ou cookie forgé (lecture nulle)",
    async (chemin) => {
      const { gerer, traiter, profil } = traitement({ session: null });
      expect(await lire(await gerer(post(chemin, CORPS[chemin])))).toEqual({
        statut: 401,
        corps: { ok: false, raison: "connexion_requise" },
      });
      expect(profil.lireSession).toHaveBeenCalledTimes(1);
      expect(traiter).not.toHaveBeenCalled();
      for (const [nom, espion] of Object.entries(profil)) {
        if (nom !== "lireSession") expect(espion, nom).not.toHaveBeenCalled();
      }
    },
  );

  test.each(CHEMINS)("%s : aucun cookie de session dans la requête", async (chemin) => {
    const { gerer, traiter, profil } = traitement();
    const recue = await gerer(
      post(chemin, CORPS[chemin], {
        "content-type": "application/json",
        origin: ORIGINE,
        cookie: "better-auth.two_factor=attente.signature",
      }),
    );
    expect(await lire(recue)).toEqual({
      statut: 401,
      corps: { ok: false, raison: "connexion_requise" },
    });
    expect(traiter).not.toHaveBeenCalled();
    expect(profil.limiterProfil).not.toHaveBeenCalled();
  });

  test.each(CHEMINS)(
    "%s : limite du profil atteinte, trop_de_requetes, rien d'autre",
    async (chemin) => {
      const { gerer, traiter, profil } = traitement({
        profil: (faux) => faux.limiterProfil.mockResolvedValue(false),
      });
      expect(await lire(await gerer(post(chemin, CORPS[chemin])))).toEqual({
        statut: 429,
        corps: { ok: false, raison: "trop_de_requetes" },
      });
      expect(profil.limiterProfil).toHaveBeenCalledWith("u-a");
      expect(traiter).not.toHaveBeenCalled();
      for (const nom of [
        "limiterMotDePasse",
        "motDePasseValide",
        "motDePasseCompromis",
        "revoquerSessionDe",
        "revoquerAutresSessions",
        "supprimerJetonsReinitialisation",
        "modifierNom",
        "notifier",
      ] as const) {
        expect(profil[nom], nom).not.toHaveBeenCalled();
      }
    },
  );
});

describe("autre compte : seules les sessions et le nom de l'utilisateur de la session", () => {
  test("revoke-session : l'utilisateur et le jeton de la session, jamais une valeur reçue", async () => {
    const { gerer, traiter, profil } = traitement();
    expect(await lire(await gerer(post("/revoke-session", CORPS["/revoke-session"])))).toEqual({
      statut: 200,
      corps: { ok: true },
    });
    expect(profil.revoquerSessionDe).toHaveBeenCalledExactlyOnceWith(
      "u-a",
      ID_SESSION,
      "jeton-session-a",
    );
    expect(traiter).not.toHaveBeenCalled();
    expect(profil.notifier).not.toHaveBeenCalled();
  });

  test("revoke-session : même réponse, octet pour octet, que la session soit supprimée ou non", async () => {
    const corps = async (gerer: ReturnType<typeof traitement>["gerer"]) => {
      const recue = await gerer(post("/revoke-session", CORPS["/revoke-session"]));
      return {
        statut: recue.status,
        entetes: [...recue.headers.entries()],
        texte: await recue.text(),
      };
    };
    const reference = await corps(traitement().gerer);
    // La dépendance ne dit rien de ce qu'elle a supprimé : la réponse ne
    // peut pas en dépendre. Un identifiant d'une autre session donne donc
    // la même réponse.
    const autre = await corps(
      traitement({ profil: (faux) => faux.revoquerSessionDe.mockResolvedValue(undefined) }).gerer,
    );
    expect(autre).toEqual(reference);
    expect(reference.texte).toBe(JSON.stringify({ ok: true }));
  });

  test("revoke-other-sessions : l'utilisateur et le jeton de la session", async () => {
    const { gerer, traiter, profil } = traitement();
    expect(await lire(await gerer(post("/revoke-other-sessions", {})))).toEqual({
      statut: 200,
      corps: { ok: true },
    });
    expect(profil.revoquerAutresSessions).toHaveBeenCalledExactlyOnceWith("u-a", "jeton-session-a");
    expect(traiter).not.toHaveBeenCalled();
  });

  test("update-user : le nom sans espaces de bord, pour l'utilisateur de la session, sans Better Auth", async () => {
    const { gerer, traiter, profil } = traitement();
    expect(await lire(await gerer(post("/update-user", CORPS["/update-user"])))).toEqual({
      statut: 200,
      corps: { ok: true },
    });
    expect(profil.modifierNom).toHaveBeenCalledExactlyOnceWith("u-a", "Awa Koné");
    expect(traiter).not.toHaveBeenCalled();
    expect(profil.notifier).not.toHaveBeenCalled();
  });

  test.each([
    ["revoke-session", "/revoke-session", "revoquerSessionDe"],
    ["revoke-other-sessions", "/revoke-other-sessions", "revoquerAutresSessions"],
    ["update-user", "/update-user", "modifierNom"],
  ] as const)(
    "%s : panne de l'opération, erreur avec incident",
    async (_nom, chemin, dependance) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { gerer } = traitement({
        profil: (faux) => faux[dependance].mockRejectedValue(new Error("panne")),
      });
      const { statut, corps } = await lire(await gerer(post(chemin, CORPS[chemin])));
      expect(statut).toBe(500);
      expect(corps.raison).toBe("erreur");
      expect(corps.incident).toMatch(/^[0-9a-f-]{36}$/u);
    },
  );
});

describe("changement du mot de passe : ordre des contrôles", () => {
  const CHANGEMENT = CORPS["/change-password"];

  test("limite des essais du mot de passe atteinte : trop_de_requetes, mot de passe jamais vérifié", async () => {
    const { gerer, traiter, profil } = traitement({
      profil: (faux) => faux.limiterMotDePasse.mockResolvedValue(false),
    });
    expect(await lire(await gerer(post("/change-password", CHANGEMENT)))).toEqual({
      statut: 429,
      corps: { ok: false, raison: "trop_de_requetes" },
    });
    expect(profil.limiterProfil).toHaveBeenCalledWith("u-a");
    expect(profil.limiterMotDePasse).toHaveBeenCalledWith("u-a");
    expect(profil.motDePasseValide).not.toHaveBeenCalled();
    expect(traiter).not.toHaveBeenCalled();
  });

  test("nouveau mot de passe de 11 caractères : mot_de_passe_trop_court, mot de passe jamais vérifié", async () => {
    const { gerer, traiter, profil } = traitement();
    const recue = await gerer(
      post("/change-password", {
        motDePasseActuel: MOT_DE_PASSE_ACTUEL,
        nouveauMotDePasse: "x".repeat(11),
      }),
    );
    expect(await lire(recue)).toEqual({
      statut: 400,
      corps: { ok: false, raison: "mot_de_passe_trop_court" },
    });
    expect(profil.motDePasseValide).not.toHaveBeenCalled();
    expect(profil.motDePasseCompromis).not.toHaveBeenCalled();
    expect(traiter).not.toHaveBeenCalled();
  });

  test("mot de passe actuel faux : mot_de_passe_incorrect, ni Have I Been Pwned ni Better Auth", async () => {
    const { gerer, traiter, profil } = traitement({
      profil: (faux) => faux.motDePasseValide.mockResolvedValue(false),
    });
    expect(await lire(await gerer(post("/change-password", CHANGEMENT)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "mot_de_passe_incorrect" },
    });
    expect(profil.motDePasseValide).toHaveBeenCalledExactlyOnceWith("u-a", MOT_DE_PASSE_ACTUEL);
    expect(profil.motDePasseCompromis).not.toHaveBeenCalled();
    expect(traiter).not.toHaveBeenCalled();
    expect(profil.revoquerAutresSessions).not.toHaveBeenCalled();
    expect(profil.notifier).not.toHaveBeenCalled();
  });

  test("nouveau mot de passe compromis : mot_de_passe_compromis, Better Auth jamais appelé", async () => {
    const { gerer, traiter, profil } = traitement({
      profil: (faux) => faux.motDePasseCompromis.mockResolvedValue(true),
    });
    expect(await lire(await gerer(post("/change-password", CHANGEMENT)))).toEqual({
      statut: 400,
      corps: { ok: false, raison: "mot_de_passe_compromis" },
    });
    expect(profil.motDePasseCompromis).toHaveBeenCalledExactlyOnceWith(NOUVEAU_MOT_DE_PASSE);
    expect(traiter).not.toHaveBeenCalled();
  });

  test("service Have I Been Pwned injoignable : erreur, Better Auth jamais appelé (fermé par défaut)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer, traiter } = traitement({
      profil: (faux) => faux.motDePasseCompromis.mockRejectedValue(new Error("injoignable")),
    });
    const { statut, corps } = await lire(await gerer(post("/change-password", CHANGEMENT)));
    expect(statut).toBe(500);
    expect(corps.raison).toBe("erreur");
    expect(traiter).not.toHaveBeenCalled();
  });

  test("Better Auth reçoit exactement les champs validés, revokeOtherSessions vrai, et le seul cookie de session", async () => {
    const { gerer, appels } = traitement();
    await gerer(post("/change-password", CHANGEMENT));
    expect(appels).toHaveLength(1);
    const [interne] = appels;
    expect(new URL(interne!.url).pathname).toBe("/api/auth/change-password");
    expect(interne!.method).toBe("POST");
    expect(await interne!.json()).toStrictEqual({
      currentPassword: MOT_DE_PASSE_ACTUEL,
      newPassword: NOUVEAU_MOT_DE_PASSE,
      revokeOtherSessions: true,
    });
    expect(interne!.headers.get("cookie")).toBe(`${SESSION}=jeton-session-a.signature-a`);
    expect(interne!.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(interne!.headers.get("user-agent")).toBe("Navigateur d'essai");
  });
});

describe("changement du mot de passe : S-82 et après le succès", () => {
  const CHANGEMENT = CORPS["/change-password"];

  test("succès : { ok: true } et le seul cookie de la session neuve, jamais le jeton ni l'utilisateur", async () => {
    const { gerer } = traitement();
    const recue = await gerer(post("/change-password", CHANGEMENT));
    expect(recue.status).toBe(200);
    expect(recue.headers.getSetCookie()).toEqual([
      `${SESSION}=jeton-neuf.signature-neuve; Path=/; HttpOnly; SameSite=Lax`,
    ]);
    const texte = await recue.text();
    expect(JSON.parse(texte)).toStrictEqual({ ok: true });
    expect(texte).not.toContain("jeton-neuf");
    expect(recue.headers.get("cache-control")).toBe("no-store");
  });

  test("succès : autres sessions fermées en gardant la neuve, liens de réinitialisation supprimés, email", async () => {
    const { gerer, profil } = traitement();
    await gerer(post("/change-password", CHANGEMENT));
    expect(profil.revoquerAutresSessions).toHaveBeenCalledExactlyOnceWith("u-a", "jeton-neuf");
    expect(profil.supprimerJetonsReinitialisation).toHaveBeenCalledExactlyOnceWith("u-a");
    expect(profil.notifier).toHaveBeenCalledExactlyOnceWith("compte.mot_de_passe_change", "u-a");
  });

  test("succès sans cookie de session neuf : erreur, aucun cookie, rien d'autre", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer, profil } = traitement({ reponse: reponse(200, { token: null, user: {} }) });
    const recue = await gerer(post("/change-password", CHANGEMENT));
    expect(recue.status).toBe(500);
    expect(recue.headers.getSetCookie()).toEqual([]);
    expect(profil.notifier).not.toHaveBeenCalled();
  });

  test("fermeture des autres sessions en échec : erreur, aucun cookie, aucun email", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { gerer, profil } = traitement({
      profil: (faux) => faux.revoquerAutresSessions.mockRejectedValue(new Error("panne")),
    });
    const recue = await gerer(post("/change-password", CHANGEMENT));
    const { corps } = await lire(recue.clone());
    expect(recue.status).toBe(500);
    expect(corps.raison).toBe("erreur");
    expect(recue.headers.getSetCookie()).toEqual([]);
    expect(profil.notifier).not.toHaveBeenCalled();
  });

  test("suppression des liens de réinitialisation en échec : succès quand même, une ligne [auth] fixe", async () => {
    const lignes: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs.map(String).join(" "));
    });
    const { gerer, profil } = traitement({
      profil: (faux) =>
        faux.supprimerJetonsReinitialisation.mockRejectedValue(new Error("panne u-a")),
    });
    const recue = await gerer(post("/change-password", CHANGEMENT));
    expect(recue.status).toBe(200);
    expect(recue.headers.getSetCookie()).toHaveLength(1);
    expect(profil.notifier).toHaveBeenCalledTimes(1);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatch(/^\[auth\] /u);
    expect(lignes[0]).not.toContain("u-a");
  });

  test("planification de l'email en échec : succès quand même", async () => {
    const { gerer } = traitement({
      profil: (faux) =>
        faux.notifier.mockImplementation(() => {
          throw new Error("after() hors d'une requête");
        }),
    });
    expect((await gerer(post("/change-password", CHANGEMENT))).status).toBe(200);
  });

  test.each([
    ["INVALID_PASSWORD", 400, { code: "INVALID_PASSWORD" }, 400, "mot_de_passe_incorrect"],
    ["PASSWORD_TOO_SHORT", 400, { code: "PASSWORD_TOO_SHORT" }, 400, "mot_de_passe_trop_court"],
    ["PASSWORD_COMPROMISED", 400, { code: "PASSWORD_COMPROMISED" }, 400, "mot_de_passe_compromis"],
    ["limite par adresse IP", 429, {}, 429, "trop_de_requetes"],
    ["session lue absente", 401, { code: "UNAUTHORIZED" }, 401, "connexion_requise"],
    ["compte sans mot de passe", 400, { code: "CREDENTIAL_ACCOUNT_NOT_FOUND" }, 500, "erreur"],
    ["panne", 500, { code: "INTERNAL_SERVER_ERROR" }, 500, "erreur"],
    ["code inconnu", 400, { code: "AUTRE" }, 500, "erreur"],
  ] as const)(
    "%s : traduit, rien fermé ni notifié",
    async (_nom, statut, corps, attendu, raison) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { gerer, profil } = traitement({ reponse: reponse(statut, corps) });
      const recue = await gerer(post("/change-password", CHANGEMENT));
      const lue = await lire(recue.clone());
      expect(lue.statut).toBe(attendu);
      expect(lue.corps.raison).toBe(raison);
      expect(recue.headers.getSetCookie()).toEqual([]);
      expect(profil.revoquerAutresSessions).not.toHaveBeenCalled();
      expect(profil.supprimerJetonsReinitialisation).not.toHaveBeenCalled();
      expect(profil.notifier).not.toHaveBeenCalled();
    },
  );
});

describe("journal (S-54, T-39) : aucune valeur secrète ni personnelle", () => {
  test("passage complet et pannes : ni mot de passe, ni jeton, ni identifiant, ni nom, ni adresse", async () => {
    const lignes: string[] = [];
    for (const methode of ["error", "warn", "log", "info"] as const) {
      vi.spyOn(console, methode).mockImplementation((...valeurs: unknown[]) => {
        lignes.push(
          valeurs
            .map((valeur) => (typeof valeur === "string" ? valeur : JSON.stringify(valeur)))
            .join(" "),
        );
      });
    }
    const normal = traitement();
    for (const chemin of CHEMINS) await normal.gerer(post(chemin, CORPS[chemin]));
    const enPanne = traitement({
      profil: (faux) => {
        const erreur = new Error(
          `panne ${MOT_DE_PASSE_ACTUEL} jeton-session-a ${ID_SESSION} Awa awa@exemple.invalid`,
        );
        faux.revoquerSessionDe.mockRejectedValue(erreur);
        faux.revoquerAutresSessions.mockRejectedValue(erreur);
        faux.modifierNom.mockRejectedValue(erreur);
        faux.supprimerJetonsReinitialisation.mockRejectedValue(erreur);
      },
    });
    for (const chemin of CHEMINS) await enPanne.gerer(post(chemin, CORPS[chemin]));
    const journal = lignes.join("\n");
    expect(lignes.length).toBeGreaterThan(0);
    for (const interdit of [
      MOT_DE_PASSE_ACTUEL,
      NOUVEAU_MOT_DE_PASSE,
      "jeton-session-a",
      "jeton-neuf",
      ID_SESSION,
      "Awa",
      "exemple.invalid",
      "203.0.113.7",
      "Navigateur d'essai",
    ]) {
      expect(journal, interdit).not.toContain(interdit);
    }
    for (const ligne of lignes) expect(ligne).toMatch(/^\[auth\] /u);
  });
});
