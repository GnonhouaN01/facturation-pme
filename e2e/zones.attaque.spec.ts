import { createHmac, randomBytes } from "node:crypto";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_ERREURS } from "../src/textes/erreurs";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";
import { TEXTES_SIMULATION } from "../src/textes/simulation";

import {
  documentServi,
  ENTETES_SECTION_6,
  nonceDe,
  observerViolations,
  POLITIQUE_PRODUCTION,
  sansNonce,
  violations,
} from "./outils";

// La zone application ouverte sans session valide (S-02, T-30) : la page du
// tableau de bord répond comme une adresse inexistante, et rien du gabarit
// (navigation, rôle, bandeau) ne part vers le navigateur. Tests d'attaque
// « accès sans session » et « entrée falsifiée » de PLAN.md, section 4.3.
// Fiche : docs/features/socle-interface.md, sections 2.2, 2.3 et 3.

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

async function inexistante(page: Page): Promise<Rendu> {
  return rendu(page, `/adresse-inexistante-${randomBytes(4).toString("hex")}`);
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
  test("sans cookie : « introuvable », 404, identique à une adresse inexistante", async ({
    page,
  }) => {
    const attendu = await inexistante(page);
    const obtenu = await rendu(page, TABLEAU_DE_BORD);

    expect(attendu.statut).toBe(404);
    expect(attendu.h1).toEqual([TEXTES_ERREURS.introuvable]);
    expect(obtenu).toEqual(attendu);
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
    test(`cookie de session forgé (${nom}) : identique à une adresse inexistante`, async ({
      page,
      context,
      baseURL,
    }) => {
      const attendu = await inexistante(page);
      await forger(context, baseURL, valeur());

      expect(await rendu(page, TABLEAU_DE_BORD)).toEqual(attendu);
    });
  }

  // HTML brut, sans navigateur ni JavaScript : un client qui ne l'exécute pas
  // ne doit pas distinguer une page de l'application d'une adresse
  // inexistante (S-02). Next.js 16.4 ne rend pas not-found.tsx sur le serveur
  // après un notFound() : toute page introuvable passe donc par notFound()
  // (route attrape-tout), et toutes reçoivent son document d'erreur, au corps
  // vide ; la page « introuvable » s'affiche après hydratation (tests
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

    const attendu = await servi(`/adresse-inexistante-${randomBytes(4).toString("hex")}`);

    expect(attendu.statut).toBe(404);
    expect(attendu.document).toContain("<title>");
    for (const [nom, obtenu] of [
      ["sans cookie", await servi(TABLEAU_DE_BORD)],
      ["cookie forgé", await servi(TABLEAU_DE_BORD, signeAvecUnAutreSecret())],
      ["cookie aléatoire", await servi(TABLEAU_DE_BORD, randomBytes(32).toString("base64url"))],
      ["autre adresse inexistante", await servi("/a/b/c")],
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
    const rsc = await request.get(TABLEAU_DE_BORD, { headers: { rsc: "1" } });
    const charge = await rsc.text();

    // Document d'erreur de Next.js : la page « introuvable » n'est rendue
    // qu'après hydratation (section 5 de la fiche du contrôle).
    expect(html).toContain('<html id="__next_error__">');
    expect(rsc.headers()["content-type"]).toContain("text/x-component");
    for (const texte of TEXTES_GABARIT) {
      expect(html, texte).not.toContain(texte);
      expect(charge, texte).not.toContain(texte);
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

// La route attrape-tout (src/app/[...introuvable]/page.tsx) ne vise que les
// adresses sans page : l'accueil, les fichiers servis par Next.js et les
// routes plus précises passent avant elle. Fiche :
// docs/features/controle-deploiement.md, section 5.
test.describe("route attrape-tout des pages introuvables", () => {
  test("l'accueil n'est pas capturé : 200, sa page dans le HTML", async ({ request }) => {
    const reponse = await request.get("/");
    const html = await reponse.text();

    expect(reponse.status()).toBe(200);
    expect(html).not.toContain('<html id="__next_error__">');
    expect(html).toMatch(new RegExp(`<h1[^>]*>${TEXTES_COMMUNS.produit}</h1>`));
  });

  test("les fichiers servis par Next.js ne sont pas capturés", async ({ request }) => {
    const accueil = await (await request.get("/")).text();
    const script = /<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/i.exec(accueil)?.[1];
    const feuille = /<link[^>]+href="(\/_next\/static\/[^"]+\.css)"/i.exec(accueil)?.[1];
    if (!script || !feuille) throw new Error("aucun fichier de /_next/static dans l'accueil");

    // Pas de dossier public/ : favicon.ico, servi depuis src/app/, est le seul
    // fichier à la racine.
    for (const [chemin, type] of [
      [script, "javascript"],
      [feuille, "text/css"],
      ["/favicon.ico", "image/x-icon"],
    ] as const) {
      const reponse = await request.get(chemin);
      expect(reponse.status(), chemin).toBe(200);
      expect(reponse.headers()["content-type"], chemin).toContain(type);
    }
  });

  test("une route.ts sous /api/auth passera avant la route attrape-tout", () => {
    // Ordre dans lequel Next.js essaie les routes dynamiques (routes-manifest,
    // trié par getSortedRoutes) ; une route statique passe toujours avant.
    // /api/auth n'est pas exposé avant la 1.1 (CLAUDE.md, règle 11).
    const tries = getSortedRoutes([
      "/[...introuvable]",
      "/api/auth/[...all]",
      "/lien/devis/[jeton]",
    ]);

    expect(tries.at(-1)).toBe("/[...introuvable]");
  });

  test("/api/auth n'est pas exposé : même document qu'une adresse inexistante", async ({
    request,
  }) => {
    const auth = await request.get("/api/auth/get-session");
    const inexistante = await request.get("/adresse-inexistante");

    expect(auth.status()).toBe(404);
    expect(documentServi(await auth.text())).toBe(documentServi(await inexistante.text()));
  });
});
