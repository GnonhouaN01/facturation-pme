import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { TACHES } from "./quotidienne";

// La planification de Vercel Cron : une seule tâche, une fois par jour.
// Sur l'offre Hobby, une expression plus fréquente fait échouer le
// déploiement ; ce test le dit avant. Aucune autre clé dans vercel.json : les
// autres réglages restent dans next.config.ts. Fiche :
// docs/features/tache-quotidienne.md, section 1.2, test 5.

vi.mock("@/server/env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  secretTache: { secret: null },
}));

const FICHIER = fileURLToPath(new URL("../../../vercel.json", import.meta.url));

// Minute 0 à 59, heure 0 à 23, puis « * * * » : une fois par jour.
const QUOTIDIENNE = /^([0-9]|[1-5][0-9]) ([0-9]|1[0-9]|2[0-3]) \* \* \*$/;

function lire(): Record<string, unknown> {
  return JSON.parse(readFileSync(FICHIER, "utf8")) as Record<string, unknown>;
}

describe("vercel.json", () => {
  test("seules les clés $schema et crons", () => {
    expect(Object.keys(lire()).sort()).toEqual(["$schema", "crons"]);
  });

  test("une seule tâche, /api/taches/quotidienne, une fois par jour", () => {
    expect(lire().crons).toEqual([
      { path: "/api/taches/quotidienne", schedule: expect.stringMatching(QUOTIDIENNE) as string },
    ]);
  });

  test("le nom de chaque tâche planifiée figure dans la liste fermée TACHES", () => {
    for (const { path } of lire().crons as { path: string }[]) {
      const nom = path.replace(/^\/api\/taches\//, "");
      expect(Object.hasOwn(TACHES, nom), path).toBe(true);
    }
  });

  test.each([
    ["0 3 * * *", true],
    ["59 23 * * *", true],
    ["0 * * * *", false],
    ["*/30 * * * *", false],
    ["0 3,15 * * *", false],
    ["0 */12 * * *", false],
    ["0 24 * * *", false],
    ["60 3 * * *", false],
    ["0 3 * * 1", false],
  ])("expression %s : quotidienne %s", (expression, attendu) => {
    expect(QUOTIDIENNE.test(expression)).toBe(attendu);
  });
});
