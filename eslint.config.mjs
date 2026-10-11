import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fichiers de l'application. Les règles d'architecture ne visent que src/ :
// scripts/, drizzle.config.ts et les fichiers de configuration à la racine
// en sont exclus par construction.
const SRC = "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const DB = "src/server/db/**";
const ENV = "src/server/env.ts";
const TESTS = "src/**/*.test.{ts,tsx}";
const TESTS_DB = "src/server/db/**/*.test.{ts,tsx}";
const OUTILS_TEST = "src/server/db/outils-test/**";
const CONFIG_AUTH = "src/server/auth/config.ts";
const JOURNAL_AUDIT = "src/server/journal/audit.ts";
const CLIENT = "src/server/db/client.ts";
const ISOLATION = "src/server/db/schema/isolation.ts";
const ACTIONS = "src/server/actions/**";
const ACTION = "src/server/actions/action.ts";
const EXPOSER = "src/server/actions/exposer.ts";
const APP_ACTIONS = "src/app/**/actions.ts";

// En configuration plate, une règle déclarée par un bloc postérieur remplace
// entièrement celle d'un bloc antérieur pour un même fichier : les options ne
// se cumulent pas. Les blocs ci-dessous visent donc des ensembles de fichiers
// disjoints, et chacun porte toutes les restrictions qui s'y appliquent.

// Import dynamique import("...") et require("...") d'un module dont le nom
// vérifie l'expression régulière, chaîne ou gabarit sans expression.
const chargementsDynamiques = (modules, message) =>
  [
    `ImportExpression[source.value=${modules}]`,
    `ImportExpression[source.quasis.0.value.raw=${modules}]`,
    `CallExpression[callee.name='require'][arguments.0.value=${modules}]`,
    `CallExpression[callee.name='require'][arguments.0.quasis.0.value.raw=${modules}]`,
  ].map((selector) => ({ selector, message }));

// A. drizzle-orm et pg restent confinés à la couche d'accès aux données.
const MESSAGE_A = "drizzle-orm et pg ne s'importent que dans src/server/db/ (CLAUDE.md, règle 4).";
const IMPORTS_A = {
  paths: [
    { name: "drizzle-orm", message: MESSAGE_A },
    { name: "pg", message: MESSAGE_A },
  ],
  patterns: [{ group: ["drizzle-orm/*"], message: MESSAGE_A }],
};
// / désigne la barre oblique, que esquery n'accepte pas littéralement
// dans une expression régulière.
const SYNTAXE_A = chargementsDynamiques("/^(drizzle-orm|drizzle-orm\\u002F.*|pg)$/", MESSAGE_A);

// B. process.env ne se lit que dans src/server/env.ts, y compris par un
// import du module process.
const MESSAGE_B = "process.env ne se lit que dans src/server/env.ts (CLAUDE.md, règle 12).";
const IMPORTS_B = {
  paths: [
    { name: "process", message: MESSAGE_B },
    { name: "node:process", message: MESSAGE_B },
  ],
};
const PROPRIETES_B = [{ object: "process", property: "env", message: MESSAGE_B }];
const SYNTAXE_B = chargementsDynamiques("/^(node:)?process$/", MESSAGE_B);

// C. Le rôle propriétaire n'apparaît nulle part dans l'application.
const SYNTAXE_C = [
  "Identifier[name='DATABASE_URL_MIGRATION']",
  "Literal[value=/DATABASE_URL_MIGRATION/]",
  "TemplateElement[value.raw=/DATABASE_URL_MIGRATION/]",
  "JSXText[value=/DATABASE_URL_MIGRATION/]",
].map((selector) => ({
  selector,
  message: "L'application n'utilise jamais le rôle propriétaire (CLAUDE.md, règle 2).",
}));

// D. L'outillage de test, qui crée et supprime des organisations, ne
// s'importe que depuis un fichier de test ou depuis son propre dossier.
const MESSAGE_D =
  "src/server/db/outils-test/ ne s'importe que depuis un fichier de test (docs/features/acces-donnees.md, section 4.1).";
const IMPORTS_D = {
  patterns: [{ regex: "(^|/)outils-test(/|$)", message: MESSAGE_D }],
};
const SYNTAXE_D = chargementsDynamiques("/(^|\\u002F)outils-test(\\u002F|$)/", MESSAGE_D);

// E. db n'a pas d'organisation active : hors de Better Auth et de la couche
// d'accès aux données, tout passe par executerDansOrganisation.
const MESSAGE_E =
  "db ne s'importe que dans src/server/auth/config.ts et src/server/db/ : utiliser executerDansOrganisation (docs/features/acces-donnees.md, section 1.3).";
const IMPORTS_E = {
  patterns: [{ regex: "(^|/)db/client$", importNames: ["db"], message: MESSAGE_E }],
};

// F. L'insertion au journal d'audit ne s'importe que depuis la fonction
// d'écriture, qui valide l'entrée. Depuis un autre fichier de requetes/,
// l'import relatif « ./journal » est aussi refusé.
const MESSAGE_F =
  "src/server/db/requetes/journal.ts ne s'importe que depuis src/server/journal/audit.ts : écrire au journal par journaliser (docs/features/journal-audit.md, section 7).";
const IMPORTS_F = {
  patterns: [{ regex: "(^|/)requetes/journal$", message: MESSAGE_F }],
};
const IMPORTS_F_REQUETES = {
  patterns: [{ regex: "^\\./journal$", message: MESSAGE_F }],
};
const SYNTAXE_F = chargementsDynamiques("/(^|\\u002F)requetes\\u002Fjournal$/", MESSAGE_F);

// G. Un fichier qui commence par "use server" n'exporte que
// export const x = exposer(y) : tout autre export serait un point d'entrée
// POST sans la chaîne de contrôles. Les exports de types, effacés à la
// compilation, restent permis.
const MESSAGE_G =
  'Un fichier "use server" n\'exporte que export const x = exposer(y) (docs/features/chaine-controles.md, section 7, règle G).';
const FICHIER_SERVEUR = "Program:has(> ExpressionStatement[directive='use server'])";
const SYNTAXE_G = [
  `${FICHIER_SERVEUR} > ExportDefaultDeclaration`,
  `${FICHIER_SERVEUR} > ExportAllDeclaration`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration:not([declaration])`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > :not(VariableDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration).declaration`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > VariableDeclaration[kind!='const']`,
  `${FICHIER_SERVEUR} > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator:not([init.type='CallExpression'][init.callee.type='Identifier'][init.callee.name='exposer'])`,
].map((selector) => ({ selector, message: MESSAGE_G }));

// H. La directive "use server" n'apparaît qu'en tête de src/app/**/actions.ts :
// pas d'action serveur en ligne dans une fonction, ni de fichier "use server"
// ailleurs.
const MESSAGE_H =
  "La directive \"use server\" n'apparaît qu'en tête de src/app/**/actions.ts (docs/features/chaine-controles.md, section 7, règle H).";
const SYNTAXE_H = [{ selector: "ExpressionStatement[directive='use server']", message: MESSAGE_H }];
const SYNTAXE_H_EN_LIGNE = [
  { selector: "BlockStatement > ExpressionStatement[directive='use server']", message: MESSAGE_H },
];

// I. executerDansOrganisation ne s'importe que dans actions/action.ts, db/ et
// les tests : un service reçoit ctx.tx, il n'ouvre ni n'imbrique de
// transaction. Le chargement dynamique de db/client est refusé en entier.
const MESSAGE_I =
  "executerDansOrganisation ne s'importe que dans src/server/actions/action.ts, src/server/db/ et les tests : un service reçoit ctx.tx (docs/features/chaine-controles.md, section 7, règle I).";
const IMPORTS_I = {
  patterns: [
    { regex: "(^|/)db/client$", importNames: ["executerDansOrganisation"], message: MESSAGE_I },
  ],
};
const SYNTAXE_I = chargementsDynamiques("/(^|\\u002F)db\\u002Fclient$/", MESSAGE_I);

// J. journaliser ne s'importe que dans actions/action.ts et les tests : un
// service écrit au journal par ctx.journaliser, avec l'auteur de la session.
const MESSAGE_J =
  "journaliser ne s'importe que dans src/server/actions/action.ts et les tests : écrire au journal par ctx.journaliser (docs/features/chaine-controles.md, section 7, règle J).";
const IMPORTS_J = {
  patterns: [
    { regex: "(^|/)journal/audit$", importNames: ["journaliser"], message: MESSAGE_J },
    { regex: "^\\./audit$", importNames: ["journaliser"], message: MESSAGE_J },
  ],
};
const SYNTAXE_J = chargementsDynamiques("/((^|\\u002F)journal|^\\.)\\u002Faudit$/", MESSAGE_J);

// K. La chaîne app.organisation_id (littéral ou gabarit) n'apparaît que dans
// db/client.ts, db/schema/isolation.ts et les tests : un set_config vers une
// autre organisation devient visible. Ne voit pas une chaîne construite par
// concaténation (limite acceptée, docs/features/chaine-controles.md).
const MESSAGE_K =
  "app.organisation_id n'apparaît que dans src/server/db/client.ts, src/server/db/schema/isolation.ts et les tests (docs/features/chaine-controles.md, section 7, règle K).";
const SYNTAXE_K = [
  "Literal[value=/app.organisation_id/]",
  "TemplateElement[value.raw=/app.organisation_id/]",
].map((selector) => ({ selector, message: MESSAGE_K }));

// L. Dans src/server/actions/, next/headers ne s'importe que dans exposer.ts :
// la chaîne reste testable sans Next.js.
const MESSAGE_L =
  "Dans src/server/actions/, next/headers ne s'importe que dans exposer.ts (docs/features/chaine-controles.md, section 7, règle L).";
const IMPORTS_L = {
  paths: [
    { name: "next/headers", message: MESSAGE_L },
    { name: "next/headers.js", message: MESSAGE_L },
  ],
};
const SYNTAXE_L = chargementsDynamiques("/^next\\u002Fheaders(\\.js)?$/", MESSAGE_L);

// M. executerChaine ne s'importe que dans actions/exposer.ts et les tests :
// une action ne s'exécute que par une fonction exposée, donc avec une
// déclaration marquée. creerChaine ne s'importe que dans les tests : elle
// construit une chaîne aux dépendances de son choix (session, adhésion
// factices). Le chargement dynamique de actions/action est refusé en entier.
const MESSAGE_M =
  "executerChaine ne s'importe que dans src/server/actions/exposer.ts et les tests : exposer une action par exposer (docs/features/chaine-controles.md, section 7, règle M).";
const MESSAGE_M_FABRIQUE =
  "creerChaine ne s'importe que dans les tests : une chaîne aux dépendances factices contournerait les contrôles (docs/features/chaine-controles.md, section 7, règle M).";
const motifsM = (nom, message) => [
  { regex: "(^|/)actions/action$", importNames: [nom], message },
  { regex: "^\\./action$", importNames: [nom], message },
];
const IMPORTS_M_FABRIQUE = { patterns: motifsM("creerChaine", MESSAGE_M_FABRIQUE) };
const IMPORTS_M = {
  patterns: [...motifsM("executerChaine", MESSAGE_M), ...IMPORTS_M_FABRIQUE.patterns],
};
const SYNTAXE_M = chargementsDynamiques("/((^|\\u002F)actions|^\\.)\\u002Faction$/", MESSAGE_M);

const restreindreImports = (...listes) => [
  "error",
  {
    paths: listes.flatMap((liste) => liste.paths ?? []),
    patterns: listes.flatMap((liste) => liste.patterns ?? []),
  },
];

const restreindreSyntaxe = (...listes) => ["error", ...listes.flat()];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Aucun commentaire (eslint-disable, eslint-enable, /* eslint ... */) ne
  // suspend ni ne modifie une règle dans src/ : une exception passe par ce
  // fichier, donc par une PR (docs/features/chaine-controles.md, section 7).
  {
    files: [SRC],
    linterOptions: { noInlineConfig: true },
  },
  // Imports statiques.
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS, CONFIG_AUTH, JOURNAL_AUDIT, ACTIONS],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [ACTIONS],
    ignores: [TESTS, ACTION, EXPOSER],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_L,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [ACTION],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_L,
      ),
    },
  },
  {
    files: [EXPOSER],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M_FABRIQUE,
      ),
    },
  },
  {
    files: [JOURNAL_AUDIT],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [CONFIG_AUTH],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [TESTS],
    ignores: [DB],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_B, IMPORTS_E) },
  },
  {
    files: [ENV],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
        IMPORTS_I,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [DB],
    ignores: [TESTS, OUTILS_TEST],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_F,
        IMPORTS_F_REQUETES,
        IMPORTS_J,
        IMPORTS_M,
      ),
    },
  },
  {
    files: [TESTS_DB, OUTILS_TEST],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_B) },
  },
  // Lecture de process.env (B).
  {
    files: [SRC],
    ignores: [ENV],
    rules: { "no-restricted-properties": ["error", ...PROPRIETES_B] },
  },
  // Syntaxe interdite.
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS, ACTIONS, APP_ACTIONS],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [APP_ACTIONS],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H_EN_LIGNE,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [ACTIONS],
    ignores: [TESTS, ACTION, EXPOSER],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_L,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [ACTION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_K,
        SYNTAXE_L,
      ),
    },
  },
  {
    files: [EXPOSER],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
      ),
    },
  },
  {
    files: [TESTS],
    ignores: [DB],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_G,
        SYNTAXE_H,
      ),
    },
  },
  {
    files: [ENV],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_A,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_I,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [DB],
    ignores: [TESTS, OUTILS_TEST, CLIENT, ISOLATION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_J,
        SYNTAXE_K,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [CLIENT, ISOLATION],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_D,
        SYNTAXE_F,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_J,
        SYNTAXE_M,
      ),
    },
  },
  {
    files: [OUTILS_TEST],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(
        SYNTAXE_B,
        SYNTAXE_C,
        SYNTAXE_G,
        SYNTAXE_H,
        SYNTAXE_K,
      ),
    },
  },
  {
    files: [TESTS_DB],
    rules: {
      "no-restricted-syntax": restreindreSyntaxe(SYNTAXE_B, SYNTAXE_C, SYNTAXE_G, SYNTAXE_H),
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
