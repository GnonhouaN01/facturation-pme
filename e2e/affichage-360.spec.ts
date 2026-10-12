import { expect, test } from "@playwright/test";

import { capturer, defilementHorizontal, PAGES } from "./pages-livrees";

// Défilement horizontal à 360 px, la plus petite largeur visée (NF-04). Ce
// fichier ne tourne que dans le projet mobile-390 (playwright.config.ts) :
// la largeur est imposée ici, une seule exécution suffit.
// Fiche : docs/features/socle-interface.md, section 12.

test.use({ viewport: { width: 360, height: 780 } });

for (const definition of PAGES) {
  test(`page ${definition.nom} : aucun défilement horizontal à 360 px, et capture`, async ({
    page,
  }) => {
    await definition.ouvrir(page);

    const { largeurContenu, largeurFenetre } = await defilementHorizontal(page);
    expect(largeurFenetre).toBe(360);
    expect(largeurContenu).toBeLessThanOrEqual(largeurFenetre);
    await capturer(page, definition.nom);
  });
}
