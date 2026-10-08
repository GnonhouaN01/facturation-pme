import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

// Vérifie les règles d'import de la 0.2 par l'API d'ESLint, sur du code
// fourni en texte : aucun fichier n'est écrit. Les chemins désignent des
// fichiers fictifs, auxquels eslint.config.mjs s'applique comme aux vrais.
// Fiche : docs/features/acces-donnees.md, section 4.1.

const eslint = new ESLint();

const REGLES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function refus(code: string, fichier: string): Promise<string[]> {
  const [resultat] = await eslint.lintText(code, { filePath: fichier });
  if (!resultat) throw new Error("ESLint n'a renvoyé aucun résultat.");
  const fatales = resultat.messages.filter((message) => message.fatal);
  expect(fatales, "code de test illisible par ESLint").toEqual([]);
  return resultat.messages
    .filter((message) => message.ruleId !== null && REGLES.has(message.ruleId))
    .map((message) => message.message);
}

const OUTILS_ALIAS = `import { creerDeuxOrganisations } from "@/server/db/outils-test/organisations";
export const f = creerDeuxOrganisations;
`;
const OUTILS_DYNAMIQUE = `export const f = () => import("@/server/db/outils-test/organisations");
`;
const OUTILS_RELATIF_REQUETES = `import { creerDeuxOrganisations } from "../outils-test/organisations";
export const f = creerDeuxOrganisations;
`;
const OUTILS_RELATIF_DB = `import { verifierIsolation } from "./outils-test/isolation";
export const f = verifierIsolation;
`;
const OUTILS_INTERNE = `import { creerDeuxOrganisations } from "./organisations";
export const f = creerDeuxOrganisations;
`;

describe(
  "l'outillage de test ne s'importe que depuis un fichier de test",
  { timeout: 60_000 },
  () => {
    test.each([
      ["page de l'application", OUTILS_ALIAS, "src/app/essai/page.tsx"],
      ["requête", OUTILS_RELATIF_REQUETES, "src/server/db/requetes/essai.ts"],
      ["fichier de db/", OUTILS_RELATIF_DB, "src/server/db/essai.ts"],
      ["service", OUTILS_ALIAS, "src/server/services/essai.ts"],
      ["import dynamique depuis un service", OUTILS_DYNAMIQUE, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["test unitaire", OUTILS_RELATIF_DB, "src/server/db/essai.test.ts"],
      ["test d'intégration", OUTILS_RELATIF_DB, "src/server/db/essai.integration.test.ts"],
      ["test d'attaque", OUTILS_RELATIF_DB, "src/server/db/essai.attaque.integration.test.ts"],
      ["fichier de outils-test/", OUTILS_INTERNE, "src/server/db/outils-test/essai.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

const DB_ALIAS = `import { db } from "@/server/db/client";
export const f = db;
`;
const DB_RELATIF_SERVICES = `import { db } from "../db/client";
export const f = db;
`;
const DB_ESPACE = `import * as client from "@/server/db/client";
export const f = client;
`;
const DB_REEXPORT = `export { db } from "@/server/db/client";
`;
const DB_RELATIF_AUTH = `import { db } from "../db/client";
export const f = db;
`;
const DB_RELATIF_REQUETES = `import { db } from "../client";
export const f = db;
`;
const EXECUTER = `import { executerDansOrganisation } from "@/server/db/client";
export const f = executerDansOrganisation;
`;

describe("db ne s'importe que dans auth/config.ts et db/", { timeout: 60_000 }, () => {
  test.each([
    ["service, par l'alias", DB_ALIAS, "src/server/services/essai.ts"],
    ["service, par un chemin relatif", DB_RELATIF_SERVICES, "src/server/services/essai.ts"],
    ["page de l'application", DB_ALIAS, "src/app/essai/page.tsx"],
    ["autre fichier de auth/", DB_RELATIF_AUTH, "src/server/auth/session.ts"],
    ["import d'espace de noms", DB_ESPACE, "src/server/services/essai.ts"],
    ["réexportation", DB_REEXPORT, "src/server/services/essai.ts"],
  ])("%s : refusé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).not.toEqual([]);
  });

  test.each([
    ["auth/config.ts", DB_RELATIF_AUTH, "src/server/auth/config.ts"],
    ["requête de db/", DB_RELATIF_REQUETES, "src/server/db/requetes/essai.ts"],
    ["executerDansOrganisation depuis un service", EXECUTER, "src/server/services/essai.ts"],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).toEqual([]);
  });
});

// 0.3 : l'insertion au journal d'audit ne s'importe que depuis la fonction
// d'écriture, qui valide l'entrée. Fiche : docs/features/journal-audit.md,
// section 7.
const JOURNAL_ALIAS = `import { insererEntreeJournal } from "@/server/db/requetes/journal";
export const f = insererEntreeJournal;
`;
const JOURNAL_DYNAMIQUE = `export const f = () => import("@/server/db/requetes/journal");
`;
const JOURNAL_RELATIF_REQUETES = `import { insererEntreeJournal } from "./journal";
export const f = insererEntreeJournal;
`;
const JOURNAL_RELATIF_AUDIT = `import { insererEntreeJournal } from "../db/requetes/journal";
export const f = insererEntreeJournal;
`;

describe(
  "l'insertion au journal ne s'importe que depuis journal/audit.ts et les tests",
  { timeout: 60_000 },
  () => {
    test.each([
      ["service", JOURNAL_ALIAS, "src/server/services/essai.ts"],
      ["import dynamique depuis un service", JOURNAL_DYNAMIQUE, "src/server/services/essai.ts"],
      ["page de l'application", JOURNAL_ALIAS, "src/app/essai/page.tsx"],
      ["autre requête", JOURNAL_RELATIF_REQUETES, "src/server/db/requetes/essai.ts"],
      ["autre fichier de journal/", JOURNAL_RELATIF_AUDIT, "src/server/journal/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["journal/audit.ts", JOURNAL_RELATIF_AUDIT, "src/server/journal/audit.ts"],
      ["test unitaire de journal/", JOURNAL_RELATIF_AUDIT, "src/server/journal/essai.test.ts"],
      ["test d'intégration de db/", JOURNAL_ALIAS, "src/server/db/essai.integration.test.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);
