import { type Locator, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";

import {
  ADRESSE,
  adresseConnexion,
  creerCompteVerifie,
  ipAuHasard,
  MOT_DE_PASSE,
} from "./compte-verifie";
import { outilOrganisation } from "./organisation-e2e";
import { observerViolations, violations } from "./outils";
import { capturer, defilementHorizontal } from "./pages-livrees";

// Gabarit de l'application dans un navigateur connecté, repris de la 0.6
// (décision 27 de docs/features/socle-interface.md) : barre latérale de
// 240 px à 1280 px, empilée au-dessus du contenu sous 768 px, cibles de
// 44 px, anneau de focus, aucun défilement horizontal à 390 et 360 px,
// captures. L'adhésion vient de l'organisation de test (e2e/organisation-e2e.ts),
// créée seulement sur la base jetable ou en CI ; ailleurs, ces tests sont
// sautés avec un message. Fiche : docs/features/connexion.md, sections 8.2 et
// 8.3, test 24.

const ACCENT = "rgb(36, 72, 201)";
const outil = outilOrganisation();

test.describe("gabarit de l'application, navigateur connecté", () => {
  test.skip("saut" in outil, "saut" in outil ? outil.saut : "");

  test.afterAll(async () => {
    if (!("saut" in outil)) await outil.nettoyer();
  });

  async function ouvrirTableauDeBord(page: Page, email: string) {
    if ("saut" in outil) throw new Error(outil.saut);
    await creerCompteVerifie(email);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": ipAuHasard() });
    await page.goto("/connexion");
    await page.getByLabel(TEXTES_COMPTE.connexion.email).fill(email);
    await page.getByLabel(TEXTES_COMPTE.connexion.motDePasse).fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: TEXTES_COMPTE.connexion.envoyer }).click();
    await expect(page).toHaveURL(`${ADRESSE}/compte`);
    await outil.rattacher(email);
    await page.goto("/tableau-de-bord");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      TEXTES_NAVIGATION.entrees.tableauDeBord,
    );
  }

  async function anneauDeFocus(cible: Locator) {
    await expect(cible).toBeFocused();
    await expect(cible).toHaveCSS("outline-width", "2px");
    await expect(cible).toHaveCSS("outline-style", "solid");
    await expect(cible).toHaveCSS("outline-color", ACCENT);
    await expect(cible).toHaveCSS("outline-offset", "2px");
  }

  // Tabulations jusqu'à la cible (au plus 15).
  async function tabulerJusqua(page: Page, cible: Locator) {
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press("Tab");
      if (await cible.evaluate((e) => e === document.activeElement)) return;
    }
    throw new Error("cible jamais atteinte au clavier");
  }

  test("disposition, cibles, focus, défilement, captures, déconnexion", async ({ page }, info) => {
    await observerViolations(page);
    await ouvrirTableauDeBord(page, adresseConnexion(info, "gabarit"));
    const largeur = page.viewportSize()?.width ?? 0;
    const barre = page.locator("aside");
    const contenu = page.getByRole("main");
    const boiteBarre = await barre.boundingBox();
    const boiteContenu = await contenu.boundingBox();
    if (!boiteBarre || !boiteContenu) throw new Error("gabarit absent");

    if (largeur >= 768) {
      // Barre latérale de 240 px à gauche, contenu à sa droite.
      expect(boiteBarre.width).toBe(240);
      expect(boiteBarre.x).toBe(0);
      expect(boiteContenu.x).toBeGreaterThanOrEqual(240);
    } else {
      // Barre au-dessus du contenu, sur toute la largeur.
      expect(boiteBarre.width).toBe(largeur);
      expect(boiteBarre.y + boiteBarre.height).toBeLessThanOrEqual(boiteContenu.y + 1);
    }

    // Cibles de 44 px au moins : liens, boutons, résumé du menu replié.
    const hauteurs = await page
      .locator("a:visible, button:visible, summary:visible")
      .evaluateAll((elements) =>
        elements
          // Modifié : le lien d'évitement, masqué hors focus (1 px), n'est pas
          // une cible ; son focus est vérifié plus bas.
          .filter((e) => e.getBoundingClientRect().width > 1)
          .map((e) => ({
            texte: (e.textContent ?? "").trim(),
            hauteur: e.getBoundingClientRect().height,
          })),
      );
    expect(hauteurs.map((h) => h.texte)).toContain(TEXTES_COMPTE.deconnexion.bouton);
    for (const { texte, hauteur } of hauteurs) expect(hauteur, texte).toBeGreaterThanOrEqual(44);

    // Anneau de focus : lien d'évitement, puis la navigation (ou le menu
    // replié sous 768 px), puis « Se déconnecter ».
    await page.keyboard.press("Tab");
    await anneauDeFocus(page.getByRole("link", { name: TEXTES_COMMUNS.allerAuContenu }));
    const navigation =
      largeur >= 768
        ? page.getByRole("link", { name: TEXTES_NAVIGATION.entrees.tableauDeBord })
        : page.locator("summary", { hasText: TEXTES_COMMUNS.menu });
    await tabulerJusqua(page, navigation);
    await anneauDeFocus(navigation);
    const deconnexion = page.getByRole("button", { name: TEXTES_COMPTE.deconnexion.bouton });
    await tabulerJusqua(page, deconnexion);
    await anneauDeFocus(deconnexion);

    // Aucun défilement horizontal, à la largeur du projet et à 360 px.
    const tailles = largeur >= 768 ? [largeur] : [largeur, 360];
    for (const taille of tailles) {
      await page.setViewportSize({ width: taille, height: 844 });
      const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
      expect(largeurContenu, `${taille} px`).toBeLessThanOrEqual(largeurFenetre);
      await capturer(page, "tableau-de-bord-connecte");
    }
    expect(await violations(page)).toEqual([]);

    // « Se déconnecter » du gabarit : retour à la connexion, tableau de bord fermé.
    await deconnexion.click();
    await expect(page).toHaveURL(`${ADRESSE}/connexion`);
    await page.goto("/tableau-de-bord");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      TEXTES_NAVIGATION.entrees.tableauDeBord,
    );
  });
});
