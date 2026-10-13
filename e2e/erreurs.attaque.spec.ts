import { randomBytes } from "node:crypto";
import { connect } from "node:net";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_ERREURS } from "../src/textes/erreurs";

import {
  ENTETES_SECTION_6,
  nonceDe,
  observerViolations,
  POLITIQUE_PRODUCTION,
  sansNonce,
  violations,
} from "./outils";
import {
  ADRESSE_PANNE,
  COOKIE_SESSION,
  cookieSessionSigne,
  PORT_BASE_FERME,
  VALEURS_FACTICES,
} from "./serveur-panne";

// Page « introuvable » sur le site construit (S-02, T-30), et page « erreur »
// sur le second serveur, dont la base est injoignable (T-35).
// Fiche : docs/features/socle-interface.md, sections 3 et 4.

type Rendu = { statut: number | undefined; titre: string; texte: string };

async function rendu(page: Page, chemin: string): Promise<Rendu> {
  const reponse = await page.goto(chemin);
  return {
    statut: reponse?.status(),
    titre: await page.title(),
    texte: await page.locator("body").innerText(),
  };
}

test.describe("page « introuvable »", () => {
  test("une adresse inexistante : 404, le texte exact, le retour à l'accueil", async ({ page }) => {
    const reponse = await page.goto("/adresse-inexistante");

    expect(reponse?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_ERREURS.introuvable);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const retour = page.getByRole("link", { name: TEXTES_COMMUNS.revenirAccueil });
    await expect(retour).toHaveAttribute("href", "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("ni « 404 » ni texte anglais, dans la page ou dans le titre de l'onglet", async ({
    page,
  }) => {
    const { titre, texte } = await rendu(page, "/adresse-inexistante");

    expect(titre).not.toMatch(/404/);
    expect(texte).not.toMatch(/404/);
    expect(`${titre} ${texte}`).not.toMatch(/not found|could not be found/i);
  });

  // S-02, T-30 : une page de l'application ouverte sans session, ou avec un
  // cookie de session forgé, affiche la même page « introuvable ». Le nom
  // d'une page est public : il n'est pas comparé à une adresse inexistante
  // (docs/features/controle-deploiement.md, section 5).
  test("identique pour une page de l'application sans session et avec un cookie forgé", async ({
    page,
    context,
    baseURL,
  }) => {
    const sansSession = await rendu(page, "/tableau-de-bord");

    const forge = randomBytes(32).toString("base64url");
    // Sur http://localhost, le navigateur refuse le préfixe __Secure- : seul
    // le nom sans préfixe est forgé.
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: `${forge}.${randomBytes(32).toString("base64url")}`,
        url: baseURL ?? "",
      },
    ]);
    const cookieForge = await rendu(page, "/tableau-de-bord");

    expect(sansSession.statut).toBe(404);
    expect(sansSession.texte).toContain(TEXTES_ERREURS.introuvable);
    expect(cookieForge).toEqual(sansSession);
  });
});

// Second serveur : configuration valide, base injoignable (section 4.3,
// niveau 3, décision 17). La panne est réelle : la lecture de la session
// échoue à la connexion. Aucun code de test n'existe dans l'application.
test.describe("page « erreur », serveur à la base injoignable", () => {
  test.use({ baseURL: ADRESSE_PANNE });

  // Ce que la page, sa charge utile et la console ne doivent jamais contenir.
  const MARQUEURS: readonly (string | RegExp)[] = [
    "DATABASE_URL",
    "BETTER_AUTH",
    "Variables d'environnement",
    /postgres/i,
    "app_facturation",
    "ECONNREFUSED",
    "node_modules",
    /[\\/]\.next[\\/]/,
    // Ligne de pile : « at /chemin » ou « at fonction (/chemin ».
    /\bat \S*[\\/]/,
    /\bat (async )?\S+ \(/,
    // Classes d'erreur possibles sur ce chemin.
    "ErreurPage",
    "RefusUniforme",
    "AggregateError",
    "DrizzleQueryError",
    "DrizzleError",
    "TypeError",
    ...VALEURS_FACTICES,
  ];

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // Statut du document d'erreur de Next.js, constaté le 2026-10-12.
  const STATUT_PANNE = 500;

  function marqueursTrouves(texte: string): string[] {
    return MARQUEURS.filter((marqueur) =>
      typeof marqueur === "string" ? texte.includes(marqueur) : marqueur.test(texte),
    ).map(String);
  }

  async function poserCookie(page: Page) {
    await page
      .context()
      .addCookies([{ name: COOKIE_SESSION, value: cookieSessionSigne(), url: ADRESSE_PANNE }]);
  }

  function identifiant(page: Page) {
    return page.locator("main .font-mono");
  }

  async function lire(request: APIRequestContext, entetes: Record<string, string> = {}) {
    return request.get("/tableau-de-bord", {
      headers: { cookie: `${COOKIE_SESSION}=${cookieSessionSigne()}`, ...entetes },
    });
  }

  // Sans cette condition, les tests suivants ne prouveraient rien : une base
  // joignable ne tomberait pas en panne.
  test("la base du second serveur est injoignable : port fermé sur 127.0.0.1", async () => {
    const issue = await new Promise<string>((resoudre) => {
      const socket = connect({ host: "127.0.0.1", port: PORT_BASE_FERME });
      socket.setTimeout(10_000);
      socket.once("connect", () => {
        socket.destroy();
        resoudre("ouvert");
      });
      socket.once("timeout", () => {
        socket.destroy();
        resoudre("délai dépassé");
      });
      socket.once("error", (erreur: NodeJS.ErrnoException) => resoudre(erreur.code ?? "erreur"));
    });

    expect(issue).toBe("ECONNREFUSED");
  });

  test("le proxy ne dépend pas d'env.ts : l'accueil répond, avec la politique", async ({
    request,
  }) => {
    const reponse = await request.get("/");

    expect(reponse.status()).toBe(200);
    const politique = reponse.headers()["content-security-policy"];
    expect(sansNonce(politique)).toEqual(POLITIQUE_PRODUCTION);
    expect(Buffer.from(nonceDe(politique), "base64")).toHaveLength(16);
  });

  test("la page affiche le texte fixe, un identifiant et les deux actions", async ({ page }) => {
    await observerViolations(page);
    await poserCookie(page);

    const reponse = await page.goto("/tableau-de-bord");

    expect(sansNonce(reponse?.headers()["content-security-policy"])).toEqual(POLITIQUE_PRODUCTION);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_ERREURS.erreur);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText(TEXTES_ERREURS.identifiantIncident)).toBeVisible();
    // L'incident de la chaîne (crypto.randomUUID), porté par ErreurPage.digest,
    // et non une empreinte calculée par Next.js (section 4.2).
    await expect(identifiant(page)).toHaveText(UUID);
    await expect(page.getByRole("button", { name: TEXTES_ERREURS.recharger })).toBeVisible();
    await expect(page.getByRole("link", { name: TEXTES_COMMUNS.revenirAccueil })).toHaveAttribute(
      "href",
      "/",
    );
    expect(await violations(page)).toEqual([]);
  });

  // Corrigé à la PR 3 avec l'accord du relecteur (décision 32) : une erreur
  // levée hors d'une frontière Suspense fait échouer le squelette de la page.
  // Next.js renvoie alors son document d'erreur, au corps vide ; la page
  // « erreur » n'est rendue que dans le navigateur, à partir du digest de la
  // charge utile (section 4.3).
  test("aucun détail dans le HTML", async ({ request }) => {
    const reponse = await lire(request);
    const html = await reponse.text();
    const recus = reponse.headers();

    // Le test porte bien sur le document d'erreur de Next.js.
    expect(reponse.status()).toBe(STATUT_PANNE);
    expect(html).toMatch(/<html[^>]*\bid="__next_error__"/);
    expect(html).not.toContain("data-next-error-");
    // Chaque digest de la charge utile est un incident de la chaîne (UUID).
    const digests = [...html.matchAll(/"digest[^0-9a-z]{1,8}([^"&]{1,80}?)[^0-9a-z-]/g)].map(
      (trouve) => trouve[1] ?? "",
    );
    expect(digests.length).toBeGreaterThan(0);
    for (const digest of digests) expect(digest).toMatch(UUID);
    // La politique et les en-têtes de sécurité, comme sur toute réponse.
    expect(sansNonce(recus["content-security-policy"])).toEqual(POLITIQUE_PRODUCTION);
    expect(Buffer.from(nonceDe(recus["content-security-policy"]), "base64")).toHaveLength(16);
    for (const [entete, valeur] of Object.entries(ENTETES_SECTION_6)) {
      expect(recus[entete], entete).toBe(valeur);
    }
    expect(recus["x-powered-by"]).toBeUndefined();
    expect(marqueursTrouves(html)).toEqual([]);
    expect(marqueursTrouves(JSON.stringify(recus))).toEqual([]);
  });

  test("aucun détail dans la charge utile RSC", async ({ request }) => {
    const reponse = await lire(request, { rsc: "1" });
    const charge = await reponse.text();

    // Le test porte bien sur une charge utile RSC, et sur la page en panne.
    expect(reponse.headers()["content-type"]).toContain("text/x-component");
    expect(charge).toContain("digest");
    expect(marqueursTrouves(charge)).toEqual([]);
  });

  test("aucun détail dans la page affichée, après hydratation", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));
    page.on("pageerror", (erreur) => messages.push(`${erreur.name} ${erreur.message}`));
    await poserCookie(page);

    await page.goto("/tableau-de-bord");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_ERREURS.erreur);
    expect(marqueursTrouves(await page.locator("body").innerText())).toEqual([]);
    expect(marqueursTrouves(await page.content())).toEqual([]);
    expect(marqueursTrouves(messages.join("\n"))).toEqual([]);
  });

  // Ajouté à la demande du relecteur (fiche, « Tests d'attaque », PR 3) :
  // « Recharger la page » relance bien le rendu par le serveur. Chaque rendu
  // en panne reçoit un nouvel incident : un identifiant inchangé trahirait un
  // bouton qui ne fait que réafficher l'erreur gardée par le navigateur.
  test("« Recharger la page » relance l'affichage par le serveur", async ({ page }) => {
    await observerViolations(page);
    await poserCookie(page);
    await page.goto("/tableau-de-bord");
    await page.waitForLoadState("networkidle");
    await expect(identifiant(page)).toHaveText(UUID);
    const premier = await identifiant(page).innerText();

    const relance = page.waitForRequest(
      (requete) => new URL(requete.url()).pathname === "/tableau-de-bord",
    );
    await page.getByRole("button", { name: TEXTES_ERREURS.recharger }).click();
    await relance;

    await expect(identifiant(page)).not.toHaveText(premier);
    await expect(identifiant(page)).toHaveText(UUID);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_ERREURS.erreur);
    expect(await violations(page)).toEqual([]);
  });
});
