import { readFile } from "node:fs/promises";

import { type Page, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";

import { ADRESSE, adresseDoubleAuth, NOM_COOKIE, sujetsPour } from "./compte-verifie";
import {
  activer,
  envoyerCode,
  gerer,
  motDePasse,
  NOM_ATTENTE,
  preparer,
  seDeconnecter,
} from "./double-auth";
import { observerViolations, violations } from "./outils";
import { codeTotp } from "./totp";

// Double authentification sur le site construit, aux deux largeurs : le
// parcours du jalon 1 (PLAN.md 4.6 : s'inscrire, vérifier son email, se
// connecter avec la double authentification), le code de secours, T-06 (cinq
// essais par attente, code déjà accepté refusé), cookies et corps (S-82).
// Codes calculés par le test depuis la clé lue à l'écran (e2e/totp.ts). PR 2 :
// le passage complet relu dans la sortie du serveur (T-39, report de la PR 1).
// Fiche : docs/features/double-authentification.md, tests 26, 27 et 32.

const CONNEXION = TEXTES_COMPTE.connexion;
const DOUBLE = TEXTES_COMPTE.doubleAuth;

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
    // Une assertion par liste, pas une par paire : environ 240 adresses et
    // 12 secrets donnaient près de 3 000 expect, chacun une étape de
    // Playwright, soit environ 5 s du test sous charge (fix(e2e)).
    const secrets = [cle.replaceAll(" ", ""), codeConnexion, ...codes];
    expect(
      vus.adresses.filter((adresse) => secrets.some((secret) => adresse.includes(secret))),
    ).toEqual([]);
    const interdits = ["otpauth", '"token"', '"user"'];
    expect(
      vus.corps.filter((corps) => interdits.some((interdit) => corps.includes(interdit))),
    ).toEqual([]);
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

// T-39 sur le site construit (report de la PR 1, test 17) : un passage
// complet, puis la sortie du serveur (JOURNAL_SITE_E2E, e2e/lancer-serveur.mjs)
// relue. Ni la clé, ni un code, ni un code de secours, ni l'adresse, ni une
// adresse otpauth, ni la valeur d'un cookie de session ou d'attente. Fiche :
// docs/features/double-authentification.md, section 3.5, test 32.
test.describe("T-39 : journal du site construit, passage complet", () => {
  test("activation, code, code de secours, nouveaux codes, désactivation : rien dans la sortie du serveur", async ({
    page,
    context,
  }, info) => {
    const chemin = process.env.JOURNAL_SITE_E2E;
    if (!chemin) throw new Error("JOURNAL_SITE_E2E absent : playwright.config.ts doit le poser.");
    const email = adresseDoubleAuth(info, "journal");
    const cookies = new Set<string>();
    const relever = async () => {
      for (const cookie of await context.cookies()) {
        if (cookie.name === NOM_COOKIE || cookie.name === NOM_ATTENTE) cookies.add(cookie.value);
      }
    };

    await preparer(page, context, email);
    await relever();
    const { cle, codes } = await activer(page);
    await relever();

    await seDeconnecter(page);
    await motDePasse(page, email);
    await relever();
    const codeConnexion = codeTotp(cle, 1);
    expect((await envoyerCode(page, codeConnexion)).status()).toBe(200);
    await relever();

    await seDeconnecter(page);
    await motDePasse(page, email);
    await relever();
    await page.getByRole("button", { name: CONNEXION.utiliserSecours }).click();
    const secours = codes[0] ?? "";
    expect(
      (await envoyerCode(page, secours, "/api/auth/two-factor/verify-backup-code")).status(),
    ).toBe(200);
    await relever();

    const nouveaux = await gerer(page, "nouveauxCodes", codes[1] ?? "");
    await expect(page.getByText(DOUBLE.activee)).toBeVisible();
    await gerer(page, "desactiver", nouveaux[0] ?? "");
    await relever();
    await expect.poll(() => sujetsPour(email)).toContain("Double authentification désactivée");

    const sortie = await readFile(chemin, "utf8");
    // Témoin : la sortie du serveur est bien lue.
    expect(sortie.length).toBeGreaterThan(0);
    const interdits = [
      cle,
      cle.replaceAll(" ", ""),
      codeConnexion,
      ...codes,
      ...codes.map((code) => code.replace("-", "")),
      ...nouveaux,
      email,
      ...cookies,
      ...[...cookies].map((valeur) => decodeURIComponent(valeur).split(".")[0] ?? valeur),
    ].filter((valeur) => valeur.length >= 6);
    for (const interdit of interdits) {
      expect(sortie.includes(interdit), "valeur de la requête dans le journal").toBe(false);
    }
    expect(sortie).not.toMatch(/otpauth/i);
    for (const ligne of sortie.split("\n").filter((l) => l.startsWith("[auth] "))) {
      expect(ligne).toMatch(/^\[auth\] \{"niveau":"(warn|error)","incident":"[0-9a-f-]{36}"\}$/);
    }
  });
});
