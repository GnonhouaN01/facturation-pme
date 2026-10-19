import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";

import {
  ADRESSE,
  adresseDoubleAuth,
  creerCompteVerifie,
  ipAuHasard,
  MOT_DE_PASSE,
  NOM_COOKIE,
  sujetsPour,
} from "./compte-verifie";
import { observerViolations, violations } from "./outils";
import { codeTotp } from "./totp";

// Double authentification sur le site construit, aux deux largeurs : le
// parcours du jalon 1 (PLAN.md 4.6 : s'inscrire, vérifier son email, se
// connecter avec la double authentification), le code de secours, T-06 (cinq
// essais par attente, code déjà accepté refusé), cookies et corps (S-82).
// Codes calculés par le test depuis la clé lue à l'écran (e2e/totp.ts).
// Fiche : docs/features/double-authentification.md, tests 26 et 27.

const CONNEXION = TEXTES_COMPTE.connexion;
const DOUBLE = TEXTES_COMPTE.doubleAuth;
const NOM_ATTENTE = "better-auth.two_factor";

async function preparer(page: Page, context: BrowserContext, email: string) {
  const valeur = await creerCompteVerifie(email);
  await context.addCookies([
    { name: NOM_COOKIE, value: valeur, url: ADRESSE, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
}

// Écoute de toutes les requêtes et réponses de /api/auth : aucun code ni clé
// dans une adresse, aucun jeton ni adresse otpauth dans un corps.
function surveiller(page: Page) {
  const adresses: string[] = [];
  const corps: string[] = [];
  page.on("request", (requete) => adresses.push(requete.url()));
  page.on("response", async (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith("/api/auth/")) {
      corps.push(await reponse.text().catch(() => ""));
    }
  });
  return { adresses, corps };
}

// Activation complète par l'interface : rend la clé et les dix codes.
async function activer(page: Page): Promise<{ cle: string; codes: string[] }> {
  await page.goto("/compte");
  await expect(page.getByText(TEXTES_COMPTE.compte.doubleAuthInactive)).toBeVisible();
  await page.getByRole("link", { name: TEXTES_COMPTE.compte.activer }).click();
  await expect(page).toHaveURL(`${ADRESSE}/compte/double-authentification`);
  await expect(page.getByText(DOUBLE.obligatoire)).toBeVisible();
  await page.getByLabel(DOUBLE.motDePasse).fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: DOUBLE.continuer }).click();

  await expect(page.getByRole("img", { name: DOUBLE.qr })).toBeVisible();
  const cle = (await page.getByTestId("cle-totp").textContent()) ?? "";
  expect(cle).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/u);
  // Les codes de secours ne s'affichent qu'après le code (UC-04, étape 4).
  await expect(page.getByText(DOUBLE.codesTitre)).toHaveCount(0);

  await page.getByLabel(DOUBLE.code).fill(codeTotp(cle));
  await page.getByRole("button", { name: DOUBLE.confirmer }).click();
  await expect(page.getByRole("heading", { name: DOUBLE.codesTitre })).toBeVisible();
  const codes = (await page.getByTestId("code-secours").allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/u);
  await page.getByLabel(DOUBLE.conserve).check();
  await page.getByRole("button", { name: DOUBLE.terminer }).click();
  await expect(page.getByText(DOUBLE.activee)).toBeVisible();
  return { cle, codes };
}

async function seDeconnecter(page: Page) {
  await page.goto("/compte");
  await page.getByRole("button", { name: TEXTES_COMPTE.deconnexion.bouton }).click();
  await expect(page).toHaveURL(`${ADRESSE}/connexion`);
}

async function motDePasse(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByLabel(CONNEXION.email).fill(email);
  await page.getByLabel(CONNEXION.motDePasse).fill(MOT_DE_PASSE);
  const [reponse] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/sign-in/email"),
    page.getByRole("button", { name: CONNEXION.envoyer }).click(),
  ]);
  expect(await reponse.text()).toBe(JSON.stringify({ ok: true, etape: "code" }));
  await expect(page.getByLabel(CONNEXION.codeLibelle)).toBeVisible();
}

async function envoyerCode(page: Page, code: string, chemin = "/api/auth/two-factor/verify-totp") {
  const champ = chemin.endsWith("verify-totp") ? CONNEXION.codeLibelle : CONNEXION.secoursLibelle;
  await page.getByLabel(champ).fill(code);
  const [reponse] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === chemin),
    page.getByRole("button", { name: CONNEXION.verifier }).click(),
  ]);
  return reponse;
}

test.describe("double authentification, parcours UC-04 puis UC-02", () => {
  test("activation, connexion par code, puis par code de secours ; cookies, corps et adresses propres", async ({
    page,
    context,
  }, info) => {
    const email = adresseDoubleAuth(info, "parcours");
    await preparer(page, context, email);
    await observerViolations(page);
    const vus = surveiller(page);

    const { cle, codes } = await activer(page);
    await expect.poll(() => sujetsPour(email)).toContain("Double authentification activée");

    await seDeconnecter(page);
    await motDePasse(page, email);
    // Aucune session avant le code ; l'attente : HttpOnly, SameSite=Lax, 5 minutes.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === NOM_COOKIE)).toBeUndefined();
    const attente = cookies.find((c) => c.name === NOM_ATTENTE);
    expect(attente?.httpOnly).toBe(true);
    expect(attente?.sameSite).toBe("Lax");
    const restant = (attente?.expires ?? 0) - Date.now() / 1000;
    expect(restant).toBeGreaterThan(240);
    expect(restant).toBeLessThanOrEqual(300 + 5);

    // Le code de l'activation a pris la tranche courante : le suivant sert.
    const codeConnexion = codeTotp(cle, 1);
    const reponse = await envoyerCode(page, codeConnexion);
    expect(reponse.status()).toBe(200);
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    expect((await context.cookies()).find((c) => c.name === NOM_COOKIE)).toBeDefined();
    expect((await context.cookies()).find((c) => c.name === NOM_ATTENTE)).toBeUndefined();

    // Code de secours.
    await seDeconnecter(page);
    await motDePasse(page, email);
    await page.getByRole("button", { name: CONNEXION.utiliserSecours }).click();
    expect(
      (await envoyerCode(page, codes[0] ?? "", "/api/auth/two-factor/verify-backup-code")).status(),
    ).toBe(200);
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    await expect.poll(() => sujetsPour(email)).toContain("Code de secours utilisé");

    // Le même code de secours, une seconde fois : refusé.
    await seDeconnecter(page);
    await motDePasse(page, email);
    await page.getByRole("button", { name: CONNEXION.utiliserSecours }).click();
    await envoyerCode(page, codes[0] ?? "", "/api/auth/two-factor/verify-backup-code");
    await expect(
      page.getByRole("alert").filter({ hasText: CONNEXION.codeIncorrect }),
    ).toBeVisible();

    // Aucune adresse demandée par le navigateur ne porte un code envoyé, un
    // code de secours ou la clé : on cherche ces valeurs mêmes (un motif
    // général prendrait aussi « ouble-authe » ou une empreinte de fichier).
    const secrets = [cle.replaceAll(" ", ""), codeConnexion, ...codes];
    for (const adresse of vus.adresses) {
      for (const secret of secrets) expect(adresse).not.toContain(secret);
    }
    for (const corps of vus.corps) {
      expect(corps).not.toContain("otpauth");
      expect(corps).not.toContain('"token"');
      expect(corps).not.toContain('"user"');
    }
    expect(await violations(page)).toEqual([]);
  });
});

test.describe("T-06 sur le site construit", () => {
  test("cinq codes faux puis le bon, sur une même attente : connexion expirée, retour à l'étape du mot de passe", async ({
    page,
    context,
  }, info) => {
    const email = adresseDoubleAuth(info, "essais");
    await preparer(page, context, email);
    const { cle } = await activer(page);
    await seDeconnecter(page);
    await motDePasse(page, email);
    const juste = codeTotp(cle, 1);
    const faux = juste === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await envoyerCode(page, faux)).status()).toBe(400);
      await expect(
        page.getByRole("alert").filter({ hasText: CONNEXION.codeIncorrect }),
      ).toBeVisible();
    }
    expect(await (await envoyerCode(page, juste)).json()).toEqual({
      ok: false,
      raison: "connexion_expiree",
    });
    await expect(page.getByText(CONNEXION.connexionExpiree)).toBeVisible();
    await expect(page.getByLabel(CONNEXION.motDePasse)).toBeVisible();
  });

  test("décision 4 : un code déjà accepté est refusé à la connexion suivante", async ({
    page,
    context,
  }, info) => {
    const email = adresseDoubleAuth(info, "rejeu");
    await preparer(page, context, email);
    const { cle } = await activer(page);
    const code = codeTotp(cle, 1);
    await seDeconnecter(page);
    await motDePasse(page, email);
    expect((await envoyerCode(page, code)).status()).toBe(200);
    await seDeconnecter(page);
    await motDePasse(page, email);
    expect(await (await envoyerCode(page, code)).json()).toEqual({
      ok: false,
      raison: "code_incorrect",
    });
  });
});

test.describe("page de la double authentification sans session", () => {
  test("/compte/double-authentification : page « introuvable », comme /compte", async ({
    page,
  }) => {
    const reponse = await page.goto("/compte/double-authentification");
    expect(reponse?.status()).toBe(404);
    await expect(page.getByText(DOUBLE.motDePasse)).toHaveCount(0);
  });
});
