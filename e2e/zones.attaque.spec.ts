import { createHmac, randomBytes } from "node:crypto";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_ERREURS } from "../src/textes/erreurs";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";
import { TEXTES_SIMULATION } from "../src/textes/simulation";

import { adresseDoubleAuth } from "./compte-verifie";
import { activer, preparer } from "./double-auth";
import { outilOrganisation } from "./organisation-e2e";
import {
  documentEtFlux,
  documentServi,
  ENTETES_SECTION_6,
  nonceDe,
  observerViolations,
  POLITIQUE_PRODUCTION,
  sansNonce,
  violations,
} from "./outils";

// La zone application ouverte sans session valide (S-02, T-30) : la page du
// tableau de bord répond « introuvable », la même réponse avec ou sans cookie
// forgé, et rien du gabarit (navigation, rôle, bandeau) ne part vers le
// navigateur. S-02 porte sur les ressources, qui passent par une même route :
// le nom d'une page est public, il n'est pas comparé à une adresse
// inexistante (docs/features/controle-deploiement.md, section 5). Tests
// d'attaque « accès sans session » et « entrée falsifiée » de PLAN.md,
// section 4.3. Fiche : docs/features/socle-interface.md, sections 2.2, 2.3 et 3.

const TABLEAU_DE_BORD = "/tableau-de-bord";
const COOKIE_SESSION = "better-auth.session_token";

type Rendu = { statut: number | undefined; titre: string; texte: string; h1: string[] };

async function rendu(page: Page, chemin: string): Promise<Rendu> {
  const reponse = await page.goto(chemin);
  return {
    statut: reponse?.status(),
    titre: await page.title(),
    texte: await page.locator("body").innerText(),
    h1: await page.getByRole("heading", { level: 1 }).allInnerTexts(),
  };
}

async function forger(context: BrowserContext, baseURL: string | undefined, valeur: string) {
  await context.addCookies([{ name: COOKIE_SESSION, value: valeur, url: baseURL ?? "" }]);
}

// Signature au bon format (HMAC-SHA256 en base64, 44 caractères finissant par
// « = »), calculée avec un secret qui n'est pas celui du serveur.
function signeAvecUnAutreSecret(): string {
  const jeton = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", randomBytes(32)).update(jeton).digest("base64");
  return encodeURIComponent(`${jeton}.${signature}`);
}

// Textes du gabarit de l'application : aucun ne doit atteindre un visiteur
// sans session, ni dans la page, ni dans le HTML, ni dans la charge utile RSC.
const TEXTES_GABARIT = [
  TEXTES_SIMULATION.bandeauApplication,
  TEXTES_NAVIGATION.nom,
  TEXTES_NAVIGATION.organisationActive,
  TEXTES_NAVIGATION.entrees.tableauDeBord,
  ...Object.values(TEXTES_NAVIGATION.roles),
];

test.describe("zone application, sans session valide", () => {
  test("sans cookie : « introuvable », 404", async ({ page }) => {
    const obtenu = await rendu(page, TABLEAU_DE_BORD);

    expect(obtenu.statut).toBe(404);
    expect(obtenu.h1).toEqual([TEXTES_ERREURS.introuvable]);
  });

  for (const [nom, valeur] of [
    ["jeton aléatoire, sans signature", () => randomBytes(32).toString("base64url")],
    [
      "jeton et signature aléatoires",
      () => `${randomBytes(32).toString("base64url")}.${randomBytes(32).toString("base64url")}`,
    ],
    ["signature au bon format, autre secret", signeAvecUnAutreSecret],
    ["valeur vide", () => ""],
    ["injection SQL dans la valeur", () => encodeURIComponent("'; DROP TABLE session;--")],
  ] as const) {
    test(`cookie de session forgé (${nom}) : identique à l'absence de cookie`, async ({
      page,
      context,
      baseURL,
    }) => {
      const attendu = await rendu(page, TABLEAU_DE_BORD);
      await forger(context, baseURL, valeur());

      expect(await rendu(page, TABLEAU_DE_BORD)).toEqual(attendu);
    });
  }

  // HTML brut, sans navigateur ni JavaScript : un cookie forgé ne change rien
  // à la réponse (S-02). Next.js 16.4 ne rend pas not-found.tsx sur le
  // serveur après un notFound() : la page reçoit son document d'erreur, au
  // corps vide, et la page « introuvable » s'affiche après hydratation (tests
  // précédents). Fiche : docs/features/controle-deploiement.md, section 5.
  test("HTML brut, sans JavaScript : même statut, même document au nonce près", async ({
    request,
  }) => {
    const servi = async (chemin: string, cookie?: string) => {
      const reponse = await request.get(chemin, {
        maxRedirects: 0,
        headers: cookie === undefined ? {} : { cookie: `${COOKIE_SESSION}=${cookie}` },
      });
      return { statut: reponse.status(), document: documentServi(await reponse.text()) };
    };

    const attendu = await servi(TABLEAU_DE_BORD);

    expect(attendu.statut).toBe(404);
    expect(attendu.document).toContain("<title>");
    for (const [nom, obtenu] of [
      ["cookie forgé", await servi(TABLEAU_DE_BORD, signeAvecUnAutreSecret())],
      ["cookie aléatoire", await servi(TABLEAU_DE_BORD, randomBytes(32).toString("base64url"))],
      ["cookie vide", await servi(TABLEAU_DE_BORD, "")],
    ] as const) {
      expect(obtenu, nom).toEqual(attendu);
    }
  });

  test("le document d'une page introuvable ne contient aucun texte anglais", async ({
    request,
  }) => {
    for (const chemin of [TABLEAU_DE_BORD, "/adresse-inexistante", "/lien/inexistant"]) {
      const document = documentServi(await (await request.get(chemin)).text());

      expect(document, chemin).not.toMatch(/404|not found|could not be found/i);
    }
  });

  test("rien du gabarit dans le HTML ni dans la charge utile RSC", async ({ request }) => {
    const html = await (await request.get(TABLEAU_DE_BORD)).text();

    // Document d'erreur de Next.js : la page « introuvable » n'est rendue
    // qu'après hydratation (section 5 de la fiche du contrôle).
    expect(html).toContain('<html id="__next_error__">');
    for (const chemin of [
      TABLEAU_DE_BORD,
      `/adresse-inexistante-${randomBytes(4).toString("hex")}`,
    ]) {
      const page = await request.get(chemin);
      const rsc = await request.get(chemin, { headers: { rsc: "1" } });
      const [corps, charge] = [await page.text(), await rsc.text()];

      expect(page.status(), chemin).toBe(404);
      expect(rsc.headers()["content-type"], chemin).toContain("text/x-component");
      for (const texte of TEXTES_GABARIT) {
        expect(corps, `${chemin} : ${texte}`).not.toContain(texte);
        expect(charge, `${chemin} : ${texte}`).not.toContain(texte);
      }
    }
  });

  test("la réponse porte la politique et les en-têtes, sans cookie posé ni mise en cache", async ({
    request,
  }) => {
    const reponse = await request.get(TABLEAU_DE_BORD);
    const recus = reponse.headers();

    expect(reponse.status()).toBe(404);
    expect(sansNonce(recus["content-security-policy"])).toEqual(POLITIQUE_PRODUCTION);
    expect(Buffer.from(nonceDe(recus["content-security-policy"]), "base64")).toHaveLength(16);
    for (const [entete, valeur] of Object.entries(ENTETES_SECTION_6)) {
      expect(recus[entete], entete).toBe(valeur);
    }
    expect(recus["x-powered-by"]).toBeUndefined();
    expect(recus["set-cookie"]).toBeUndefined();
    expect(recus["cache-control"]).toContain("no-store");
    expect(recus["cache-control"]).toContain("private");
  });

  test("aucune violation de la politique", async ({ page }) => {
    await observerViolations(page);

    await page.goto(TABLEAU_DE_BORD);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_ERREURS.introuvable);

    expect(await violations(page)).toEqual([]);
  });
});

// /api/auth n'est pas exposé avant la 1.1 (CLAUDE.md, règle 11) : une
// adresse sans route, comme une autre.
test.describe("points d'entrée non exposés", () => {
  // 1.1 (modifié, signalé) : /api/auth est exposé, avec une liste fermée de
  // trois points d'entrée (docs/features/inscription.md, section 2). Un point
  // fermé reçoit la réponse d'un chemin inexistant sous /api/auth (404, corps
  // vide), comme la tâche quotidienne sous /api/taches (S-02, portée « sous
  // une même route ») ; le détail, point par point, est dans
  // e2e/auth.attaque.spec.ts.
  test("/api/auth/get-session est fermé : même réponse qu'un chemin inexistant de /api/auth", async ({
    request,
  }) => {
    const auth = await request.get("/api/auth/get-session");
    const inexistante = await request.get("/api/auth/n-existe-pas");

    expect(auth.status()).toBe(404);
    expect(inexistante.status()).toBe(404);
    expect(await auth.text()).toBe("");
    expect(await auth.text()).toBe(await inexistante.text());
  });
});

// Zone (compte) de la 1.2 : sans session valide, /compte répond « introuvable »,
// la même réponse avec ou sans cookie forgé, et rien de la page ni de son
// gabarit ne part vers le navigateur (tests d'attaque « accès sans session »
// et « entrée falsifiée »). Fiche : docs/features/connexion.md, section 5.1.
test.describe("zone compte, sans session valide", () => {
  const COMPTE = "/compte";
  const TEXTES_ZONE_COMPTE = [
    TEXTES_COMPTE.compte.titre,
    TEXTES_COMPTE.compte.connecte,
    TEXTES_COMPTE.deconnexion.bouton,
  ];

  test("sans cookie : « introuvable », 404", async ({ page }) => {
    const obtenu = await rendu(page, COMPTE);

    expect(obtenu.statut).toBe(404);
    expect(obtenu.h1).toEqual([TEXTES_ERREURS.introuvable]);
  });

  test("cookies forgés : identiques à l'absence de cookie, dans le navigateur et en HTML brut", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const attendu = await rendu(page, COMPTE);
    await forger(context, baseURL, signeAvecUnAutreSecret());
    expect(await rendu(page, COMPTE)).toEqual(attendu);

    const servi = async (cookie?: string) => {
      const reponse = await request.get(COMPTE, {
        maxRedirects: 0,
        headers: cookie === undefined ? {} : { cookie: `${COOKIE_SESSION}=${cookie}` },
      });
      return { statut: reponse.status(), document: documentServi(await reponse.text()) };
    };
    const brut = await servi();
    expect(brut.statut).toBe(404);
    for (const cookie of [signeAvecUnAutreSecret(), randomBytes(32).toString("base64url"), ""]) {
      expect(await servi(cookie)).toEqual(brut);
    }
  });

  test("rien de la page ni du gabarit de compte dans le HTML ni dans la charge utile RSC", async ({
    request,
  }) => {
    const page = await request.get(COMPTE);
    const rsc = await request.get(COMPTE, { headers: { rsc: "1" } });
    const [corps, charge] = [await page.text(), await rsc.text()];

    expect(page.status()).toBe(404);
    for (const texte of [...TEXTES_ZONE_COMPTE, ...TEXTES_GABARIT]) {
      expect(corps, texte).not.toContain(texte);
      expect(charge, texte).not.toContain(texte);
    }
  });
});

// T-02, S-12 : un Propriétaire sans second facteur, connecté et membre d'une
// organisation, reçoit sur /tableau-de-bord la même page « introuvable »
// qu'un visiteur sans session, sans rien du gabarit ; après l'activation par
// /compte (qui lui reste ouverte), le gabarit s'affiche. L'adhésion vient de
// l'organisation de test (e2e/organisation-e2e.ts), sur la base jetable ou en
// CI seulement. Fiche : docs/features/double-authentification.md, section 9,
// test 31.
test.describe("zone application, Propriétaire sans second facteur", () => {
  const outil = outilOrganisation();
  test.skip("saut" in outil, "saut" in outil ? outil.saut : "");

  test.afterAll(async () => {
    if (!("saut" in outil)) await outil.nettoyer();
  });

  test("« introuvable » comme sans session, puis le gabarit après l'activation", async ({
    page,
    context,
    request,
  }, info) => {
    if ("saut" in outil) throw new Error(outil.saut);
    const sansSession = await rendu(page, TABLEAU_DE_BORD);
    const brutSansSession = documentEtFlux(await (await request.get(TABLEAU_DE_BORD)).text());

    const email = adresseDoubleAuth(info, "proprietaire");
    await preparer(page, context, email);
    await outil.rattacher(email);

    expect(await rendu(page, TABLEAU_DE_BORD)).toEqual(sansSession);
    const cookie = (await context.cookies()).find((c) => c.name === COOKIE_SESSION);
    const brut = await page.request.get(TABLEAU_DE_BORD, {
      headers: { cookie: `${COOKIE_SESSION}=${cookie?.value ?? ""}` },
    });
    const html = await brut.text();
    expect(brut.status()).toBe(404);
    expect(documentEtFlux(html)).toEqual(brutSansSession);
    for (const texte of TEXTES_GABARIT) expect(html).not.toContain(texte);

    await activer(page);
    await page.goto(TABLEAU_DE_BORD);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      TEXTES_NAVIGATION.entrees.tableauDeBord,
    );
    await expect(page.getByText(TEXTES_NAVIGATION.roles.proprietaire).first()).toBeVisible();
  });
});
