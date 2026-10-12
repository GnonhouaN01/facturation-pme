import { expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";

import { observerViolations, violations } from "./outils";
import { capturer, defilementHorizontal, PAGES } from "./pages-livrees";

// Affichage des pages livrées et joignables sans session, à 390 et 1280 px
// (un projet Playwright par largeur ; 360 px dans e2e/affichage-360.spec.ts)
// (NF-03, NF-04). Les captures se comparent à la main à la section 10. Aucune
// comparaison automatique : le rendu des polices diffère entre Windows et la
// CI. Le gabarit de l'application connecté est vérifié par rendu en chaîne
// (src/components/gabarits/gabarits.test.tsx), et dans un navigateur à la 1.2.
// Fiche : docs/features/socle-interface.md, section 12.

const ACCENT = "rgb(36, 72, 201)";

for (const definition of PAGES) {
  test.describe(`page ${definition.nom}`, () => {
    test("structure : langue, un seul titre, aucune violation de la politique", async ({
      page,
    }) => {
      await observerViolations(page);

      await definition.ouvrir(page);

      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      expect(await violations(page)).toEqual([]);
    });

    test("aucun défilement horizontal à la largeur du projet, et capture", async ({ page }) => {
      await definition.ouvrir(page);

      const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
      expect(largeurContenu).toBeLessThanOrEqual(largeurFenetre);
      await capturer(page, definition.nom);
    });

    test("liens et boutons : cibles d'au moins 44 px de haut", async ({ page }) => {
      await definition.ouvrir(page);

      const cibles = page.locator("a:visible, button:visible, summary:visible");
      const hauteurs = await cibles.evaluateAll((elements) =>
        elements.map((element) => ({
          texte: (element.textContent ?? "").trim(),
          hauteur: element.getBoundingClientRect().height,
        })),
      );
      for (const { texte, hauteur } of hauteurs) {
        expect(hauteur, texte).toBeGreaterThanOrEqual(44);
      }
    });

    if (definition.premiereAction !== null) {
      const premiereAction = definition.premiereAction;
      test("première tabulation : l'action, avec l'anneau de focus Signal", async ({ page }) => {
        await definition.ouvrir(page);
        const action = premiereAction(page);
        await expect(action).toBeVisible();

        await page.keyboard.press("Tab");

        await expect(action).toBeFocused();
        await expect(action).toHaveCSS("outline-width", "2px");
        await expect(action).toHaveCSS("outline-style", "solid");
        await expect(action).toHaveCSS("outline-color", ACCENT);
        await expect(action).toHaveCSS("outline-offset", "2px");
      });
    }
  });
}

// La zone publique : en-tête au nom du produit, contenu, pied de page ; le
// titre et la phrase de présentation, textes exacts, sans bouton (section 1,
// décision 30).
test.describe("zone publique : disposition", () => {
  test("en-tête, contenu et pied de page ; le titre, la phrase, aucun bouton", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("banner")).toContainText(TEXTES_COMMUNS.produit);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const contenu = page.getByRole("main");
    await expect(contenu.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMMUNS.produit);
    await expect(contenu.getByText(TEXTES_COMMUNS.description, { exact: true })).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
  });
});
