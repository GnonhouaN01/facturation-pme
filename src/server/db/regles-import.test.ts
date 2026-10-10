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
    ["executerDansOrganisation depuis actions/action.ts", EXECUTER, "src/server/actions/action.ts"],
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

// 0.4 : la chaîne de contrôles ne se contourne pas (règles G à L). Fiche :
// docs/features/chaine-controles.md, section 7.

const ACTION_EXPOSEE = `"use server";
import { exposer } from "@/server/actions/exposer";
import { demo } from "@/server/actions/demo";
export const agir = exposer(demo);
`;
const ACTION_FONCTION = `"use server";
export async function agir() {
  return 1;
}
`;
const ACTION_DEFAUT = `"use server";
export default async function agir() {
  return 1;
}
`;
const ACTION_FLECHE = `"use server";
export const agir = async () => 1;
`;
const ACTION_AUTRE_APPEL = `"use server";
import { envelopper } from "@/server/actions/autre";
import { demo } from "@/server/actions/demo";
export const agir = envelopper(demo);
`;
const ACTION_LISTE = `"use server";
const agir = async () => 1;
export { agir };
`;
const ACTION_REEXPORT = `"use server";
export { agir } from "./autre";
`;
const ACTION_TOUT = `"use server";
export * from "./autre";
`;
const ACTION_LET = `"use server";
import { exposer } from "@/server/actions/exposer";
import { demo } from "@/server/actions/demo";
export let agir = exposer(demo);
`;
const ACTION_DECLARATIONS_MULTIPLES = `"use server";
import { exposer } from "@/server/actions/exposer";
import { demo } from "@/server/actions/demo";
export const agir = exposer(demo),
  autre = async () => 1;
`;
const SANS_DIRECTIVE = `export async function utilitaire() {
  return 1;
}
`;

describe('G. un fichier "use server" n\'exporte que exposer(...)', { timeout: 60_000 }, () => {
  test.each([
    ["export async function", ACTION_FONCTION],
    ["export default", ACTION_DEFAUT],
    ["fonction fléchée", ACTION_FLECHE],
    ["appel d'une autre fonction", ACTION_AUTRE_APPEL],
    ["export { ... } d'une fonction", ACTION_LISTE],
    ["réexportation nommée", ACTION_REEXPORT],
    ["réexportation de tout", ACTION_TOUT],
    ["export let", ACTION_LET],
    ["second export dans la même déclaration", ACTION_DECLARATIONS_MULTIPLES],
  ])("%s : refusé", async (_nom, code) => {
    expect(await refus(code, "src/app/essai/actions.ts")).not.toEqual([]);
  });

  test.each([
    ["export const x = exposer(y)", ACTION_EXPOSEE, "src/app/essai/actions.ts"],
    ["dans un groupe de routes", ACTION_EXPOSEE, "src/app/(app)/clients/actions.ts"],
    ["fichier sans directive", SANS_DIRECTIVE, "src/app/essai/utilitaires.ts"],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).toEqual([]);
  });
});

const DIRECTIVE_EN_LIGNE_PAGE = `export default function Page() {
  async function agir() {
    "use server";
    return 1;
  }
  void agir;
  return null;
}
`;
const DIRECTIVE_EN_LIGNE_ACTIONS = `"use server";
import { exposer } from "@/server/actions/exposer";
import { demo } from "@/server/actions/demo";
export const agir = exposer(demo);
const interne = async () => {
  "use server";
  return 1;
};
void interne;
`;
const DIRECTIVE_SERVICE = `"use server";
export const agir = 1;
`;
const COMPOSANT_CLIENT = `"use client";
export default function Composant() {
  return null;
}
`;
const CHAINE_ORDINAIRE = `export const texte = "use server";
`;

describe('H. "use server" seulement en tête de src/app/**/actions.ts', { timeout: 60_000 }, () => {
  test.each([
    ["en tête d'une page", ACTION_EXPOSEE, "src/app/essai/page.tsx"],
    ["en tête d'un service", DIRECTIVE_SERVICE, "src/server/services/essai.ts"],
    ["en tête d'un fichier de actions/", DIRECTIVE_SERVICE, "src/server/actions/essai.ts"],
    ["en tête d'un actions.tsx", ACTION_EXPOSEE, "src/app/essai/actions.tsx"],
    ["dans une fonction d'une page", DIRECTIVE_EN_LIGNE_PAGE, "src/app/essai/page.tsx"],
    ["dans une fonction de actions.ts", DIRECTIVE_EN_LIGNE_ACTIONS, "src/app/essai/actions.ts"],
  ])("%s : refusé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).not.toEqual([]);
  });

  test.each([
    ["en tête de actions.ts", ACTION_EXPOSEE, "src/app/essai/actions.ts"],
    ["composant client", COMPOSANT_CLIENT, "src/app/essai/composant.tsx"],
    ["chaîne ordinaire, hors directive", CHAINE_ORDINAIRE, "src/server/services/essai.ts"],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).toEqual([]);
  });
});

const EXECUTER_RELATIF_SERVICES = `import { executerDansOrganisation } from "../db/client";
export const f = executerDansOrganisation;
`;
const EXECUTER_RELATIF_AUTH = `import { executerDansOrganisation } from "../db/client";
export const f = executerDansOrganisation;
`;
const EXECUTER_RELATIF_REQUETES = `import { executerDansOrganisation } from "../client";
export const f = executerDansOrganisation;
`;
const EXECUTER_DYNAMIQUE = `export const f = () => import("@/server/db/client");
`;
const EXECUTER_REEXPORT = `export { executerDansOrganisation } from "@/server/db/client";
`;
const TYPE_TRANSACTION = `import type { TransactionOrganisation } from "@/server/db/client";
export type T = TransactionOrganisation;
`;
const ERREUR_ORGANISATION = `import { OrganisationActiveInvalide } from "../db/client";
export const f = OrganisationActiveInvalide;
`;

describe(
  "I. executerDansOrganisation seulement dans actions/action.ts, db/ et les tests",
  { timeout: 60_000 },
  () => {
    test.each([
      ["service, par l'alias", EXECUTER, "src/server/services/essai.ts"],
      ["service, par un chemin relatif", EXECUTER_RELATIF_SERVICES, "src/server/services/essai.ts"],
      ["page de l'application", EXECUTER, "src/app/essai/page.tsx"],
      ["autre fichier de actions/", EXECUTER_RELATIF_SERVICES, "src/server/actions/essai.ts"],
      ["fichier de auth/", EXECUTER_RELATIF_AUTH, "src/server/auth/essai.ts"],
      ["fichier de journal/", EXECUTER_RELATIF_SERVICES, "src/server/journal/essai.ts"],
      ["import dynamique depuis un service", EXECUTER_DYNAMIQUE, "src/server/services/essai.ts"],
      ["réexportation depuis un service", EXECUTER_REEXPORT, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["actions/action.ts", EXECUTER_RELATIF_SERVICES, "src/server/actions/action.ts"],
      ["requête de db/", EXECUTER_RELATIF_REQUETES, "src/server/db/requetes/essai.ts"],
      ["outillage de test", EXECUTER_RELATIF_REQUETES, "src/server/db/outils-test/essai.ts"],
      ["test de actions/", EXECUTER, "src/server/actions/essai.test.ts"],
      ["test d'un service", EXECUTER, "src/server/services/essai.test.ts"],
      [
        "type TransactionOrganisation depuis un service",
        TYPE_TRANSACTION,
        "src/server/services/essai.ts",
      ],
      [
        "OrganisationActiveInvalide depuis actions/refus.ts",
        ERREUR_ORGANISATION,
        "src/server/actions/refus.ts",
      ],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

const JOURNALISER_ALIAS = `import { journaliser } from "@/server/journal/audit";
export const f = journaliser;
`;
const JOURNALISER_RELATIF = `import { journaliser } from "../journal/audit";
export const f = journaliser;
`;
const JOURNALISER_REQUETES = `import { journaliser } from "../../journal/audit";
export const f = journaliser;
`;
const JOURNALISER_LOCAL = `import { journaliser } from "./audit";
export const f = journaliser;
`;
const JOURNALISER_DYNAMIQUE = `export const f = () => import("@/server/journal/audit");
`;
const JOURNALISER_REEXPORT = `export { journaliser } from "@/server/journal/audit";
`;

describe(
  "J. journaliser seulement dans actions/action.ts et les tests",
  { timeout: 60_000 },
  () => {
    test.each([
      ["service, par l'alias", JOURNALISER_ALIAS, "src/server/services/essai.ts"],
      ["service, par un chemin relatif", JOURNALISER_RELATIF, "src/server/services/essai.ts"],
      ["page de l'application", JOURNALISER_ALIAS, "src/app/essai/page.tsx"],
      ["autre fichier de actions/", JOURNALISER_RELATIF, "src/server/actions/essai.ts"],
      ["requête de db/", JOURNALISER_REQUETES, "src/server/db/requetes/essai.ts"],
      ["autre fichier de journal/", JOURNALISER_LOCAL, "src/server/journal/essai.ts"],
      ["import dynamique depuis un service", JOURNALISER_DYNAMIQUE, "src/server/services/essai.ts"],
      ["réexportation depuis un service", JOURNALISER_REEXPORT, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["actions/action.ts", JOURNALISER_RELATIF, "src/server/actions/action.ts"],
      ["test de journal/", JOURNALISER_LOCAL, "src/server/journal/audit.test.ts"],
      ["test d'intégration de db/", JOURNALISER_RELATIF, "src/server/db/essai.integration.test.ts"],
      ["test de actions/", JOURNALISER_ALIAS, "src/server/actions/essai.test.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

const CLE_LITTERALE = `export const cle = "app.organisation_id";
`;
const CLE_LECTURE = `export const requete = "SELECT current_setting('app.organisation_id', true)";
`;
const CLE_GABARIT = `import { sql } from "drizzle-orm";
export const fixer = (id: string) => sql\`SELECT set_config('app.organisation_id', \${id}, true)\`;
`;
const CLE_GABARIT_SIMPLE = `export const cle = \`app.organisation_id\`;
`;

describe(
  "K. app.organisation_id seulement dans db/client.ts, db/schema/isolation.ts et les tests",
  { timeout: 60_000 },
  () => {
    test.each([
      ["littéral dans un service", CLE_LITTERALE, "src/server/services/essai.ts"],
      ["lecture du réglage dans un service", CLE_LECTURE, "src/server/services/essai.ts"],
      ["gabarit dans une requête de db/", CLE_GABARIT, "src/server/db/requetes/essai.ts"],
      ["gabarit dans un autre fichier de db/", CLE_GABARIT, "src/server/db/essai.ts"],
      [
        "gabarit sans expression dans actions/action.ts",
        CLE_GABARIT_SIMPLE,
        "src/server/actions/action.ts",
      ],
      ["littéral dans une page", CLE_LITTERALE, "src/app/essai/page.tsx"],
      ["gabarit dans l'outillage de test", CLE_GABARIT, "src/server/db/outils-test/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["db/client.ts", CLE_GABARIT, "src/server/db/client.ts"],
      ["db/schema/isolation.ts", CLE_GABARIT, "src/server/db/schema/isolation.ts"],
      ["test d'attaque de db/", CLE_GABARIT, "src/server/db/essai.attaque.integration.test.ts"],
      ["test unitaire hors de db/", CLE_LITTERALE, "src/server/actions/essai.test.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

const ENTETES = `import { headers } from "next/headers";
export const f = headers;
`;
const COOKIES = `import { cookies } from "next/headers";
export const f = cookies;
`;
const ENTETES_JS = `import { headers } from "next/headers.js";
export const f = headers;
`;
const ENTETES_DYNAMIQUE = `export const f = () => import("next/headers");
`;
const ENTETES_REEXPORT = `export { headers } from "next/headers";
`;

describe("L. next/headers dans actions/ seulement par exposer.ts", { timeout: 60_000 }, () => {
  test.each([
    ["actions/action.ts", ENTETES, "src/server/actions/action.ts"],
    ["actions/refus.ts, cookies", COOKIES, "src/server/actions/refus.ts"],
    ["autre fichier de actions/, next/headers.js", ENTETES_JS, "src/server/actions/essai.ts"],
    ["import dynamique", ENTETES_DYNAMIQUE, "src/server/actions/essai.ts"],
    ["réexportation", ENTETES_REEXPORT, "src/server/actions/essai.ts"],
  ])("%s : refusé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).not.toEqual([]);
  });

  test.each([
    ["actions/exposer.ts", ENTETES, "src/server/actions/exposer.ts"],
    ["test de actions/", ENTETES, "src/server/actions/exposer.test.ts"],
    ["page de l'application", ENTETES, "src/app/essai/page.tsx"],
    ["fichier de auth/", ENTETES, "src/server/auth/essai.ts"],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).toEqual([]);
  });
});
