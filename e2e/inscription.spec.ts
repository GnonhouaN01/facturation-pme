import { randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Page, type Response, expect, test } from "@playwright/test";

import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_EMAILS } from "../src/textes/emails";

import { adresseE2E } from "./comptes-e2e";
import { MOT_DE_PASSE_COMPROMIS_E2E } from "./hibp-simule.mjs";
import { observerViolations, violations } from "./outils";

// Inscription et vérification de l'adresse sur le site construit, aux deux
// largeurs (UC-01, T-07, S-10, S-54, S-82). Emails lus dans le dossier du
// transport fichier ; Have I Been Pwned simulé (e2e/simuler-hibp.mjs).
// Chaque test pose son propre X-Forwarded-For (accepté en local) pour ne pas
// épuiser la limite auth.inscription d'une autre. Adresses tirées pour
// l'exécution (e2e/comptes-e2e.ts), comptes supprimés à la fin. Fiche :
// docs/features/inscription.md, tests 12 et 13, sections 4.3, 5 et 6.

const ADRESSE = "http://localhost:3000";
// Même dossier que playwright.config.ts (EMAILS_E2E).
const DOSSIER_EMAILS = join(tmpdir(), "facturation-pme-e2e-emails");
const MOT_DE_PASSE = "Phrase de passe solide 2026";
const DUREE_PLANCHER_MS = 800;
const JETON = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type Message = { a: string; sujet: string; corps: string };

async function messagesPour(adresse: string): Promise<Message[]> {
  let noms: string[];
  try {
    noms = (await readdir(DOSSIER_EMAILS)).filter((nom) => nom.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const messages = await Promise.all(
    noms.map(
      async (nom) => JSON.parse(await readFile(join(DOSSIER_EMAILS, nom), "utf8")) as Message,
    ),
  );
  return messages.filter((message) => message.a === adresse);
}

// Attend le n-ième email (à partir de 1) reçu par l'adresse.
async function attendreEmail(adresse: string, rang: number): Promise<Message> {
  await expect
    .poll(async () => (await messagesPour(adresse)).length, { timeout: 15_000 })
    .toBe(rang);
  const message = (await messagesPour(adresse))[rang - 1];
  if (!message) throw new Error("email introuvable");
  return message;
}

function lienDe(message: Message): string {
  const trouve = /^http:\/\/localhost:3000\/lien\/verification#\S+$/m.exec(message.corps);
  if (!trouve) throw new Error("lien de vérification introuvable dans l'email");
  return trouve[0];
}

// Adresse IP propre au test (10.0.0.0/8, jamais une vraie adresse publique).
async function adresseIpPropre(page: Page) {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

async function remplirInscription(page: Page, nom: string, email: string, motDePasse: string) {
  await page.getByLabel(TEXTES_COMPTE.inscription.nom).fill(nom);
  await page.getByLabel(TEXTES_COMPTE.inscription.email).fill(email);
  await page.getByLabel(TEXTES_COMPTE.inscription.motDePasse).fill(motDePasse);
}

type Envoi = { reponse: Response; duree: number; corps: string };

// Soumet le formulaire et attend la réponse de /api/auth/sign-up/email.
async function soumettreInscription(page: Page): Promise<Envoi> {
  const debut = Date.now();
  const [reponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/auth/sign-up/email" && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: TEXTES_COMPTE.inscription.envoyer }).click(),
  ]);
  const duree = Date.now() - debut;
  return { reponse, duree, corps: await reponse.text() };
}

async function inscrire(page: Page, email: string, motDePasse = MOT_DE_PASSE): Promise<Envoi> {
  await page.goto("/inscription");
  await remplirInscription(page, "Awa Koné", email, motDePasse);
  return soumettreInscription(page);
}

test.describe("inscription, parcours UC-01", () => {
  test("formulaire, email, lien, confirmation : session ouverte, jeton jamais dans une adresse", async ({
    page,
    context,
  }, info) => {
    const email = adresseE2E(info.project.name, 0);
    await adresseIpPropre(page);
    await observerViolations(page);
    const requetes: { url: string; referer: string | undefined }[] = [];
    context.on("request", (requete) =>
      requetes.push({ url: requete.url(), referer: requete.headers().referer }),
    );

    // Étapes 1 à 3 : le formulaire, la requête avec Origin (section 5.3).
    const { reponse, corps } = await inscrire(page, email);
    expect(reponse.request().headers().origin).toBe(ADRESSE);
    expect(reponse.status()).toBe(200);
    expect(JSON.parse(corps)).toEqual({ ok: true });
    await expect(page).toHaveURL(`${ADRESSE}/inscription/envoyee`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMPTE.envoyee.titre);

    // L'email : sujet du modèle, lien <origine>/lien/verification#<jeton>.
    const message = await attendreEmail(email, 1);
    expect(message.sujet).toBe(TEXTES_EMAILS.modeles["compte.verification"].sujet);
    const lien = lienDe(message);
    const jeton = lien.split("#")[1] ?? "";
    expect(jeton).toMatch(JETON);

    // Étape 4 : le lien ; le fragment est effacé de la barre d'adresse.
    await page.goto(lien);
    const confirmer = page.getByRole("button", { name: TEXTES_COMPTE.verification.confirmer });
    await expect(confirmer).toBeVisible();
    await expect(page).toHaveURL(`${ADRESSE}/lien/verification`);
    expect(await page.evaluate(() => window.location.hash)).toBe("");

    // Étape 5 : le bouton envoie le jeton dans le corps d'un POST.
    const [verification] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify-email"),
      confirmer.click(),
    ]);
    expect(verification.request().method()).toBe("POST");
    expect(verification.request().headers().origin).toBe(ADRESSE);
    expect(JSON.parse(verification.request().postData() ?? "{}")).toEqual({ jeton });
    expect(await verification.json()).toEqual({ ok: true });
    await expect(page).toHaveURL(`${ADRESSE}/inscription/verifiee`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TEXTES_COMPTE.verifiee.titre);

    // Cookie de session : HttpOnly, SameSite=Lax (S-82).
    const session = (await context.cookies()).find(
      (cookie) => cookie.name === "better-auth.session_token",
    );
    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");

    // Le jeton n'est jamais dans une adresse reçue par le serveur : ni chemin,
    // ni requête, ni Referer (S-54, décision 3).
    expect(requetes.length).toBeGreaterThan(0);
    for (const { url, referer } of requetes) {
      const recue = new URL(url);
      expect(`${recue.pathname}${recue.search}`, url).not.toContain(jeton);
      expect(referer ?? "", url).not.toContain(jeton);
    }
    expect(await violations(page)).toEqual([]);
  });

  test("T-07 : adresse nouvelle puis déjà prise, même écran, même réponse, 800 ms au moins", async ({
    page,
  }, info) => {
    const email = adresseE2E(info.project.name, 1);
    await adresseIpPropre(page);

    const nouvelle = await inscrire(page, email);
    await expect(page).toHaveURL(`${ADRESSE}/inscription/envoyee`);
    const ecranNouvelle = await page.getByRole("main").innerText();

    const prise = await inscrire(page, email);
    await expect(page).toHaveURL(`${ADRESSE}/inscription/envoyee`);
    const ecranPrise = await page.getByRole("main").innerText();

    expect(prise.reponse.status()).toBe(nouvelle.reponse.status());
    expect(prise.corps).toBe(nouvelle.corps);
    expect(JSON.parse(prise.corps)).toEqual({ ok: true });
    expect(ecranPrise).toBe(ecranNouvelle);
    expect(nouvelle.duree).toBeGreaterThanOrEqual(DUREE_PLANCHER_MS);
    expect(prise.duree).toBeGreaterThanOrEqual(DUREE_PLANCHER_MS);

    // UC-01, 3a : le premier email est la vérification, le second dit que le
    // compte existe.
    expect((await attendreEmail(email, 1)).sujet).toBe(
      TEXTES_EMAILS.modeles["compte.verification"].sujet,
    );
    const existant = await attendreEmail(email, 2);
    expect(existant.sujet).toBe(TEXTES_EMAILS.modeles["compte.existant"].sujet);
    expect(existant.corps).not.toContain("/lien/");
  });

  test("UC-01 2a : mot de passe de 11 caractères, refusé avec la raison, aucun compte", async ({
    page,
  }, info) => {
    const email = adresseE2E(info.project.name, 2);
    await adresseIpPropre(page);
    await page.goto("/inscription");
    await remplirInscription(page, "Awa Koné", email, "a".repeat(11));

    await page.getByRole("button", { name: TEXTES_COMPTE.inscription.envoyer }).click();

    const champ = page.getByLabel(TEXTES_COMPTE.inscription.motDePasse);
    await expect(page.getByText(TEXTES_COMPTE.erreurs.motDePasseTropCourt)).toBeVisible();
    await expect(champ).toHaveAttribute("aria-invalid", "true");
    await expect(champ).toHaveAccessibleDescription(
      new RegExp(TEXTES_COMPTE.erreurs.motDePasseTropCourt),
    );
    await expect(page).toHaveURL(`${ADRESSE}/inscription`);
    expect(await messagesPour(email)).toEqual([]);
  });

  test("S-10 : mot de passe compromis (service simulé), refusé avec la raison, aucun email", async ({
    page,
  }, info) => {
    const email = adresseE2E(info.project.name, 3);
    await adresseIpPropre(page);

    const { reponse, corps } = await inscrire(page, email, MOT_DE_PASSE_COMPROMIS_E2E);

    // Le vrai service ne connaît pas ce mot de passe : le refus prouve que la
    // réponse vient de la simulation.
    expect(reponse.status()).toBe(400);
    expect(JSON.parse(corps)).toEqual({ ok: false, raison: "mot_de_passe_compromis" });
    await expect(page.getByText(TEXTES_COMPTE.erreurs.motDePasseCompromis)).toBeVisible();
    await expect(page.getByLabel(TEXTES_COMPTE.inscription.motDePasse)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(`${ADRESSE}/inscription`);
    await page.waitForTimeout(1_000);
    expect(await messagesPour(email)).toEqual([]);
  });

  test("UC-01 4a : lien altéré, « Ce lien n'est plus valable », puis renvoi d'un nouveau lien", async ({
    page,
  }, info) => {
    const email = adresseE2E(info.project.name, 4);
    await adresseIpPropre(page);
    await inscrire(page, email);
    const premier = lienDe(await attendreEmail(email, 1));
    // Signature altérée : le jeton garde sa forme, Better Auth le refuse.
    const [entete, charge] = (premier.split("#")[1] ?? "").split(".");
    await page.goto(`${ADRESSE}/lien/verification#${entete}.${charge}.c2lnbmF0dXJlLWFsdGVyZWU`);

    const [verification] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify-email"),
      page.getByRole("button", { name: TEXTES_COMPTE.verification.confirmer }).click(),
    ]);

    expect(await verification.json()).toEqual({ ok: false, raison: "lien_invalide" });
    await expect(page.getByText(TEXTES_COMPTE.verification.lienInvalide)).toBeVisible();
    await expect(
      page.getByRole("button", { name: TEXTES_COMPTE.verification.confirmer }),
    ).toHaveCount(0);

    await page.getByLabel(TEXTES_COMPTE.renvoi.email).fill(email);
    const [renvoi] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/auth/send-verification-email",
      ),
      page.getByRole("button", { name: TEXTES_COMPTE.renvoi.envoyer }).click(),
    ]);
    expect(await renvoi.json()).toEqual({ ok: true });
    await expect(page.getByText(TEXTES_COMPTE.renvoi.confirmation)).toBeVisible();
    const second = await attendreEmail(email, 2);
    expect(second.sujet).toBe(TEXTES_EMAILS.modeles["compte.verification"].sujet);
    expect(lienDe(second)).not.toBe(premier);
  });

  test("lien sans jeton : « Ce lien n'est plus valable », aucun appel à /api/auth", async ({
    page,
  }) => {
    const appels: string[] = [];
    page.on("request", (requete) => {
      if (new URL(requete.url()).pathname.startsWith("/api/auth")) appels.push(requete.url());
    });

    for (const fragment of ["", "#", "#pas-un-jeton", `#${"a".repeat(2000)}.b.c`]) {
      await page.goto(`/lien/verification${fragment}`);
      await expect(page.getByText(TEXTES_COMPTE.verification.lienInvalide)).toBeVisible();
      await expect(
        page.getByRole("button", { name: TEXTES_COMPTE.verification.confirmer }),
      ).toHaveCount(0);
    }
    expect(appels).toEqual([]);
  });

  test("renvoi depuis « Vérifiez votre boîte » : même message pour toute adresse", async ({
    page,
  }, info) => {
    await adresseIpPropre(page);
    const ecrans: string[] = [];
    for (const email of [adresseE2E(info.project.name, 5), adresseE2E(info.project.name, 6)]) {
      await page.goto("/inscription/envoyee");
      await page.getByLabel(TEXTES_COMPTE.renvoi.email).fill(email);
      const [reponse] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/auth/send-verification-email",
        ),
        page.getByRole("button", { name: TEXTES_COMPTE.renvoi.envoyer }).click(),
      ]);
      expect(await reponse.json()).toEqual({ ok: true });
      await expect(page.getByText(TEXTES_COMPTE.renvoi.confirmation)).toBeVisible();
      ecrans.push(await page.getByRole("main").innerText());
    }
    expect(ecrans[1]).toBe(ecrans[0]);
  });
});

test.describe("inscription, sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("formulaire et confirmation : message fixe, aucun champ, rien ne peut partir", async ({
    page,
  }) => {
    await page.goto("/inscription");
    await expect(page.getByText(TEXTES_COMPTE.inscription.sansJavaScript)).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("input, form")).toHaveCount(0);

    await page.goto("/lien/verification#a.b.c");
    await expect(page.getByText(TEXTES_COMPTE.verification.sansJavaScript)).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
  });
});

test.describe("inscription, interface", () => {
  const PAGES_COMPTE: { chemin: string; titre: string }[] = [
    { chemin: "/inscription", titre: TEXTES_COMPTE.inscription.titre },
    { chemin: "/inscription/envoyee", titre: TEXTES_COMPTE.envoyee.titre },
    { chemin: "/inscription/verifiee", titre: TEXTES_COMPTE.verifiee.titre },
    { chemin: "/lien/verification#a.b.c", titre: TEXTES_COMPTE.verification.titre },
  ];

  for (const { chemin, titre } of PAGES_COMPTE) {
    test(`${chemin} : en français, chaque champ a son libellé, aucun texte anglais`, async ({
      page,
    }) => {
      await observerViolations(page);
      await page.goto(chemin);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(titre);
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      const texte = await page.locator("body").innerText();
      expect(texte).not.toMatch(
        /\b(sign up|sign in|password|submit|email address|loading|error|not found|verify)\b/i,
      );
      // Chaque champ visible a un nom accessible, qui est son libellé visible.
      const champs = page.locator("input:visible");
      for (let rang = 0; rang < (await champs.count()); rang += 1) {
        const champ = champs.nth(rang);
        const id = await champ.getAttribute("id");
        expect(id).not.toBeNull();
        await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
      }
      expect(await violations(page)).toEqual([]);
    });
  }

  test("au clavier seul : remplir et envoyer l'inscription", async ({ page }, info) => {
    const email = adresseE2E(info.project.name, 7);
    await adresseIpPropre(page);
    await page.goto("/inscription");

    await page.keyboard.press("Tab");
    await expect(page.getByLabel(TEXTES_COMPTE.inscription.nom)).toBeFocused();
    await page.keyboard.type("Awa Koné");
    await page.keyboard.press("Tab");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(MOT_DE_PASSE);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: TEXTES_COMPTE.inscription.envoyer }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(`${ADRESSE}/inscription/envoyee`);
  });
});
