import { randomBytes, randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { MOT_DE_PASSE_COMPROMIS_E2E } from "./hibp-simule.mjs";

// /api/auth sur le site construit (T-55, S-81, T-41, S-54). Tout point
// d'entrée fermé, quelle que soit la méthode, reçoit la même réponse qu'une
// adresse inexistante sous /api/auth : même statut, même corps, mêmes
// en-têtes au nonce et à la date près. Les trois points ouverts refusent une
// origine absente ou étrangère et toute entrée falsifiée ; la sixième
// inscription d'une même adresse IP reçoit trop_de_requetes, sans délai.
// Fiche : docs/features/inscription.md, sections 2 et 3, test 14.

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
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/list-sessions",
  "/revoke-sessions",
  "/request-password-reset",
  "/reset-password",
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

  test("GET des trois points ouverts : fermé (seul POST est admis)", async () => {
    for (const chemin of ["/sign-up/email", "/send-verification-email", "/verify-email"]) {
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
