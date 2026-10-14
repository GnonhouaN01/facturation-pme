import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { preparerJournaux } from "./journaux";

// Sortie des serveurs de bout en bout conservée à chaque exécution, pour
// expliquer après coup une réponse 500. Fiche :
// docs/features/e2e-base-jetable.md, section 4.

test.describe("journaux des serveurs de bout en bout", () => {
  test("deux chemins neufs par exécution, dix exécutions gardées au plus", async () => {
    const dossier = join(mkdtempSync(join(tmpdir(), "journaux-e2e-")), "journaux");
    try {
      // Dossier absent : créé.
      const premiers = preparerJournaux({
        dossier,
        maintenant: new Date("2026-10-14T08:00:00.000Z"),
      });
      expect(existsSync(dossier)).toBe(true);
      expect(resolve(dirname(premiers.site))).toBe(resolve(dossier));
      expect(basename(premiers.site)).toBe("2026-10-14T08-00-00-000Z-site.log");
      expect(basename(premiers.panne)).toBe("2026-10-14T08-00-00-000Z-panne.log");
      expect(existsSync(premiers.site)).toBe(false);

      // Douze exécutions anciennes, plus un fichier sans rapport.
      for (let i = 0; i < 12; i++) {
        const prefixe = `2026-10-13T10-${String(i).padStart(2, "0")}-00-000Z`;
        writeFileSync(join(dossier, `${prefixe}-site.log`), "");
        writeFileSync(join(dossier, `${prefixe}-panne.log`), "");
      }
      writeFileSync(join(dossier, "a-garder.txt"), "");

      const chemins = preparerJournaux({
        dossier,
        garder: 10,
        maintenant: new Date("2026-10-14T09:00:00.000Z"),
      });
      const restants = readdirSync(dossier).sort();
      // Neuf anciennes gardées : la nouvelle sera la dixième.
      expect(restants.filter((n) => n.endsWith(".log"))).toHaveLength(18);
      expect(restants).toContain("a-garder.txt");
      expect(restants).not.toContain("2026-10-13T10-02-00-000Z-site.log");
      expect(restants).toContain("2026-10-13T10-03-00-000Z-site.log");
      expect(restants).toContain("2026-10-13T10-11-00-000Z-panne.log");
      expect(basename(chemins.site)).toBe("2026-10-14T09-00-00-000Z-site.log");
    } finally {
      rmSync(dirname(dossier), { recursive: true, force: true });
    }
  });
});
