import { randomBytes } from "node:crypto";

import { type Page, type Response, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_ERREURS } from "../src/textes/erreurs";

import {
  ADRESSE,
  adresseConnexion,
  creerCompteVerifie,
  inscrire,
  ipAuHasard,
  MOT_DE_PASSE,
  NOM_COOKIE,
} from "./compte-verifie";
import { observerViolations, violations } from "./outils";

// Connexion et déconnexion sur le site construit, aux deux largeurs (UC-02,
// T-07, T-03, S-82). Comptes créés par le parcours de la 1.1
// (e2e/compte-verifie.ts) ; chaque page pose son propre X-Forwarded-For.
// Fiche : docs/features/connexion.md, tests 19 à 21.

const SEPT_JOURS = 7 * 24 * 60 * 60;
const TEXTES = TEXTES_COMPTE.connexion;

async function adresseIpPropre(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
}

type Envoi = { reponse: Response; corps: string };

async function seConnecter(page: Page, email: string, motDePasse = MOT_DE_PASSE): Promise<Envoi> {
  await page.goto("/connexion");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES.titre);
  await page.getByLabel(TEXTES.email).fill(email);
  await page.getByLabel(TEXTES.motDePasse).fill(motDePasse);
  const [reponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/sign-in/email" && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: TEXTES.envoyer }).click(),
  ]);
  return { reponse, corps: await reponse.text() };
}

async function seDeconnecter(page: Page) {
  const [reponse] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/sign-out" && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: TEXTES_COMPTE.deconnexion.bouton }).click(),
  ]);
  expect(reponse.status()).toBe(200);
  await expect(page).toHaveURL(`${ADRESSE}/connexion`);
}

test.describe("connexion, parcours UC-02", () => {
  test("formulaire, session ouverte sur /compte, cookie HttpOnly de 7 jours, jeton jamais dans le corps", async ({
    page,
    context,
  }, info) => {
    const email = adresseConnexion(info, "parcours");
    await creerCompteVerifie(email);
    await adresseIpPropre(page);
    await observerViolations(page);

    const { reponse, corps } = await seConnecter(page, email);

    expect((await reponse.request().allHeaders()).origin).toBe(ADRESSE);
    expect(reponse.status()).toBe(200);
    expect(corps).toBe(JSON.stringify({ ok: true }));
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMPTE.compte.titre);
    await expect(page.getByText(TEXTES_COMPTE.compte.connecte)).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === NOM_COOKIE);
    if (!cookie) throw new Error("aucun cookie de session");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const restant = cookie.expires - Date.now() / 1000;
    expect(restant).toBeGreaterThan(SEPT_JOURS - 3600);
    expect(restant).toBeLessThanOrEqual(SEPT_JOURS + 60);
    // S-82 : le corps ne porte ni le jeton ni sa signature.
    for (const morceau of decodeURIComponent(cookie.value).split(".")) {
      expect(corps).not.toContain(morceau);
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain(NOM_COOKIE);

    await seDeconnecter(page);
    expect((await context.cookies()).find((c) => c.name === NOM_COOKIE)).toBeUndefined();
    expect(await violations(page)).toEqual([]);
  });

  test("lien vers l'inscription et vers le renvoi du lien de confirmation", async ({ page }) => {
    await page.goto("/connexion");
    await expect(page.getByRole("link", { name: TEXTES.creerCompte })).toHaveAttribute(
      "href",
      "/inscription",
    );
    await page.getByRole("link", { name: TEXTES.nouveauLien }).click();
    await expect(page.getByRole("textbox", { name: TEXTES_COMPTE.renvoi.email })).toBeVisible();
  });

  test("sans JavaScript : message fixe, aucun champ", async ({ browser }) => {
    const contexte = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await contexte.newPage();
      await page.goto(`${ADRESSE}/connexion`);
      expect(await page.locator("noscript").first().textContent()).toContain(TEXTES.sansJavaScript);
      await expect(page.getByLabel(TEXTES.motDePasse)).toHaveCount(0);
    } finally {
      await contexte.close();
    }
  });
});

test.describe("T-07 : adresse inconnue, mauvais mot de passe, compte non vérifié", () => {
  test("même écran, même message, même corps de réponse", async ({ page }, info) => {
    const verifie = adresseConnexion(info, "verifieT07");
    const nonVerifie = adresseConnexion(info, "nonVerifieT07");
    await creerCompteVerifie(verifie);
    await inscrire(nonVerifie);
    const inconnue = `e2e-inconnue-${randomBytes(6).toString("hex")}@exemple.invalid`;

    const vus: { statut: number; corps: string; texte: string }[] = [];
    for (const [email, motDePasse] of [
      [inconnue, MOT_DE_PASSE],
      [verifie, "Un mauvais mot de passe 2026"],
      [nonVerifie, MOT_DE_PASSE],
    ] as const) {
      await adresseIpPropre(page);
      const { reponse, corps } = await seConnecter(page, email, motDePasse);
      // Modifié : l'annonceur de route de Next.js porte aussi role="alert".
      const alerte = page.locator("form").getByRole("alert");
      await expect(alerte).toHaveText(TEXTES.identifiantsIncorrects);
      await expect(page).toHaveURL(`${ADRESSE}/connexion`);
      await expect(page.getByRole("link", { name: TEXTES.nouveauLien })).toBeVisible();
      vus.push({ statut: reponse.status(), corps, texte: (await alerte.textContent()) ?? "" });
    }

    expect(vus[0]).toEqual({
      statut: 401,
      corps: JSON.stringify({ ok: false, raison: "identifiants_incorrects" }),
      texte: TEXTES.identifiantsIncorrects,
    });
    expect(vus[1]).toEqual(vus[0]);
    expect(vus[2]).toEqual(vus[0]);
  });
});

test.describe("T-03 : session fermée côté serveur", () => {
  test("cookie copié avant la déconnexion, rejoué ailleurs : /compte et /tableau-de-bord introuvables", async ({
    page,
    context,
    browser,
  }, info) => {
    const email = adresseConnexion(info, "rejeu");
    await creerCompteVerifie(email);
    await adresseIpPropre(page);
    await seConnecter(page, email);
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    const copie = (await context.cookies()).find((c) => c.name === NOM_COOKIE);
    if (!copie) throw new Error("aucun cookie de session");

    // Témoin : avant la déconnexion, le cookie copié ouvre /compte.
    const temoin = await browser.newContext();
    try {
      await temoin.addCookies([copie]);
      const p = await temoin.newPage();
      await p.goto(`${ADRESSE}/compte`);
      await expect(p.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMPTE.compte.titre);
    } finally {
      await temoin.close();
    }

    await seDeconnecter(page);

    const rejeu = await browser.newContext();
    try {
      await rejeu.addCookies([copie]);
      const p = await rejeu.newPage();
      for (const chemin of ["/compte", "/tableau-de-bord"]) {
        await p.goto(`${ADRESSE}${chemin}`);
        await expect(p.getByRole("heading", { level: 1 }), chemin).toHaveText(
          TEXTES_ERREURS.introuvable,
        );
        await expect(p.getByText(TEXTES_COMPTE.compte.connecte)).toHaveCount(0);
      }
    } finally {
      await rejeu.close();
    }
  });

  test("retour arrière après la déconnexion : aucune donnée du compte affichée", async ({
    page,
  }, info) => {
    const email = adresseConnexion(info, "deconnexion");
    await creerCompteVerifie(email);
    await adresseIpPropre(page);
    await seConnecter(page, email);
    await expect(page).toHaveURL(`${ADRESSE}/compte`);

    await seDeconnecter(page);
    await page.goBack();

    await expect(page.getByText(TEXTES_COMPTE.compte.connecte)).toHaveCount(0);
  });
});
