import { expect, test } from "@playwright/test";

test("la page d'accueil affiche le bouton", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Facturation PME" })).toBeVisible();
});

test("la page d'accueil porte le titre et la langue française", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Facturation PME");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});
