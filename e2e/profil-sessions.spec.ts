import { readFile } from "node:fs/promises";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";

import {
  ADRESSE,
  adresseProfil,
  connecter,
  creerCompteVerifie,
  ipAuHasard,
  MOT_DE_PASSE,
  NOM_COOKIE,
  sujetsPour,
  valeurCookieSession,
} from "./compte-verifie";
import { observerViolations, violations } from "./outils";
import { capturer, defilementHorizontal } from "./pages-livrees";

// Profil et sessions sur le site construit, aux deux largeurs (1.5) : deux
// navigateurs connectés au même compte ; la liste des sessions, la fermeture
// de l'autre session, la correction du nom, le changement du mot de passe
// (autres sessions fermées, email), puis la reconnexion avec le nouveau mot
// de passe. Aucun jeton dans un corps ni dans le HTML de la page ; le
// journal du serveur sans mot de passe, jeton, adresse ni nom. Fiche :
// docs/features/profil-sessions.md, tests 15 et 16.

const PROFIL = TEXTES_COMPTE.profil;
const SESSIONS = TEXTES_COMPTE.sessions;
const NOUVEAU = "Nouvelle phrase de passe 2026";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

async function connecterContexte(context: BrowserContext, page: Page, valeur: string) {
  await context.addCookies([
    { name: NOM_COOKIE, value: valeur, url: ADRESSE, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
}

// Une seconde session du même compte, ouverte « depuis un téléphone » : le
// cookie de la connexion par le point d'entrée.
async function secondeSession(email: string, motDePasse = MOT_DE_PASSE): Promise<string> {
  const reponse = await connecter(email, motDePasse, { "user-agent": ANDROID });
  expect(reponse.status).toBe(200);
  const valeur = valeurCookieSession(reponse);
  if (!valeur) throw new Error("aucun cookie de session à la connexion");
  return valeur;
}

function surveiller(page: Page) {
  const corps: string[] = [];
  page.on("response", async (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith("/api/auth/")) {
      corps.push(await reponse.text().catch(() => ""));
    }
  });
  return corps;
}

function jeton(valeur: string): string {
  return decodeURIComponent(valeur).split(".")[0] ?? valeur;
}

test.describe("UC-05, changement du mot de passe et du nom", () => {
  test("sessions listées, l'autre fermée ; nom corrigé ; mot de passe changé, autres sessions fermées, email", async ({
    page,
    context,
    browser,
  }, info) => {
    const email = adresseProfil(info, "parcours");
    const premiere = await creerCompteVerifie(email);
    const seconde = await secondeSession(email);
    await connecterContexte(context, page, premiere);
    await observerViolations(page);
    const corps = surveiller(page);

    const telephone = await browser.newContext();
    const pageTelephone = await telephone.newPage();
    await connecterContexte(telephone, pageTelephone, seconde);
    expect((await pageTelephone.goto("/compte"))?.status()).toBe(200);

    // UC-05, étape 1 : deux sessions, la courante marquée et en tête.
    await page.goto("/compte");
    await page.getByRole("link", { name: TEXTES_COMPTE.compte.voirSessions }).click();
    await expect(page).toHaveURL(`${ADRESSE}/compte/sessions`);
    const lignes = page.getByTestId("session");
    await expect(lignes).toHaveCount(2);
    await expect(lignes.first()).toContainText(SESSIONS.courante);
    await expect(lignes.nth(1)).toContainText("Chrome sur Android");
    await expect(lignes.nth(1)).toContainText(SESSIONS.ouverteLe);
    const html = await page.content();
    for (const valeur of [premiere, seconde]) expect(html).not.toContain(jeton(valeur));
    expect(html).not.toContain("Mobile Safari/537.36");

    // UC-05, étapes 2 et 3 : l'autre session fermée, refusée aussitôt.
    await lignes.nth(1).getByRole("button", { name: SESSIONS.fermer }).click();
    await expect(lignes).toHaveCount(1);
    expect((await pageTelephone.goto("/compte"))?.status()).toBe(404);

    // Correction du nom.
    await page.goto("/compte/profil");
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel(PROFIL.nom).fill("Awa Konaté");
    await page.getByRole("button", { name: PROFIL.enregistrerNom }).click();
    await expect(page.getByText(PROFIL.nomEnregistre)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(PROFIL.nom)).toHaveValue("Awa Konaté");

    // Changement du mot de passe : une nouvelle seconde session, fermée par
    // le changement ; le navigateur reste connecté sous une session neuve.
    const troisieme = await secondeSession(email);
    await connecterContexte(telephone, pageTelephone, troisieme);
    expect((await pageTelephone.goto("/compte"))?.status()).toBe(200);
    await page.getByLabel(PROFIL.motDePasseActuel).fill(MOT_DE_PASSE);
    await page.getByLabel(PROFIL.nouveauMotDePasse).fill(NOUVEAU);
    const [reponse] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/change-password"),
      page.getByRole("button", { name: PROFIL.changer }).click(),
    ]);
    expect(reponse.status()).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    await expect(page.getByText(PROFIL.motDePasseChange)).toBeVisible();
    const neuve = (await context.cookies()).find((c) => c.name === NOM_COOKIE)?.value ?? "";
    expect(jeton(neuve)).not.toBe(jeton(premiere));
    expect((await page.goto("/compte"))?.status()).toBe(200);
    expect((await pageTelephone.goto("/compte"))?.status()).toBe(404);
    await expect.poll(() => sujetsPour(email)).toContain("Votre mot de passe a été modifié");

    // Reconnexion : l'ancien mot de passe refusé, le nouveau accepté.
    expect((await connecter(email)).status).toBe(401);
    expect((await connecter(email, NOUVEAU)).status).toBe(200);

    for (const texte of corps) expect(texte).not.toMatch(/token|jeton/iu);
    expect(await violations(page)).toEqual([]);
    await telephone.close();
  });
});

// T-39 sur le site construit : la sortie du serveur, après le passage
// complet, ne contient aucune valeur de la requête. Fiche :
// docs/features/profil-sessions.md, section 10, test 16.
test.describe("T-39 : journal du site construit, profil et sessions", () => {
  test("fermetures, nom, mot de passe : rien dans la sortie du serveur", async ({
    page,
    context,
  }, info) => {
    const chemin = process.env.JOURNAL_SITE_E2E;
    if (!chemin) throw new Error("JOURNAL_SITE_E2E absent : playwright.config.ts doit le poser.");
    const email = adresseProfil(info, "journal");
    const premiere = await creerCompteVerifie(email);
    const seconde = await secondeSession(email);
    const troisieme = await secondeSession(email);
    await connecterContexte(context, page, premiere);

    await page.goto("/compte/sessions");
    await expect(page.getByTestId("session")).toHaveCount(3);
    await page.getByTestId("session").nth(1).getByRole("button", { name: SESSIONS.fermer }).click();
    await expect(page.getByTestId("session")).toHaveCount(2);
    await page.getByRole("button", { name: SESSIONS.fermerAutres }).click();
    await expect(page.getByTestId("session")).toHaveCount(1);

    await page.goto("/compte/profil");
    await page.getByLabel(PROFIL.nom).fill("Nom Témoin Journal");
    await page.getByRole("button", { name: PROFIL.enregistrerNom }).click();
    await expect(page.getByText(PROFIL.nomEnregistre)).toBeVisible();
    await page.getByLabel(PROFIL.motDePasseActuel).fill("mauvais mot de passe actuel");
    await page.getByLabel(PROFIL.nouveauMotDePasse).fill(NOUVEAU);
    await page.getByRole("button", { name: PROFIL.changer }).click();
    await expect(page.getByText(PROFIL.motDePasseIncorrect)).toBeVisible();
    await page.getByLabel(PROFIL.motDePasseActuel).fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: PROFIL.changer }).click();
    await expect(page.getByText(PROFIL.motDePasseChange)).toBeVisible();
    const neuve = (await context.cookies()).find((c) => c.name === NOM_COOKIE)?.value ?? "";

    const sortie = await readFile(chemin, "utf8");
    expect(sortie.length).toBeGreaterThan(0);
    const interdits = [
      MOT_DE_PASSE,
      NOUVEAU,
      "mauvais mot de passe actuel",
      "Nom Témoin Journal",
      email,
      ...[premiere, seconde, troisieme, neuve].flatMap((v) => [v, jeton(v)]),
    ].filter((valeur) => valeur.length >= 6);
    for (const interdit of interdits) {
      expect(sortie.includes(interdit), "valeur de la requête dans le journal").toBe(false);
    }
    for (const ligne of sortie.split("\n").filter((l) => l.startsWith("[auth] "))) {
      expect(ligne).toMatch(/^\[auth\] \{"niveau":"(warn|error)","incident":"[0-9a-f-]{36}"\}$/);
    }
  });
});

// Les deux pages à 390 et 1280 px : aucun défilement horizontal, cibles de
// 44 px, captures, sans violation. Fiche : docs/features/profil-sessions.md,
// section 9, test 16.
test.describe("profil et sessions, affichage", () => {
  test("aucun défilement horizontal, cibles de 44 px, captures, sans violation", async ({
    page,
    context,
  }, info) => {
    const email = adresseProfil(info, "affichage");
    const premiere = await creerCompteVerifie(email);
    await secondeSession(email);
    await connecterContexte(context, page, premiere);
    await observerViolations(page);
    const sansDefilement = async () => {
      const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
      expect(largeurContenu).toBeLessThanOrEqual(largeurFenetre);
    };

    await page.goto("/compte/sessions");
    await expect(page.getByTestId("session")).toHaveCount(2);
    await sansDefilement();
    for (const cible of [
      page.getByRole("button", { name: SESSIONS.fermer }),
      page.getByRole("button", { name: SESSIONS.fermerAutres }),
    ]) {
      expect((await cible.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await capturer(page, "sessions");

    await page.goto("/compte/profil");
    await expect(page.getByLabel(PROFIL.nom)).toBeVisible();
    await sansDefilement();
    for (const cible of [
      page.getByLabel(PROFIL.nom),
      page.getByRole("button", { name: PROFIL.enregistrerNom }),
      page.getByLabel(PROFIL.motDePasseActuel),
      page.getByLabel(PROFIL.nouveauMotDePasse),
      page.getByRole("button", { name: PROFIL.changer }),
    ]) {
      expect((await cible.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await capturer(page, "profil");
    expect(await violations(page)).toEqual([]);
  });
});
