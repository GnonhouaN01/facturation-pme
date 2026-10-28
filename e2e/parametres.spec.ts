import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_CONFIRMATION } from "../src/textes/confirmation";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";
import { TEXTES_PARAMETRES } from "../src/textes/parametres";

import { messagesPour } from "./boite-emails";
import { ADRESSE, MOT_DE_PASSE } from "./compte-verifie";
import { adresseE2E } from "./comptes-e2e";
import { activer, envoyerCode, motDePasse, preparer, seDeconnecter } from "./double-auth";
import { outilOrganisation } from "./organisation-e2e";
import { observerViolations, violations } from "./outils";
import { capturer, defilementHorizontal } from "./pages-livrees";
import { codeTotp } from "./totp";

// Paramètres de l'organisation (2.2), sur le site construit, aux deux
// largeurs : arrivée directe sur le tableau de bord d'un membre d'une seule
// organisation, fiche, taux, logo servi par la route, instructions de
// paiement confirmées par le mot de passe et un code de secours, email aux
// Propriétaires sans les valeurs. Les créations écrivent dans des tables sans
// suppression : base jetable ou CI seulement (même condition que l'outil
// d'organisation). Rangs 37 et 38. Fiche :
// docs/features/parametres-organisation.md, tests 15 à 17.

const TEXTES = TEXTES_PARAMETRES;
const CONFIRMATION = TEXTES_CONFIRMATION;
const outil = outilOrganisation();

// PNG de 1 × 1 pixel.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function adresse(info: TestInfo, rang: 37 | 38): string {
  return adresseE2E(info.project.name, rang, info.retry, info.repeatEachIndex);
}

async function creer(page: Page, raisonSociale: string) {
  await page.goto("/compte");
  await page.getByLabel(TEXTES_COMPTE.organisations.raisonSociale).fill(raisonSociale);
  await page.getByRole("button", { name: TEXTES_COMPTE.organisations.creer }).click();
  await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);
}

function carte(page: Page, titre: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: titre }) });
}

test.describe("paramètres de l'organisation", () => {
  test.skip("saut" in outil, "saut" in outil ? outil.saut : "");

  test.afterAll(async () => {
    if (!("saut" in outil)) await outil.nettoyer();
  });

  test("Propriétaire d'une seule organisation : arrivée directe, fiche, taux, logo, instructions", async ({
    page,
    context,
  }, info) => {
    const email = adresse(info, 37);
    await preparer(page, context, email);
    const { cle, codes } = await activer(page);
    await creer(page, "Paramètres SARL");

    // Décision 1 : une seule organisation, active dès la connexion.
    await seDeconnecter(page);
    await motDePasse(page, email);
    await envoyerCode(page, codeTotp(cle, 1));
    await expect(page).toHaveURL(`${ADRESSE}/tableau-de-bord`);

    await observerViolations(page);
    await page.getByRole("link", { name: TEXTES_NAVIGATION.entrees.organisation }).click();
    await expect(page).toHaveURL(`${ADRESSE}/parametres`);
    await expect(page.getByRole("heading", { level: 1, name: TEXTES.titre })).toBeVisible();
    const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
    expect(largeurContenu).toBeLessThanOrEqual(largeurFenetre);
    await capturer(page, "parametres");

    // Fiche : un contenu qui ressemble à du code reste du texte (S-51).
    const fiche = carte(page, TEXTES.fiche.titre);
    await fiche.getByLabel(TEXTES.fiche.adresse).fill("Cocody\nAbidjan");
    await fiche.getByLabel(TEXTES.fiche.ncc).fill("1234567 A");
    await fiche.getByLabel(TEXTES.fiche.mentions).fill("<script>alert(1)</script>");
    await fiche.getByLabel(TEXTES.fiche.validite).fill("0");
    await fiche.getByRole("button", { name: TEXTES.fiche.enregistrer }).click();
    await expect(fiche.getByLabel(TEXTES.fiche.validite)).toHaveAttribute("aria-invalid", "true");
    await fiche.getByLabel(TEXTES.fiche.validite).fill("15");
    await fiche.getByRole("button", { name: TEXTES.fiche.enregistrer }).click();
    await expect(fiche.getByRole("status")).toHaveText(TEXTES.fiche.succes);
    await page.reload();
    await expect(carte(page, TEXTES.fiche.titre).getByLabel(TEXTES.fiche.mentions)).toHaveValue(
      "<script>alert(1)</script>",
    );

    // Taux : « 9,5 » ajouté ; « Exonération » désactivé.
    const taux = carte(page, TEXTES.taux.titre);
    await expect(taux.getByRole("row", { name: /18 %/u })).toBeVisible();
    await taux.getByLabel(TEXTES.taux.libelle).fill("Réduit");
    await taux.getByLabel(TEXTES.taux.taux).fill("9,5");
    await taux.getByRole("button", { name: TEXTES.taux.ajouter }).click();
    await expect(taux.getByRole("row", { name: /Réduit/u })).toContainText("9,5 %");
    const exoneration = taux.getByRole("row", { name: /Exonération/u });
    await exoneration
      .getByRole("button", { name: `${TEXTES.taux.desactiver} Exonération` })
      .click();
    await expect(exoneration).toContainText(TEXTES.taux.desactive);

    // Logo : un PNG, servi par la route ; un HTML renommé, refusé.
    const logo = carte(page, TEXTES.logo.titre);
    await logo.getByLabel(TEXTES.logo.fichier).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await logo.getByRole("button", { name: TEXTES.logo.enregistrer }).click();
    await expect(logo.getByRole("status")).toHaveText(TEXTES.logo.succes);
    const apercu = logo.getByRole("img", { name: TEXTES.logo.apercu });
    await expect(apercu).toBeVisible();
    expect(await apercu.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    const servi = await page.request.get("/parametres/logo");
    expect(servi.status()).toBe(200);
    expect(servi.headers()["content-type"]).toBe("image/png");
    expect(servi.headers()["x-content-type-options"]).toBe("nosniff");
    expect(servi.headers()["cache-control"]).toBe("private, no-store");
    await logo.getByLabel(TEXTES.logo.fichier).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
    });
    await logo.getByRole("button", { name: TEXTES.logo.enregistrer }).click();
    await expect(logo.getByText(TEXTES.logo.erreur)).toBeVisible();

    // Instructions de paiement : fenêtre de confirmation (S-14).
    const instructions = carte(page, TEXTES.instructions.titre);
    await instructions
      .getByLabel(TEXTES.instructions.mobileMoney)
      .fill("Orange Money : 07 00 00 00 00");
    await instructions.getByLabel(TEXTES.instructions.bancaire).fill("Banque Test\nCI000 01234");
    await instructions.getByRole("button", { name: TEXTES.instructions.enregistrer }).click();
    const fenetre = page.getByRole("dialog", { name: CONFIRMATION.titre });
    await expect(fenetre).toBeVisible();
    await expect(fenetre.getByLabel(CONFIRMATION.motDePasse)).toBeFocused();
    await capturer(page, "parametres-confirmation");

    // Annuler : rien n'est envoyé, le focus revient au bouton.
    await fenetre.getByRole("button", { name: CONFIRMATION.annuler }).click();
    await expect(fenetre).toBeHidden();
    await expect(
      instructions.getByRole("button", { name: TEXTES.instructions.enregistrer }),
    ).toBeFocused();

    await instructions.getByRole("button", { name: TEXTES.instructions.enregistrer }).click();
    await fenetre.getByLabel(CONFIRMATION.motDePasse).fill("mot de passe faux 2026");
    await fenetre.getByRole("button", { name: CONFIRMATION.utiliserSecours }).click();
    await fenetre.getByLabel(CONFIRMATION.secours).fill(codes[0] ?? "");
    await fenetre.getByRole("button", { name: TEXTES.instructions.enregistrer }).click();
    await expect(fenetre.getByText(CONFIRMATION.motDePasseIncorrect)).toBeVisible();

    await fenetre.getByLabel(CONFIRMATION.motDePasse).fill(MOT_DE_PASSE);
    await fenetre.getByLabel(CONFIRMATION.secours).fill(codes[0] ?? "");
    await fenetre.getByRole("button", { name: TEXTES.instructions.enregistrer }).click();
    await expect(fenetre).toBeHidden();
    await expect(instructions.getByRole("status")).toHaveText(TEXTES.instructions.succes);
    expect(await violations(page)).toEqual([]);

    // Un email au Propriétaire, sans les valeurs saisies.
    await expect
      .poll(async () => (await messagesPour(email)).map((m) => m.sujet))
      .toContain("Instructions de paiement modifiées");
    const message = (await messagesPour(email)).find(
      (m) => m.sujet === "Instructions de paiement modifiées",
    );
    expect(message?.corps).toContain("Paramètres SARL");
    expect(message?.corps).not.toContain("07 00 00 00 00");
    expect(message?.corps).not.toContain("CI000");
  });

  test("membre de deux organisations : la connexion mène à /compte", async ({
    page,
    context,
  }, info) => {
    if ("saut" in outil) throw new Error(outil.saut);
    const email = adresse(info, 38);
    await preparer(page, context, email);
    const { cle } = await activer(page);
    await creer(page, "Première SARL");
    await outil.rattacher(email);

    await seDeconnecter(page);
    await motDePasse(page, email);
    await envoyerCode(page, codeTotp(cle, 1));
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    await expect(page.getByRole("listitem")).toHaveCount(2);
  });
});
