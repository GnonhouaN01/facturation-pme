import { createHmac, randomBytes } from "node:crypto";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_ERREURS } from "../src/textes/erreurs";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";
import { TEXTES_SIMULATION } from "../src/textes/simulation";

import {
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
  // inexistante (S-02). Le test précédent compare le rendu après hydratation.
  // Fiche : docs/features/controle-deploiement.md, section 5.
  test("HTML brut, sans JavaScript : même statut, même titre, même page « introuvable »", async ({
    request,
  }) => {
    const servi = async (chemin: string) => {
      const reponse = await request.get(chemin, { maxRedirects: 0 });
      const html = await reponse.text();
      const texte = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<head\b[\s\S]*?<\/head>/i, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        statut: reponse.status(),
        titre: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null,
        texte,
      };
    };

    const attendu = await servi(`/adresse-inexistante-${randomBytes(4).toString("hex")}`);
    const obtenu = await servi(TABLEAU_DE_BORD);

    expect(attendu.statut).toBe(404);
    expect(attendu.texte).toContain(TEXTES_ERREURS.introuvable);
    expect(obtenu).toEqual(attendu);
  });

  test("rien du gabarit dans le HTML ni dans la charge utile RSC", async ({ request }) => {
    const html = await (await request.get(TABLEAU_DE_BORD)).text();
    const rsc = await request.get(TABLEAU_DE_BORD, { headers: { rsc: "1" } });
    const charge = await rsc.text();

    expect(html).toContain(TEXTES_ERREURS.introuvable);
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
