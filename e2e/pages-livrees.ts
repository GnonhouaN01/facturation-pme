import { join } from "node:path";

import { type Page, expect } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_ERREURS } from "../src/textes/erreurs";

import { ADRESSE_PANNE, COOKIE_SESSION, cookieSessionSigne } from "./serveur-panne";

// Pages livrées en 0.6 et joignables sans session, pour les tests
// d'affichage (e2e/affichage.spec.ts, e2e/affichage-360.spec.ts). Les
// captures vont dans test-results/captures/, dossier ignoré par git et vidé
// par Playwright à chaque lancement. Fiche : docs/features/socle-interface.md,
// section 12.

const CAPTURES = join("test-results", "captures");

export type PageLivree = {
  nom: string;
  // Prépare le navigateur, ouvre la page et attend son titre.
  ouvrir: (page: Page) => Promise<void>;
  // Action atteinte par la première tabulation, ou null.
  premiereAction: ((page: Page) => ReturnType<Page["getByRole"]>) | null;
};

async function attendreTitre(page: Page, texte: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(texte);
}

export const PAGES: readonly PageLivree[] = [
  {
    nom: "publique",
    ouvrir: async (page) => {
      await page.goto("/");
      await attendreTitre(page, TEXTES_COMMUNS.produit);
    },
    premiereAction: null,
  },
  {
    nom: "introuvable",
    ouvrir: async (page) => {
      await page.goto("/adresse-inexistante");
      await attendreTitre(page, TEXTES_ERREURS.introuvable);
    },
    premiereAction: (page) => page.getByRole("link", { name: TEXTES_COMMUNS.revenirAccueil }),
  },
  {
    nom: "tableau-de-bord-sans-session",
    ouvrir: async (page) => {
      await page.goto("/tableau-de-bord");
      await attendreTitre(page, TEXTES_ERREURS.introuvable);
    },
    premiereAction: (page) => page.getByRole("link", { name: TEXTES_COMMUNS.revenirAccueil }),
  },
  {
    // Second serveur, base injoignable (e2e/serveur-panne.ts).
    nom: "erreur",
    ouvrir: async (page) => {
      await page
        .context()
        .addCookies([{ name: COOKIE_SESSION, value: cookieSessionSigne(), url: ADRESSE_PANNE }]);
      await page.goto(`${ADRESSE_PANNE}/tableau-de-bord`);
      await attendreTitre(page, TEXTES_ERREURS.erreur);
    },
    premiereAction: (page) => page.getByRole("button", { name: TEXTES_ERREURS.recharger }),
  },
];

export async function capturer(page: Page, nom: string) {
  const largeur = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: join(CAPTURES, `${nom}-${largeur}.png`), fullPage: true });
}

export async function defilementHorizontal(page: Page) {
  return page.evaluate(() => ({
    largeurContenu: document.documentElement.scrollWidth,
    largeurFenetre: window.innerWidth,
  }));
}
