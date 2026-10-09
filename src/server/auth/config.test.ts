import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { organization, testUtils } from "better-auth/plugins";
import { describe, expect, test, vi } from "vitest";

import { auth, optionsAuth } from "./config";

// Le module testUtils de Better Auth crée des sessions sans mot de passe : il
// n'existe que dans l'instance de test (src/server/db/outils-test/), jamais
// dans la configuration de production. Fiche :
// docs/features/chaine-controles.md, section 10.

// config.ts charge env.ts et client.ts : valeurs factices, aucune connexion
// n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const ID_TEST_UTILS = testUtils().id;

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const OUTILS_TEST = join("server", "db", "outils-test") + sep;

function identifiants(plugins: readonly { id: string }[] | undefined): string[] {
  return (plugins ?? []).map((plugin) => plugin.id);
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name));
}

describe("testUtils absent de la configuration de production", () => {
  test("l'identifiant cherché est celui du module, et la recherche le trouve", () => {
    expect(ID_TEST_UTILS).toBe("test-utils");
    expect(identifiants([organization(), testUtils()])).toContain(ID_TEST_UTILS);
  });

  test("optionsAuth : modules attendus présents, testUtils absent", () => {
    const ids = identifiants(optionsAuth.plugins);

    expect(ids).toContain("organization");
    expect(ids).not.toContain(ID_TEST_UTILS);
  });

  test("instance auth : modules attendus présents, testUtils absent", () => {
    const ids = identifiants(auth.options.plugins);

    expect(ids).toContain("organization");
    expect(ids).not.toContain(ID_TEST_UTILS);
  });

  test("instance auth : aucune aide de test dans son contexte", async () => {
    const contexte = await auth.$context;

    expect(contexte).not.toHaveProperty("test");
  });

  // Attrape aussi un ajout conditionnel (selon une variable d'environnement),
  // que la configuration chargée sous Vitest ne montrerait pas.
  test("aucun fichier de src/ hors des tests et de outils-test/ ne mentionne testUtils", () => {
    const parcourus = fichiers(SRC).map((chemin) => relative(SRC, chemin));
    const fautifs = parcourus
      .filter((chemin) => !chemin.startsWith(OUTILS_TEST) && !/\.test\.tsx?$/.test(chemin))
      .filter((chemin) => /testUtils|test-utils/.test(readFileSync(join(SRC, chemin), "utf8")));

    expect(parcourus).toContain(join("server", "auth", "config.ts"));
    expect(fautifs).toEqual([]);
  });
});
