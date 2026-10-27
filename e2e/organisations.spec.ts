import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";

import { ADRESSE } from "./compte-verifie";
import { adresseE2E } from "./comptes-e2e";
import { activer, preparer } from "./double-auth";
import { outilOrganisation } from "./organisation-e2e";
import { observerViolations, violations } from "./outils";
import { capturer, defilementHorizontal } from "./pages-livrees";

// Créer son organisation et en changer (2.1), sur le site construit, aux
// deux largeurs. Chaque création écrit une trace en ajout seul : ces tests ne
// tournent que sur la base jetable ou en CI (même condition que l'outil
// d'organisation), jamais sur dev. Rangs 35 et 36. Fiche :
// docs/features/organisations.md, « Tests de bout en bout ».

const TEXTES = TEXTES_COMPTE.organisations;
const outil = outilOrganisation();

function adresse(info: TestInfo, rang: 35 | 36): string {
  return adresseE2E(info.project.name, rang, info.retry, info.repeatEachIndex);
}

function nomDansBarre(page: Page) {
  return page.locator("aside");
}

async function creer(page: Page, raisonSociale: string) {
  await page.goto("/compte");
  await page.getByLabel(TEXTES.raisonSociale).fill(raisonSociale);
  await page.getByRole("button", { name: TEXTES.creer }).click();
}

test.describe("organisations", () => {
  test.skip("saut" in outil, "saut" in outil ? outil.saut : "");

  test.afterAll(async () => {
    if (!("saut" in outil)) await outil.nettoyer();
  });

  test("créer sans second facteur : renvoi vers l'activation, puis ouverture de l'organisation", async ({
    page,
    context,
  }, info) => {
    await observerViolations(page);
    await preparer(page, context, adresse(info, 35));
    await page.goto("/compte");
    await expect(page.getByText(TEXTES.aucune)).toBeVisible();
    const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
    expect(largeurContenu).toBeLessThanOrEqual(largeurFenetre);
    await capturer(page, "organisations-vide");

    // Raison sociale vide : message relié au champ, rien n'est créé.
    await page.getByRole("button", { name: TEXTES.creer }).click();
    const champ = page.getByLabel(TEXTES.raisonSociale);
    await expect(champ).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(TEXTES.erreurRaisonSociale)).toBeVisible();

    await creer(page, "  Kouamé   & Fils  ");
    await expect(page).toHaveURL(`${ADRESSE}/compte/double-authentification`);

    // Sans second facteur, la zone application reste introuvable.
    const refusee = await page.goto("/tableau-de-bord");
    expect(refusee?.status()).toBe(404);

    await activer(page);
    await page.goto("/compte");
    const ligne = page.getByRole("listitem").filter({ hasText: "Kouamé & Fils" });
    await expect(ligne).toContainText(TEXTES_NAVIGATION.roles.proprietaire);
    await capturer(page, "organisations-liste");
    await ligne.getByRole("button", { name: `${TEXTES.ouvrir} Kouamé & Fils` }).click();
    await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);
    await expect(nomDansBarre(page)).toContainText("Kouamé & Fils");
    await expect(
      page.getByRole("link", { name: TEXTES_NAVIGATION.changerOrganisation }),
    ).toBeVisible();
    await capturer(page, "organisations-tableau");
    expect(await violations(page)).toEqual([]);
  });

  test("membre de deux organisations : passer de l'une à l'autre", async ({
    page,
    context,
  }, info) => {
    if ("saut" in outil) throw new Error(outil.saut);
    const email = adresse(info, 36);
    await preparer(page, context, email);
    await activer(page);
    await creer(page, "Première SARL");
    await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);
    await expect(nomDansBarre(page)).toContainText("Première SARL");

    // Seconde adhésion, posée par l'outil de la base jetable : il en fait
    // aussi l'organisation active.
    await outil.rattacher(email);
    await page.goto("/compte");
    await expect(page.getByRole("listitem")).toHaveCount(2);

    await page.getByRole("button", { name: `${TEXTES.ouvrir} Première SARL` }).click();
    await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);
    await expect(nomDansBarre(page)).toContainText("Première SARL");

    await page.getByRole("link", { name: TEXTES_NAVIGATION.changerOrganisation }).click();
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    await page
      .getByRole("button", { name: `${TEXTES.ouvrir} Organisation de bout en bout` })
      .click();
    await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);
    await expect(nomDansBarre(page)).toContainText("Organisation de bout en bout");
  });
});
