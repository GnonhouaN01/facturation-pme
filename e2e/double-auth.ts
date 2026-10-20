import { type BrowserContext, type Page, expect } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";

import {
  ADRESSE,
  creerCompteVerifie,
  ipAuHasard,
  MOT_DE_PASSE,
  NOM_COOKIE,
} from "./compte-verifie";
import { codeTotp } from "./totp";

// Étapes du parcours de la double authentification sur le site construit,
// partagées par e2e/double-authentification.spec.ts, e2e/zones.attaque.spec.ts
// et e2e/affichage-connecte.spec.ts (un Propriétaire n'ouvre la zone
// application qu'avec son second facteur, étape 7). Fiche :
// docs/features/double-authentification.md, section 9 et tests 26, 31, 32.

const CONNEXION = TEXTES_COMPTE.connexion;
const DOUBLE = TEXTES_COMPTE.doubleAuth;

export const NOM_ATTENTE = "better-auth.two_factor";

// Compte vérifié, connecté par son cookie de session ; adresse IP propre.
export async function preparer(page: Page, context: BrowserContext, email: string) {
  const valeur = await creerCompteVerifie(email);
  await context.addCookies([
    { name: NOM_COOKIE, value: valeur, url: ADRESSE, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
}

// Codes de secours affichés, une fois « J'ai conservé mes codes » coché et
// « Terminer » cliqué.
async function lireCodesSecours(page: Page): Promise<string[]> {
  await expect(page.getByRole("heading", { name: DOUBLE.codesTitre, exact: true })).toBeVisible();
  const codes = (await page.getByTestId("code-secours").allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/u);
  await page.getByLabel(DOUBLE.conserve).check();
  await page.getByRole("button", { name: DOUBLE.terminer }).click();
  return codes;
}

// Activation complète par l'interface : rend la clé et les dix codes.
export async function activer(page: Page): Promise<{ cle: string; codes: string[] }> {
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
  const codes = await lireCodesSecours(page);
  await expect(page.getByText(DOUBLE.activee)).toBeVisible();
  return { cle, codes };
}

// Opération de gestion de /compte/double-authentification (nouveaux codes,
// désactivation), avec le mot de passe et un code.
export async function gerer(
  page: Page,
  operation: "nouveauxCodes" | "desactiver",
  code: string,
): Promise<string[]> {
  await page.goto("/compte/double-authentification");
  const bouton = DOUBLE[operation];
  await page.getByRole("button", { name: bouton }).click();
  await page.getByLabel(DOUBLE.motDePasse).fill(MOT_DE_PASSE);
  await page.getByLabel(DOUBLE.gestionCode).fill(code);
  await page.getByRole("button", { name: bouton }).click();
  if (operation === "desactiver") {
    await expect(page.getByText(DOUBLE.desactivee)).toBeVisible();
    return [];
  }
  return lireCodesSecours(page);
}

export async function seDeconnecter(page: Page) {
  await page.goto("/compte");
  await page.getByRole("button", { name: TEXTES_COMPTE.deconnexion.bouton }).click();
  await expect(page).toHaveURL(`${ADRESSE}/connexion`);
}

// Étape du mot de passe d'un compte à second facteur : l'étape du code suit.
export async function motDePasse(page: Page, email: string) {
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

export async function envoyerCode(
  page: Page,
  code: string,
  chemin = "/api/auth/two-factor/verify-totp",
) {
  const champ = chemin.endsWith("verify-totp") ? CONNEXION.codeLibelle : CONNEXION.secoursLibelle;
  await page.getByLabel(champ).fill(code);
  const [reponse] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === chemin),
    page.getByRole("button", { name: CONNEXION.verifier }).click(),
  ]);
  return reponse;
}
