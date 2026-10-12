import { type Page, expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";

// L'accueil, et le thème Signal vérifié sur l'action de la page
// « introuvable » : l'accueil perd son bouton en PR 3.
// Fiche : docs/features/socle-interface.md, section 3.

// PR 3 (modifié, signalé) : l'accueil, déplacé dans la zone publique, n'a
// plus de bouton (section 1) ; le titre est le nom du produit, la phrase sa
// description (décision 30).
test("la page d'accueil affiche le titre et la présentation, sans bouton", async ({ page }) => {
  await page.goto("/");

  const contenu = page.getByRole("main");
  await expect(contenu.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMMUNS.produit);
  await expect(contenu.getByText(TEXTES_COMMUNS.description, { exact: true })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("la page d'accueil porte le titre et la langue française", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Facturation PME");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

const INTROUVABLE = "/adresse-inexistante";

function actionIntrouvable(page: Page) {
  return page.getByRole("link", { name: TEXTES_COMMUNS.revenirAccueil });
}

test("l'action de la page « introuvable » applique le thème Signal", async ({ page }) => {
  await page.goto(INTROUVABLE);

  const action = actionIntrouvable(page);
  await expect(action).toHaveCSS("background-color", "rgb(36, 72, 201)");
  await expect(action).toHaveCSS("font-family", /^"?DM Sans/);
});

test("l'action de la page « introuvable » a la forme Signal", async ({ page }) => {
  await page.goto(INTROUVABLE);

  const action = actionIntrouvable(page);
  const boite = await action.boundingBox();
  expect(boite?.height).toBeGreaterThanOrEqual(44);
  await expect(action).toHaveCSS("border-radius", "8px");
});

test("l'action de la page « introuvable » affiche un contour au focus clavier", async ({
  page,
}) => {
  await page.goto(INTROUVABLE);

  const action = actionIntrouvable(page);
  await expect(action).toBeVisible();
  // Une seule tabulation : la page est rendue dans le gabarit racine, sans
  // navigation de zone ni lien d'évitement (fiche, section 3), et l'action
  // est son premier élément focalisable.
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  await expect(action).toHaveCSS("outline-width", "2px");
  await expect(action).toHaveCSS("outline-color", "rgb(36, 72, 201)");
  await expect(action).toHaveCSS("outline-offset", "2px");
});

test("l'action de la page « introuvable » change de fond au survol", async ({ page }) => {
  await page.goto(INTROUVABLE);

  const action = actionIntrouvable(page);
  await action.hover();
  await expect(action).toHaveCSS("background-color", "rgb(27, 55, 158)");
});

test("l'action de la page « introuvable » change de fond à l'état pressé", async ({ page }) => {
  await page.goto(INTROUVABLE);

  const action = actionIntrouvable(page);
  await action.hover();
  await page.mouse.down();
  await expect(action).toHaveCSS("background-color", "rgb(27, 55, 158)");
  await page.mouse.up();
});
