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
