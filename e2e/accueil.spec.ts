import { expect, test } from "@playwright/test";

test("la page d'accueil affiche le bouton", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Facturation PME" })).toBeVisible();
});

test("le bouton de la page d'accueil applique le thème Signal", async ({ page }) => {
  await page.goto("/");

  const bouton = page.getByRole("button", { name: "Facturation PME" });
  await expect(bouton).toHaveCSS("background-color", "rgb(36, 72, 201)");
  await expect(bouton).toHaveCSS("font-family", /^"?DM Sans/);
});

test("le bouton de la page d'accueil a la forme Signal", async ({ page }) => {
  await page.goto("/");

  const bouton = page.getByRole("button", { name: "Facturation PME" });
  const boite = await bouton.boundingBox();
  expect(boite?.height).toBeGreaterThanOrEqual(44);
  await expect(bouton).toHaveCSS("border-radius", "8px");
});

test("la page d'accueil porte le titre et la langue française", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Facturation PME");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("le bouton de la page d'accueil affiche un contour au focus clavier", async ({ page }) => {
  await page.goto("/");

  const bouton = page.getByRole("button", { name: "Facturation PME" });
  await page.keyboard.press("Tab");
  await expect(bouton).toBeFocused();
  await expect(bouton).toHaveCSS("outline-width", "2px");
  await expect(bouton).toHaveCSS("outline-color", "rgb(36, 72, 201)");
  await expect(bouton).toHaveCSS("outline-offset", "2px");
});

test("le bouton de la page d'accueil change de fond au survol", async ({ page }) => {
  await page.goto("/");

  const bouton = page.getByRole("button", { name: "Facturation PME" });
  await bouton.hover();
  await expect(bouton).toHaveCSS("background-color", "rgb(27, 55, 158)");
});

test("le bouton de la page d'accueil change de fond à l'état pressé", async ({ page }) => {
  await page.goto("/");

  const bouton = page.getByRole("button", { name: "Facturation PME" });
  await bouton.hover();
  await page.mouse.down();
  await expect(bouton).toHaveCSS("background-color", "rgb(27, 55, 158)");
  await page.mouse.up();
});
