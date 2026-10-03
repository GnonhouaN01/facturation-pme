import { expect, test } from "@playwright/test";

test("la page d'accueil affiche le bouton", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Facturation PME" })).toBeVisible();
});
