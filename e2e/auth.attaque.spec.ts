import { randomBytes, randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  adresseConnexion,
  connecter,
  creerCompteVerifie,
  MOT_DE_PASSE,
  NOM_COOKIE,
} from "./compte-verifie";
import { MOT_DE_PASSE_COMPROMIS_E2E } from "./hibp-simule.mjs";

// /api/auth sur le site construit (T-55, S-81, T-41, S-54). Tout point
// d'entrée fermé, quelle que soit la méthode, reçoit la même réponse qu'une
// adresse inexistante sous /api/auth : même statut, même corps, mêmes
// en-têtes au nonce et à la date près. Les trois points ouverts refusent une
// origine absente ou étrangère et toute entrée falsifiée ; la sixième
// inscription d'une même adresse IP reçoit trop_de_requetes, sans délai.
// Fiche : docs/features/inscription.md, sections 2 et 3, test 14. Connexion
// et déconnexion (1.2) : cinq points ouverts ; /get-session reste fermé, même
// avec un cookie valide ; la sixième tentative sur un compte, depuis six
// adresses IP, reçoit trop_de_requetes. Fiche : docs/features/connexion.md,
// test 22. Mot de passe oublié (1.3) : sept points ouverts ; le lien de
// Better Auth (jeton dans le chemin) reste fermé ; la troisième demande pour
// une même adresse, depuis trois adresses IP, reçoit trop_de_requetes.
// Fiche : docs/features/mot-de-passe.md, « Tests de bout en bout ».

const ADRESSE = "http://localhost:3000";
const BASE = `${ADRESSE}/api/auth`;

type Forme = { statut: number; corps: string; entetes: [string, string][] };

// En-têtes comparés : tous, sauf la politique (nonce neuf à chaque requête)
// et la date.
const VARIABLES = new Set(["content-security-policy", "date"]);

type Options = { methode?: "GET" | "POST"; entetes?: Record<string, string>; corps?: string };

async function lire(chemin: string, options: Options = {}): Promise<Forme> {
  const reponse = await fetch(BASE + chemin, {
    method: options.methode ?? "GET",
    redirect: "manual",
    headers: options.entetes ?? {},
    body: options.corps,
  });
  return {
    statut: reponse.status,
    corps: await reponse.text(),
    entetes: [...reponse.headers.entries()]
      .filter(([nom]) => !VARIABLES.has(nom))
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}

function inexistant(): string {
  return `/n-existe-pas-${randomBytes(6).toString("hex")}`;
}

// Un POST bien formé : JSON, origine du site. Fermé, il ne passe pas plus
// qu'un POST vide.
const POST_FORME: Options = {
  methode: "POST",
  entetes: { "content-type": "application/json", origin: ADRESSE },
  corps: JSON.stringify({ email: "e2e-ferme@exemple.invalid", password: "x".repeat(16) }),
};

const CHEMINS_FERMES = [
  "/organization/update-member-role",
  "/organization/list",
  "/organization/get-full-organization",
  "/organization/create",
  "/organization/remove-member",
  // 1.2 (modifié) : /sign-in/email et /sign-out sont ouverts en POST ; leur
  // GET est vérifié avec les autres points ouverts, plus bas.
  "/sign-in/social",
  "/get-session",
  "/list-sessions",
  "/revoke-sessions",
  // 1.3 (modifié) : /request-password-reset et /reset-password sont ouverts
  // en POST ; leur GET est vérifié avec les autres points ouverts, plus bas.
  // Le lien de Better Auth, jeton dans le chemin, reste fermé.
  `/reset-password/${"aB3dE5fG7hJ9kL1mN2pQ4rS6"}`,
  "/verify-password",
  "/forget-password",
  "/two-factor/enable",
  "/update-user",
  "/change-password",
  "/delete-user",
  "/ok",
  "/error",
  // Variantes d'écriture d'un chemin ouvert. La barre finale est traitée à
  // part : Next.js redirige avant la route (test suivant).
  "/SIGN-UP/EMAIL",
  "/sign-up%2Femail",
  "/Verify-Email",
];

test.describe("T-55 : points d'entrée fermés, indiscernables d'une adresse inexistante", () => {
  test("la référence : 404, corps vide", async () => {
    const reference = await lire(inexistant());

    expect(reference.statut).toBe(404);
    expect(reference.corps).toBe("");
  });

  for (const chemin of CHEMINS_FERMES) {
    test(`GET et POST ${chemin}`, async () => {
      const [get, getReference] = [await lire(chemin), await lire(inexistant())];
      const [post, postReference] = [
        await lire(chemin, POST_FORME),
        await lire(inexistant(), POST_FORME),
      ];

      expect(get).toEqual(getReference);
      expect(post).toEqual(postReference);
      expect(post.statut).toBe(404);
    });
  }

  // Constaté en phase rouge : toute adresse à barre finale reçoit de Next.js
  // une redirection 308 vers l'adresse sans barre, avant la route. Elle ne
  // dit rien des points d'entrée : même réponse, l'adresse cible mise à part
  // (en-tête location, en-tête refresh et corps), pour un chemin ouvert et un
  // chemin inexistant.
  test("barre finale : la même redirection de Next.js pour un chemin ouvert et un chemin inexistant", async () => {
    const sansCible = (forme: Forme, cible: string) => ({
      statut: forme.statut,
      corps: forme.corps.replaceAll(cible, "<cible>"),
      entetes: forme.entetes.map(([nom, valeur]) => [nom, valeur.replaceAll(cible, "<cible>")]),
    });
    const lieu = (forme: Forme) => forme.entetes.find(([nom]) => nom === "location")?.[1];
    const absent = inexistant();
    for (const options of [{}, POST_FORME]) {
      for (const chemin of ["/sign-up/email", "/verify-email"]) {
        const ouvert = await lire(`${chemin}/`, options);
        const reference = await lire(`${absent}/`, options);

        expect(ouvert.statut).toBe(308);
        expect(lieu(ouvert)).toBe(`/api/auth${chemin}`);
        expect(lieu(reference)).toBe(`/api/auth${absent}`);
        expect(sansCible(ouvert, `/api/auth${chemin}`)).toEqual(
          sansCible(reference, `/api/auth${absent}`),
        );
      }
    }
  });

  // 1.2 (modifié) : cinq points ouverts au lieu de trois. 1.3 (modifié) :
  // sept.
  test("GET des sept points ouverts : fermé (seul POST est admis)", async () => {
    for (const chemin of [
      "/sign-up/email",
      "/send-verification-email",
      "/verify-email",
      "/sign-in/email",
      "/sign-out",
      "/request-password-reset",
      "/reset-password",
    ]) {
      expect(await lire(chemin), chemin).toEqual(await lire(inexistant()));
    }
  });

  test("GET /verify-email?token=<jeton> : le jeton dans l'adresse est fermé, aucun cookie", async () => {
    const segment = () => randomBytes(24).toString("base64url");
    const jeton = `${segment()}.${segment()}.${segment()}`;

    const reponse = await lire(`/verify-email?token=${jeton}`);

    expect(reponse).toEqual(await lire(`${inexistant()}?token=${jeton}`));
    expect(reponse.entetes.map(([nom]) => nom)).not.toContain("set-cookie");
  });
});

test.describe("S-81 et entrée falsifiée : refus avant Better Auth", () => {
  const corpsValide = () =>
    JSON.stringify({
      nom: "Essai",
      email: `e2e-refus-${randomBytes(4).toString("hex")}@exemple.invalid`,
      motDePasse: "Phrase de passe solide 2026",
    });

  const ORIGINES: [string, Record<string, string>][] = [
    ["sans Origin", {}],
    ["Origin étrangère", { origin: "https://attaquant.exemple" }],
    ["Origin null", { origin: "null" }],
    ["autre port", { origin: "http://localhost:3101" }],
    ["Sec-Fetch-Site cross-site", { origin: ADRESSE, "sec-fetch-site": "cross-site" }],
  ];

  for (const [nom, entetes] of ORIGINES) {
    // 1.2 : la connexion et la déconnexion, refusées de même (S-81, T-17).
    for (const [chemin, corps] of [
      ["/sign-in/email", JSON.stringify({ email: "e2e-x@exemple.invalid", motDePasse: "x" })],
      ["/sign-out", "{}"],
    ] as const) {
      test(`POST ${chemin}, ${nom} : refusé`, async () => {
        const reponse = await lire(chemin, {
          methode: "POST",
          entetes: { "content-type": "application/json", ...entetes },
          corps,
        });

        expect(reponse.statut).toBe(403);
        expect(JSON.parse(reponse.corps)).toEqual({ ok: false, raison: "refuse" });
      });
    }

    test(`POST /sign-up/email, ${nom} : refusé`, async () => {
      const reponse = await lire("/sign-up/email", {
        methode: "POST",
        entetes: { "content-type": "application/json", ...entetes },
        corps: corpsValide(),
      });

      expect(reponse.statut).toBe(403);
      expect(JSON.parse(reponse.corps)).toEqual({ ok: false, raison: "refuse" });
    });
  }

  const FALSIFIES: [string, Options][] = [
    [
      "champ image",
      { corps: JSON.stringify({ ...JSON.parse(corpsValide()), image: "https://x.exemple/a.png" }) },
    ],
    [
      "champ callbackURL",
      { corps: JSON.stringify({ ...JSON.parse(corpsValide()), callbackURL: "https://x.exemple" }) },
    ],
    [
      "champ rememberMe",
      { corps: JSON.stringify({ ...JSON.parse(corpsValide()), rememberMe: true }) },
    ],
    ["corps de 4 Kio + 1", { corps: `{"nom":"${"a".repeat(4096)}"}` }],
    ["JSON invalide", { corps: "{nom:" }],
    ["text/plain", { entetes: { "content-type": "text/plain" }, corps: corpsValide() }],
  ];

  for (const [nom, options] of FALSIFIES) {
    test(`POST /sign-up/email, ${nom} : invalide`, async () => {
      const reponse = await lire("/sign-up/email", {
        methode: "POST",
        entetes: { "content-type": "application/json", origin: ADRESSE, ...options.entetes },
        corps: options.corps,
      });

      expect(reponse.statut).toBe(400);
      expect(JSON.parse(reponse.corps)).toEqual({ ok: false, raison: "invalide" });
    });
  }
});

// T-41 : limite auth.inscription, 5 par heure et par adresse IP. Le mot de
// passe compromis (service simulé) fait refuser l'inscription après le
// compteur : aucun compte, aucun email. C'est l'essai que le développeur
// refait sur la prévisualisation avec le vrai service (section 3.4).
test.describe("T-41 : la sixième inscription d'une même adresse IP", () => {
  async function inscrire(ip: string) {
    const reponse = await fetch(`${BASE}/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ADRESSE, "x-forwarded-for": ip },
      body: JSON.stringify({
        nom: "Essai",
        email: "e2e-limite@exemple.invalid",
        motDePasse: MOT_DE_PASSE_COMPROMIS_E2E,
      }),
    });
    return { reponse, corps: (await reponse.json()) as unknown };
  }

  const ipAuHasard = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

  test("même adresse IP : cinq refus « compromis », puis trop_de_requetes sans délai", async () => {
    const ip = ipAuHasard();
    for (let rang = 1; rang <= 5; rang += 1) {
      const { reponse, corps } = await inscrire(ip);
      expect(corps, `essai ${rang}`).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
      expect(reponse.status).toBe(400);
    }

    const { reponse, corps } = await inscrire(ip);

    expect(reponse.status).toBe(429);
    expect(corps).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(reponse.headers.get("x-retry-after")).toBeNull();
    expect(reponse.headers.get("retry-after")).toBeNull();
    expect(reponse.headers.get("x-ratelimit-remaining")).toBeNull();
  });

  test("six adresses IP différentes : aucune limite atteinte (en local, l'en-tête est cru)", async () => {
    for (let rang = 1; rang <= 6; rang += 1) {
      const { corps } = await inscrire(ipAuHasard());
      expect(corps, `essai ${rang}`).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
    }
  });
});

// 1.2 : T-01 et T-43, limite auth.connexion_compte (5 par 15 minutes et par
// adresse email, quelle que soit l'adresse IP) ; S-82, /get-session fermé
// même avec un cookie de session valide. Fiche : docs/features/connexion.md,
// sections 1.2 et 3, test 22.
test.describe("T-01 et S-82 : connexion", () => {
  const ipAuHasard = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

  test("six tentatives sur une adresse depuis six adresses IP : la sixième reçoit trop_de_requetes", async () => {
    const email = `e2e-limite-${randomBytes(6).toString("hex")}@exemple.invalid`;
    for (let rang = 1; rang <= 5; rang += 1) {
      const reponse = await connecter(email, MOT_DE_PASSE, { "x-forwarded-for": ipAuHasard() });
      expect(reponse.status, `essai ${rang}`).toBe(401);
      expect(await reponse.json()).toEqual({ ok: false, raison: "identifiants_incorrects" });
    }

    const reponse = await connecter(email, MOT_DE_PASSE, { "x-forwarded-for": ipAuHasard() });

    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(reponse.headers.get("x-retry-after")).toBeNull();
    expect(reponse.headers.get("retry-after")).toBeNull();
    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  test("GET /get-session avec un cookie de session valide : identique à un chemin inexistant", async ({}, info) => {
    const valeur = await creerCompteVerifie(adresseConnexion(info, "session"));
    const cookie = `${NOM_COOKIE}=${valeur}`;

    const session = await lire("/get-session", { entetes: { cookie } });
    const reference = await lire(inexistant(), { entetes: { cookie } });

    expect(session).toEqual(reference);
    expect(session.corps).toBe("");
  });
});

// Fonctionnalité 1.3 : mot de passe oublié. Fiche :
// docs/features/mot-de-passe.md, sections 2 et 5.
test.describe("T-55, S-81 et T-43 : réinitialisation", () => {
  const ipAuHasard = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

  test("GET /reset-password/<jeton> avec callbackURL : identique à un chemin inexistant, aucune redirection", async () => {
    const jeton = randomBytes(18)
      .toString("base64")
      .replaceAll(/[^A-Za-z0-9]/gu, "a")
      .slice(0, 24);
    const reponse = await lire(`/reset-password/${jeton}?callbackURL=%2F`);
    expect(reponse).toEqual(await lire(`${inexistant()}?callbackURL=%2F`));
    expect(reponse.entetes.map(([nom]) => nom)).not.toContain("location");
  });

  for (const [nom, entetes] of [
    ["sans Origin", {}],
    ["Origin étrangère", { origin: "https://attaquant.exemple" }],
  ] as const) {
    for (const [chemin, corps] of [
      ["/request-password-reset", JSON.stringify({ email: "e2e-x@exemple.invalid" })],
      [
        "/reset-password",
        JSON.stringify({ jeton: "aB3dE5fG7hJ9kL1mN2pQ4rS6", motDePasse: "Phrase de passe 2026" }),
      ],
    ] as const) {
      test(`POST ${chemin}, ${nom} : refusé`, async () => {
        const reponse = await lire(chemin, {
          methode: "POST",
          entetes: { "content-type": "application/json", ...entetes },
          corps,
        });
        expect(reponse.statut).toBe(403);
        expect(JSON.parse(reponse.corps)).toEqual({ ok: false, raison: "refuse" });
      });
    }
  }

  test("POST /request-password-reset avec redirectTo : invalide", async () => {
    const reponse = await lire("/request-password-reset", {
      methode: "POST",
      entetes: { "content-type": "application/json", origin: ADRESSE },
      corps: JSON.stringify({
        email: "e2e-x@exemple.invalid",
        redirectTo: "https://attaquant.exemple",
      }),
    });
    expect(reponse.statut).toBe(400);
    expect(JSON.parse(reponse.corps)).toEqual({ ok: false, raison: "invalide" });
  });

  test("trois demandes pour une même adresse depuis trois adresses IP : la troisième reçoit trop_de_requetes", async () => {
    const email = `e2e-limite-mdp-${randomBytes(6).toString("hex")}@exemple.invalid`;
    const statuts = [];
    for (let rang = 1; rang <= 3; rang += 1) {
      const reponse = await lire("/request-password-reset", {
        methode: "POST",
        entetes: {
          "content-type": "application/json",
          origin: ADRESSE,
          "x-forwarded-for": ipAuHasard(),
        },
        corps: JSON.stringify({ email }),
      });
      statuts.push([reponse.statut, JSON.parse(reponse.corps)]);
    }
    expect(statuts).toEqual([
      [200, { ok: true }],
      [200, { ok: true }],
      [429, { ok: false, raison: "trop_de_requetes" }],
    ]);
  });
});
