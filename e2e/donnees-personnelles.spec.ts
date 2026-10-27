import { expect, test } from "@playwright/test";

import { ADRESSE_CONTACT, TEXTES_DONNEES_PERSONNELLES } from "../src/textes/donnees-personnelles";

// Page publique « Données personnelles » : joignable sans session, sans
// cookie, sans ressource d'une autre origine, et liée depuis le pied de page,
// l'inscription et la connexion. Fiche : docs/features/donnees-personnelles.md,
// sections 4 et « Tests de bout en bout ».

const CHEMIN = "/donnees-personnelles";
const TEXTES = TEXTES_DONNEES_PERSONNELLES;

test("sans session : 200, le titre, aucun cookie, aucune requête vers une autre origine", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const reponse = await request.get(CHEMIN, { maxRedirects: 0 });
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()["content-type"]).toMatch(/^text\/html/);
  expect(reponse.headers()["set-cookie"]).toBeUndefined();

  const origine = new URL(baseURL ?? "").origin;
  const autres: string[] = [];
  page.on("request", (requete) => {
    if (new URL(requete.url()).origin !== origine) autres.push(requete.url());
  });
  await page.goto(CHEMIN);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES.titre);
  await expect(page.getByRole("link", { name: ADRESSE_CONTACT }).first()).toHaveAttribute(
    "href",
    `mailto:${ADRESSE_CONTACT}`,
  );
  await page.waitForLoadState("networkidle");
  expect(autres).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test("lien du pied de page, depuis l'accueil", async ({ page }) => {
  await page.goto("/");
  const lien = page.getByRole("contentinfo").getByRole("link", { name: TEXTES.liens.piedDePage });
  await expect(lien).toHaveAttribute("href", CHEMIN);
  await lien.click();
  await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES.titre);
});

for (const [nom, chemin, libelle] of [
  ["inscription", "/inscription", TEXTES.liens.inscription],
  ["connexion", "/connexion", TEXTES.liens.connexion],
] as const) {
  test(`lien depuis la page de ${nom}, dans son contenu`, async ({ page }) => {
    await page.goto(chemin);
    const lien = page.getByRole("main").getByRole("link", { name: libelle });
    await expect(lien).toHaveAttribute("href", CHEMIN);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: TEXTES.liens.piedDePage }),
    ).toHaveAttribute("href", CHEMIN);
  });
}
