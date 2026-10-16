import { randomBytes } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";

import {
  ADRESSE,
  adresseMotDePasse,
  attendreLienReinitialisation,
  connecter,
  creerCompteVerifie,
  inscrire,
  ipAuHasard,
  liensReinitialisation,
  MOT_DE_PASSE,
  NOM_COOKIE,
  sujetsPour,
} from "./compte-verifie";
import { MOT_DE_PASSE_COMPROMIS_E2E } from "./hibp-simule.mjs";
import { observerViolations, violations } from "./outils";

// Mot de passe oublié sur le site construit, aux deux largeurs (UC-03, T-07,
// T-04, S-17). Comptes créés par le parcours de la 1.1 ; lien lu dans le
// dossier du transport fichier ; Have I Been Pwned simulé. Chaque page pose
// son propre X-Forwarded-For. Fiche : docs/features/mot-de-passe.md,
// « Tests de bout en bout ».

const OUBLI = TEXTES_COMPTE.motDePasseOublie;
const REINIT = TEXTES_COMPTE.reinitialisation;
const NOUVEAU = "Nouvelle phrase de passe 2026";

async function adresseIpPropre(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
}

async function demander(page: Page, email: string) {
  await page.goto("/mot-de-passe-oublie");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(OUBLI.titre);
  await page.getByLabel(OUBLI.email).fill(email);
  const [reponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/request-password-reset" &&
        r.request().method() === "POST",
    ),
    page.getByRole("button", { name: OUBLI.envoyer }).click(),
  ]);
  await expect(page.getByText(OUBLI.confirmation)).toBeVisible();
  return { statut: reponse.status(), corps: await reponse.text() };
}

async function enregistrer(page: Page, motDePasse: string) {
  await page.getByLabel(REINIT.motDePasse).fill(motDePasse);
  const [reponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/reset-password" && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: REINIT.enregistrer }).click(),
  ]);
  return reponse;
}

test.describe("mot de passe oublié, parcours UC-03", () => {
  test("depuis la connexion : demande, lien en fragment, mot de passe compromis refusé, nouveau enregistré, sessions fermées, notification", async ({
    page,
    browser,
  }, info) => {
    const email = adresseMotDePasse(info, "parcours");
    const cookieAvant = await creerCompteVerifie(email);
    await adresseIpPropre(page);
    await observerViolations(page);

    // Une session ouverte ailleurs avant la réinitialisation.
    const ailleurs = await browser.newContext();
    try {
      await ailleurs.addCookies([{ name: NOM_COOKIE, value: cookieAvant, url: ADRESSE }]);
      const pageAilleurs = await ailleurs.newPage();
      await pageAilleurs.goto(`${ADRESSE}/compte`);
      await expect(pageAilleurs.getByRole("heading", { level: 1 })).toHaveText(
        TEXTES_COMPTE.compte.titre,
      );

      await page.goto("/connexion");
      await page.getByRole("link", { name: TEXTES_COMPTE.connexion.motDePasseOublie }).click();
      await expect(page).toHaveURL(`${ADRESSE}/mot-de-passe-oublie`);
      const demande = await demander(page, email);
      expect(demande).toEqual({ statut: 200, corps: JSON.stringify({ ok: true }) });

      const lien = await attendreLienReinitialisation(email);
      const jeton = lien.split("#")[1] ?? "";
      expect(jeton).toMatch(/^[A-Za-z0-9]{24}$/u);

      const adresses: string[] = [];
      page.on("request", (requete) => adresses.push(requete.url()));
      await page.goto(lien);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(REINIT.titre);
      // Fragment effacé de la barre d'adresse.
      await expect(page).toHaveURL(`${ADRESSE}/lien/reinitialisation`);

      const refus = await enregistrer(page, MOT_DE_PASSE_COMPROMIS_E2E);
      expect(await refus.json()).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
      await expect(page.locator("form").getByRole("alert")).toHaveText(
        TEXTES_COMPTE.erreurs.motDePasseCompromis,
      );

      const reponse = await enregistrer(page, NOUVEAU);
      expect(reponse.status()).toBe(200);
      expect((await reponse.request().allHeaders()).origin).toBe(ADRESSE);
      expect(new URL(reponse.url()).search).toBe("");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(REINIT.modifie);
      await expect(page.getByText(REINIT.confirmation)).toBeVisible();

      // Aucune requête du navigateur ne porte le jeton dans son adresse.
      expect(adresses.filter((adresse) => adresse.includes(jeton))).toEqual([]);

      // La session ouverte ailleurs est fermée.
      await pageAilleurs.goto(`${ADRESSE}/compte`);
      await expect(pageAilleurs.getByRole("heading", { level: 1 })).not.toHaveText(
        TEXTES_COMPTE.compte.titre,
      );
    } finally {
      await ailleurs.close();
    }

    await expect
      .poll(async () => sujetsPour(email), { timeout: 15_000 })
      .toContain("Votre mot de passe a été modifié");

    await page.getByRole("link", { name: REINIT.seConnecter }).click();
    await expect(page).toHaveURL(`${ADRESSE}/connexion`);
    expect((await connecter(email, MOT_DE_PASSE)).status).toBe(401);
    expect((await connecter(email, NOUVEAU)).status).toBe(200);
    expect(await violations(page)).toEqual([]);
  });

  test("sans JavaScript : message fixe, aucun champ, sur les deux pages", async ({ browser }) => {
    const contexte = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await contexte.newPage();
      await page.goto(`${ADRESSE}/mot-de-passe-oublie`);
      expect(await page.locator("noscript").first().textContent()).toContain(OUBLI.sansJavaScript);
      await expect(page.getByLabel(OUBLI.email)).toHaveCount(0);
      await page.goto(`${ADRESSE}/lien/reinitialisation#aB3dE5fG7hJ9kL1mN2pQ4rS6`);
      expect(await page.locator("noscript").first().textContent()).toContain(REINIT.sansJavaScript);
      await expect(page.getByLabel(REINIT.motDePasse)).toHaveCount(0);
    } finally {
      await contexte.close();
    }
  });
});

test.describe("T-07 : compte vérifié, compte non vérifié, adresse inconnue", () => {
  test("même écran, même corps de réponse ; un lien pour les deux comptes seulement", async ({
    page,
  }, info) => {
    const verifie = adresseMotDePasse(info, "verifieT07");
    const nonVerifie = adresseMotDePasse(info, "nonVerifieT07");
    await creerCompteVerifie(verifie);
    await inscrire(nonVerifie);
    const inconnue = `e2e-inconnue-${randomBytes(6).toString("hex")}@exemple.invalid`;

    const vus = [];
    for (const email of [inconnue, verifie, nonVerifie]) {
      await adresseIpPropre(page);
      vus.push(await demander(page, email));
    }
    expect(vus[0]).toEqual({ statut: 200, corps: JSON.stringify({ ok: true }) });
    expect(vus[1]).toEqual(vus[0]);
    expect(vus[2]).toEqual(vus[0]);

    await attendreLienReinitialisation(verifie);
    await attendreLienReinitialisation(nonVerifie);
    expect(await liensReinitialisation(inconnue)).toEqual([]);
  });
});

test.describe("lien réutilisé, modifié ou mal formé (UC-03, 3a ; T-04)", () => {
  test("réutilisé ou modifié : « Ce lien n'est plus valable » et une nouvelle demande", async ({
    page,
  }, info) => {
    const email = adresseMotDePasse(info, "reutilise");
    await creerCompteVerifie(email);
    await adresseIpPropre(page);
    await demander(page, email);
    const lien = await attendreLienReinitialisation(email);

    await page.goto(lien);
    expect((await enregistrer(page, NOUVEAU)).status()).toBe(200);

    for (const essai of [lien, `${lien.slice(0, -1)}${lien.endsWith("a") ? "b" : "a"}`]) {
      await page.goto("/");
      await page.goto(essai);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(REINIT.titre);
      const reponse = await enregistrer(page, "Encore une autre phrase 2026");
      expect(await reponse.json()).toEqual({ ok: false, raison: "lien_invalide" });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(REINIT.lienInvalide);
      await expect(page.getByRole("link", { name: REINIT.nouveauLien })).toHaveAttribute(
        "href",
        "/mot-de-passe-oublie",
      );
    }
  });

  for (const [nom, adresse] of [
    ["sans fragment", "/lien/reinitialisation"],
    ["fragment trop court", "/lien/reinitialisation#abc"],
    ["fragment d'un jeton de vérification", "/lien/reinitialisation#a.b.c"],
  ] as const) {
    test(`${nom} : « Ce lien n'est plus valable » d'emblée, rien n'est envoyé`, async ({
      page,
    }) => {
      const envois: string[] = [];
      page.on("request", (requete) => {
        if (requete.url().includes("/api/auth/")) envois.push(requete.url());
      });
      await page.goto(adresse);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(REINIT.lienInvalide);
      await expect(page.getByLabel(REINIT.motDePasse)).toHaveCount(0);
      await expect(page.getByRole("link", { name: REINIT.nouveauLien })).toHaveAttribute(
        "href",
        "/mot-de-passe-oublie",
      );
      expect(envois).toEqual([]);
    });
  }
});

test.describe("utilisateur connecté", () => {
  test("/mot-de-passe-oublie mène à /compte", async ({ page, context }, info) => {
    const valeur = await creerCompteVerifie(adresseMotDePasse(info, "redirection"));
    await context.addCookies([{ name: NOM_COOKIE, value: valeur, url: ADRESSE }]);
    await page.goto("/mot-de-passe-oublie");
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
  });
});
