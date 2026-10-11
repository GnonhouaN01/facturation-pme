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

const CHAINE_ALIAS = `import { executerChaine } from "@/server/actions/action";
export const f = executerChaine;
`;
const CHAINE_RELATIF_SERVICES = `import { executerChaine } from "../actions/action";
export const f = executerChaine;
`;
const CHAINE_LOCAL = `import { executerChaine } from "./action";
export const f = executerChaine;
`;
const CHAINE_ESPACE = `import * as action from "@/server/actions/action";
export const f = action;
`;
const CHAINE_DYNAMIQUE = `export const f = () => import("@/server/actions/action");
`;
const CHAINE_REEXPORT = `export { executerChaine } from "@/server/actions/action";
`;
const DECLARER = `import { declarerAction } from "@/server/actions/action";
export const f = declarerAction;
`;
const ETABLIR_CONTEXTE = `import { etablirContexte } from "@/server/actions/action";
export const f = etablirContexte;
`;

describe(
  "M. executerChaine seulement dans actions/exposer.ts et les tests",
  { timeout: 60_000 },
  () => {
    test.each([
      ["service, par l'alias", CHAINE_ALIAS, "src/server/services/essai.ts"],
      ["service, par un chemin relatif", CHAINE_RELATIF_SERVICES, "src/server/services/essai.ts"],
      ["page de l'application", CHAINE_ALIAS, "src/app/essai/page.tsx"],
      ["fichier actions.ts de l'application", CHAINE_ALIAS, "src/app/essai/actions.ts"],
      ["autre fichier de actions/", CHAINE_LOCAL, "src/server/actions/essai.ts"],
      ["import d'espace de noms", CHAINE_ESPACE, "src/server/services/essai.ts"],
      ["import dynamique depuis un service", CHAINE_DYNAMIQUE, "src/server/services/essai.ts"],
      ["réexportation depuis un service", CHAINE_REEXPORT, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["actions/exposer.ts", CHAINE_LOCAL, "src/server/actions/exposer.ts"],
      ["test de actions/", CHAINE_LOCAL, "src/server/actions/essai.test.ts"],
      ["test d'intégration de db/", CHAINE_ALIAS, "src/server/db/essai.integration.test.ts"],
      ["declarerAction depuis un domaine de actions/", DECLARER, "src/server/actions/clients.ts"],
      ["etablirContexte depuis une page", ETABLIR_CONTEXTE, "src/app/essai/page.tsx"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

const FABRIQUE_ALIAS = `import { creerChaine } from "@/server/actions/action";
export const f = creerChaine;
`;
const FABRIQUE_RELATIF_SERVICES = `import { creerChaine } from "../actions/action";
export const f = creerChaine;
`;
const FABRIQUE_LOCAL = `import { creerChaine } from "./action";
export const f = creerChaine;
`;
const FABRIQUE_REEXPORT = `export { creerChaine } from "@/server/actions/action";
`;
const TYPE_DEPENDANCES = `import type { DependancesChaine } from "@/server/actions/action";
export type D = DependancesChaine;
`;

describe(
  "M. creerChaine seulement dans les tests (une chaîne aux dépendances factices)",
  { timeout: 60_000 },
  () => {
    test.each([
      ["service, par l'alias", FABRIQUE_ALIAS, "src/server/services/essai.ts"],
      ["service, par un chemin relatif", FABRIQUE_RELATIF_SERVICES, "src/server/services/essai.ts"],
      ["page de l'application", FABRIQUE_ALIAS, "src/app/essai/page.tsx"],
      ["fichier actions.ts de l'application", FABRIQUE_ALIAS, "src/app/essai/actions.ts"],
      ["autre fichier de actions/", FABRIQUE_LOCAL, "src/server/actions/essai.ts"],
      ["actions/exposer.ts", FABRIQUE_LOCAL, "src/server/actions/exposer.ts"],
      ["réexportation depuis un service", FABRIQUE_REEXPORT, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["test de actions/", FABRIQUE_LOCAL, "src/server/actions/action.test.ts"],
      ["test d'intégration de db/", FABRIQUE_ALIAS, "src/server/db/essai.integration.test.ts"],
      [
        "type DependancesChaine depuis un service",
        TYPE_DEPENDANCES,
        "src/server/services/essai.ts",
      ],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

// Aucun commentaire ne suspend une règle dans src/ (noInlineConfig) : une
// exception passe par eslint.config.mjs, donc par une PR.
const SUSPENDU_LIGNE_SUIVANTE = `// eslint-disable-next-line no-restricted-imports
import { db } from "@/server/db/client";
export const f = db;
`;
const SUSPENDU_MEME_LIGNE = `import { db } from "@/server/db/client"; // eslint-disable-line no-restricted-imports
export const f = db;
`;
const SUSPENDU_FICHIER = `/* eslint-disable */
import { db } from "@/server/db/client";
export const f = db;
`;
const SUSPENDU_BLOC = `/* eslint-disable no-restricted-imports */
import { db } from "@/server/db/client";
/* eslint-enable no-restricted-imports */
export const f = db;
`;
const REGLE_ETEINTE = `/* eslint no-restricted-imports: "off" */
import { db } from "@/server/db/client";
export const f = db;
`;
const SYNTAXE_SUSPENDUE = `"use server";
// eslint-disable-next-line no-restricted-syntax
export async function agir() {
  return 1;
}
`;
const IMPORT_INTERDIT_SEUL = `import { db } from "@/server/db/client";
export const f = db;
`;

describe("aucun commentaire ne suspend une règle dans src/", { timeout: 60_000 }, () => {
  test.each([
    ["eslint-disable-next-line", SUSPENDU_LIGNE_SUIVANTE, "src/server/services/essai.ts"],
    ["eslint-disable-line", SUSPENDU_MEME_LIGNE, "src/server/services/essai.ts"],
    ["eslint-disable en tête de fichier", SUSPENDU_FICHIER, "src/server/services/essai.ts"],
    ["eslint-disable puis eslint-enable", SUSPENDU_BLOC, "src/server/services/essai.ts"],
    ["règle éteinte par un commentaire", REGLE_ETEINTE, "src/server/services/essai.ts"],
    ["règle G suspendue", SYNTAXE_SUSPENDUE, "src/app/essai/actions.ts"],
    ["dans un fichier de test", SUSPENDU_LIGNE_SUIVANTE, "src/server/services/essai.test.ts"],
  ])("%s : la règle s'applique encore", async (_nom, code, fichier) => {
    expect(await refus(code, fichier)).not.toEqual([]);
  });

  test("témoin : sans commentaire, le même import est refusé une seule fois", async () => {
    expect(await refus(IMPORT_INTERDIT_SEUL, "src/server/services/essai.ts")).toHaveLength(1);
  });
});
// N. Le compteur de débit : compteurDebit ne s'importe que dans db/debit.ts et
// les tests ; db/debit.ts ne s'importe que dans server/debit/ et les tests.
// Fiche : docs/features/limitation-debit.md, section 7.
const COMPTEUR_TABLE = `import { compteurDebit } from "./schema/technique";
export const f = compteurDebit;
`;
const COMPTEUR_TABLE_REQUETES = `import { compteurDebit } from "../schema/technique";
export const f = compteurDebit;
`;
const COMPTEUR_TABLE_ALIAS = `import { compteurDebit } from "@/server/db/schema/technique";
export const f = compteurDebit;
`;
const COMPTEUR_TABLE_ESPACE = `import * as technique from "./schema/technique";
export const f = technique;
`;
const COMPTEUR_TABLE_REEXPORT = `export { compteurDebit } from "./schema/technique";
`;
const AUTRE_TABLE_TECHNIQUE = `import { journalAudit } from "../schema/technique";
export const f = journalAudit;
`;
const COMPTEUR_ALIAS = `import { compteur } from "@/server/db/debit";
export const f = compteur;
`;
const COMPTEUR_RELATIF_ACTIONS = `import { compteur } from "../db/debit";
export const f = compteur;
`;
const COMPTEUR_RELATIF_DEBIT = `import { compteur } from "../db/debit";
export const f = compteur;
`;
const COMPTEUR_RELATIF_REQUETES = `import { compteur } from "../debit";
export const f = compteur;
`;
const COMPTEUR_DYNAMIQUE = `export const f = () => import("@/server/db/debit");
`;
const COMPTEUR_REEXPORT = `export { compteur } from "@/server/db/debit";
`;
const VERIFIER_DEBIT = `import { verifierDebit } from "../debit/debit";
export const f = verifierDebit;
`;

describe(
  "N. compteurDebit seulement dans db/debit.ts ; db/debit.ts seulement dans server/debit/",
  { timeout: 60_000 },
  () => {
    test.each([
      ["compteurDebit dans un autre fichier de db/", COMPTEUR_TABLE, "src/server/db/essai.ts"],
      [
        "compteurDebit dans une requête",
        COMPTEUR_TABLE_REQUETES,
        "src/server/db/requetes/essai.ts",
      ],
      ["compteurDebit dans un service", COMPTEUR_TABLE_ALIAS, "src/server/services/essai.ts"],
      ["schema/technique par espace de noms", COMPTEUR_TABLE_ESPACE, "src/server/db/essai.ts"],
      ["réexportation de compteurDebit", COMPTEUR_TABLE_REEXPORT, "src/server/db/essai.ts"],
      [
        "db/debit.ts dans actions/action.ts",
        COMPTEUR_RELATIF_ACTIONS,
        "src/server/actions/action.ts",
      ],
      ["db/debit.ts dans un service", COMPTEUR_ALIAS, "src/server/services/essai.ts"],
      [
        "db/debit.ts dans une requête",
        COMPTEUR_RELATIF_REQUETES,
        "src/server/db/requetes/essai.ts",
      ],
      ["db/debit.ts dans une page", COMPTEUR_ALIAS, "src/app/essai/page.tsx"],
      ["import dynamique de db/debit.ts", COMPTEUR_DYNAMIQUE, "src/server/services/essai.ts"],
      ["réexportation de db/debit.ts", COMPTEUR_REEXPORT, "src/server/services/essai.ts"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["compteurDebit dans db/debit.ts", COMPTEUR_TABLE, "src/server/db/debit.ts"],
      [
        "compteurDebit dans un test d'intégration de db/",
        COMPTEUR_TABLE,
        "src/server/db/essai.integration.test.ts",
      ],
      [
        "une autre table de schema/technique dans une requête",
        AUTRE_TABLE_TECHNIQUE,
        "src/server/db/requetes/essai.ts",
      ],
      ["db/debit.ts dans server/debit/", COMPTEUR_RELATIF_DEBIT, "src/server/debit/debit.ts"],
      [
        "db/debit.ts dans un test de server/debit/",
        COMPTEUR_RELATIF_DEBIT,
        "src/server/debit/essai.test.ts",
      ],
      ["verifierDebit dans actions/action.ts", VERIFIER_DEBIT, "src/server/actions/action.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refus(code, fichier)).toEqual([]);
    });
  },
);

// B, exception de la 0.6 : src/proxy.ts lit process.env.NODE_ENV, et cette
// seule propriété, pour choisir la politique de développement (décision 11,
// option M2). process.env entier, toute autre variable, et NODE_ENV dans tout
// autre fichier restent refusés. Les messages de no-restricted-properties
// comptent ici, en plus de ceux que retient refus.
// Fiche : docs/features/socle-interface.md, section 5.5.
const REGLES_B = new Set([...REGLES, "no-restricted-properties"]);

async function refusB(code: string, fichier: string): Promise<string[]> {
  const [resultat] = await eslint.lintText(code, { filePath: fichier });
  if (!resultat) throw new Error("ESLint n'a renvoyé aucun résultat.");
  const fatales = resultat.messages.filter((message) => message.fatal);
  expect(fatales, "code de test illisible par ESLint").toEqual([]);
  return resultat.messages
    .filter((message) => message.ruleId !== null && REGLES_B.has(message.ruleId))
    .map((message) => message.message);
}

// Un refus de la règle B cite la règle 12 de CLAUDE.md : un refus venu d'une
// autre règle ne prouve rien sur l'exception.
const REFUS_B = expect.arrayContaining([expect.stringContaining("règle 12")]);

const NODE_ENV_LU = `export const developpement = process.env.NODE_ENV === "development";
`;
const NODE_ENV_DANS_FONCTION = `export function developpement() {
  return process.env.NODE_ENV === "development";
}
`;
const AUTRE_VARIABLE = `export const url = process.env.DATABASE_URL;
`;
const SECRET = `export const secret = process.env.BETTER_AUTH_SECRET;
`;
const ENV_ENTIER = `const variables = process.env;
export const developpement = variables.NODE_ENV === "development";
`;
const ENV_DECOMPOSE = `const { NODE_ENV } = process.env;
export const developpement = NODE_ENV === "development";
`;
const ENV_DECOMPOSE_AUTRE = `const { NODE_ENV, DATABASE_URL } = process.env;
export const valeurs = [NODE_ENV, DATABASE_URL];
`;
const ENV_CROCHETS = `export const developpement = process.env["NODE_ENV"] === "development";
`;
const ENV_CLE_CALCULEE = `const cle = "DATABASE" + "_URL";
export const url = process.env[cle];
`;
const ENV_PASSE = `function lire(source: NodeJS.ProcessEnv) {
  return source.DATABASE_URL;
}
export const url = lire(process.env);
`;
const ENV_COPIE = `export const variables = { ...process.env };
`;
const ENV_IMPORT = `import { env } from "node:process";
export const developpement = env.NODE_ENV === "development";
`;
const ENV_IMPORT_DYNAMIQUE = `export const variables = () => import("node:process");
`;
const ENV_MODULE = `import { env } from "@/server/env";
export const url = env.DATABASE_URL;
`;
const NODE_ENV_ET_AUTRE = `export const developpement = process.env.NODE_ENV === "development";
export const url = process.env.DATABASE_URL;
`;

describe("B. process.env.NODE_ENV dans src/proxy.ts seulement", { timeout: 60_000 }, () => {
  test.each([
    ["NODE_ENV, au niveau du module", NODE_ENV_LU],
    ["NODE_ENV, dans une fonction", NODE_ENV_DANS_FONCTION],
  ])("src/proxy.ts, %s : autorisé", async (_nom, code) => {
    expect(await refusB(code, "src/proxy.ts")).toEqual([]);
  });

  test.each([
    ["DATABASE_URL", AUTRE_VARIABLE],
    ["BETTER_AUTH_SECRET", SECRET],
    ["process.env entier", ENV_ENTIER],
    ["NODE_ENV par décomposition", ENV_DECOMPOSE],
    ["décomposition de plusieurs variables", ENV_DECOMPOSE_AUTRE],
    ["NODE_ENV entre crochets", ENV_CROCHETS],
    ["clé calculée", ENV_CLE_CALCULEE],
    ["process.env passé à une fonction", ENV_PASSE],
    ["copie de process.env", ENV_COPIE],
    ["env importé de node:process", ENV_IMPORT],
    ["import dynamique de node:process", ENV_IMPORT_DYNAMIQUE],
  ])("src/proxy.ts, %s : refusé", async (_nom, code) => {
    expect(await refusB(code, "src/proxy.ts")).toEqual(REFUS_B);
  });

  test("src/proxy.ts, NODE_ENV puis DATABASE_URL : refusé une fois, pour DATABASE_URL", async () => {
    expect(await refusB(NODE_ENV_ET_AUTRE, "src/proxy.ts")).toHaveLength(1);
  });

  test.each([
    ["middleware.ts à la racine de src/", "src/middleware.ts"],
    ["un proxy.ts ailleurs dans src/", "src/app/proxy.ts"],
    ["le test du proxy", "src/proxy.test.ts"],
    ["une page", "src/app/page.tsx"],
    ["un gabarit", "src/app/layout.tsx"],
    ["les en-têtes de sécurité", "src/lib/securite/entetes.ts"],
    ["un composant", "src/components/essai.tsx"],
    ["la chaîne de contrôles", "src/server/actions/action.ts"],
    ["un service", "src/server/services/essai.ts"],
    ["instrumentation.ts", "src/instrumentation.ts"],
  ])("NODE_ENV dans %s : refusé", async (_nom, fichier) => {
    expect(await refusB(NODE_ENV_LU, fichier)).toEqual(REFUS_B);
  });

  test("témoin : process.env reste lisible dans src/server/env.ts", async () => {
    expect(await refusB(AUTRE_VARIABLE, "src/server/env.ts")).toEqual([]);
  });
});

// S. src/proxy.ts n'importe pas server/env.ts : une variable invalide ferait
// échouer chaque requête, page « introuvable » comprise.
// Fiche : docs/features/socle-interface.md, sections 5.5 et 7.
//
// Piège : dans eslint.config.mjs, un second bloc qui règle
// no-restricted-imports (ou no-restricted-syntax) pour src/proxy.ts remplace
// le premier au lieu de s'y ajouter. Les cas « interdictions déjà en
// vigueur » échouent si la règle S, ou l'exception de la règle B, efface
// celles des règles A à O.
const ENV_RELATIF = `import { env } from "./server/env";
export const url = env.DATABASE_URL;
`;
const ENV_RELATIF_TS = `import { env } from "./server/env.ts";
export const url = env.DATABASE_URL;
`;
const ENV_DYNAMIQUE = `export const charger = () => import("@/server/env");
`;
const ENV_REEXPORTE = `export { env } from "@/server/env";
`;

const DEJA_EN_VIGUEUR = [
  ["drizzle-orm (règle A)", `import { sql } from "drizzle-orm";\nexport const s = sql;\n`],
  [
    "un sous-module de drizzle-orm (règle A)",
    `import { pgTable } from "drizzle-orm/pg-core";\nexport const t = pgTable;\n`,
  ],
  ["pg (règle A)", `import { Pool } from "pg";\nexport const p = Pool;\n`],
  [
    "drizzle-orm par chargement dynamique (règle A)",
    `export const charger = () => import("drizzle-orm");\n`,
  ],
  ["le module process (règle B)", `import process from "process";\nexport const p = process;\n`],
  ["db (règle D)", `import { db } from "@/server/db/client";\nexport const d = db;\n`],
  [
    "l'outillage de test",
    `import { nettoyer } from "@/server/db/outils-test/organisations";\nexport const n = nettoyer;\n`,
  ],
  [
    "requetes/journal",
    `import * as journal from "@/server/db/requetes/journal";\nexport const j = journal;\n`,
  ],
  [
    "executerDansOrganisation (règle I)",
    `import { executerDansOrganisation } from "@/server/db/client";\nexport const e = executerDansOrganisation;\n`,
  ],
  [
    "journaliser (règle J)",
    `import { journaliser } from "@/server/journal/audit";\nexport const j = journaliser;\n`,
  ],
  [
    "executerChaine (règle M)",
    `import { executerChaine } from "@/server/actions/action";\nexport const e = executerChaine;\n`,
  ],
  [
    "creerChaine (règle M)",
    `import { creerChaine } from "@/server/actions/action";\nexport const c = creerChaine;\n`,
  ],
  [
    "compteurDebit (règle N)",
    `import { compteurDebit } from "@/server/db/schema/technique";\nexport const c = compteurDebit;\n`,
  ],
  ["db/debit (règle N)", `import * as debit from "@/server/db/debit";\nexport const d = debit;\n`],
  ["next/script (règle O)", `import Script from "next/script";\nexport const s = Script;\n`],
  [
    "next/script par chargement dynamique (règle O)",
    `export const charger = () => import("next/script");\n`,
  ],
] as const;

const TEMOIN_PROXY = `import { NextResponse, type NextRequest } from "next/server";
import { politiqueSecurite } from "@/lib/securite/entetes";
export function proxy(requete: NextRequest) {
  return NextResponse.next({ request: requete, headers: { x: politiqueSecurite.name } });
}
`;

describe("S. src/proxy.ts n'importe pas server/env.ts", { timeout: 60_000 }, () => {
  test.each([
    ["import de @/server/env", ENV_MODULE],
    ["import relatif de ./server/env", ENV_RELATIF],
    ["import relatif de ./server/env.ts", ENV_RELATIF_TS],
    ["chargement dynamique de @/server/env", ENV_DYNAMIQUE],
    ["réexportation de @/server/env", ENV_REEXPORTE],
  ])("src/proxy.ts, %s : refusé", async (_nom, code) => {
    expect(await refusB(code, "src/proxy.ts")).not.toEqual([]);
  });

  test.each(DEJA_EN_VIGUEUR)(
    "src/proxy.ts, interdiction déjà en vigueur, %s : toujours refusé",
    async (_nom, code) => {
      expect(await refusB(code, "src/proxy.ts")).not.toEqual([]);
    },
  );

  test("témoin : src/proxy.ts importe next/server et les en-têtes de sécurité", async () => {
    expect(await refusB(TEMOIN_PROXY, "src/proxy.ts")).toEqual([]);
  });

  test("témoin : server/env.ts reste importable ailleurs dans src/server/", async () => {
    expect(await refusB(ENV_MODULE, "src/server/services/essai.ts")).toEqual([]);
  });
});
