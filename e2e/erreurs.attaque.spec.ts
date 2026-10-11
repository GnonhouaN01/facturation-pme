import { randomBytes } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_ERREURS } from "../src/textes/erreurs";

// Page « introuvable » sur le site construit (S-02, T-30). La page
// « erreur » sur un serveur en panne est éprouvée en PR 3 (section 4.3).
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

  // S-02, T-30 : rien ne distingue une page qui n'existe pas d'une page de
  // l'application ouverte sans session, ou avec un cookie de session forgé.
  // Tant que /tableau-de-bord n'existe pas (PR 3), les trois adresses sont
  // inexistantes : le test ne prend toute sa valeur qu'avec la page.
  test("identique pour une adresse inexistante et pour une page de l'application sans session", async ({
    page,
    context,
    baseURL,
  }) => {
    const inexistante = await rendu(page, `/adresse-inexistante-${randomBytes(4).toString("hex")}`);
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

    expect(inexistante.statut).toBe(404);
    expect(inexistante.texte).toContain(TEXTES_ERREURS.introuvable);
    expect(sansSession).toEqual(inexistante);
    expect(cookieForge).toEqual(inexistante);
  });
});
