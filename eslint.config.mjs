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

const restreindreImports = (...listes) => [
  "error",
  {
    paths: listes.flatMap((liste) => liste.paths ?? []),
    patterns: listes.flatMap((liste) => liste.patterns ?? []),
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Imports statiques (A, B, D, E et F).
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS, CONFIG_AUTH, JOURNAL_AUDIT],
    rules: {
      "no-restricted-imports": restreindreImports(
        IMPORTS_A,
        IMPORTS_B,
        IMPORTS_D,
        IMPORTS_E,
        IMPORTS_F,
      ),
    },
  },
  {
    files: [JOURNAL_AUDIT],
    rules: {
      "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_B, IMPORTS_D, IMPORTS_E),
    },
  },
  {
    files: [CONFIG_AUTH],
    rules: {
      "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_B, IMPORTS_D, IMPORTS_F),
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
      "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_D, IMPORTS_E, IMPORTS_F),
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
  // Syntaxe interdite : imports dynamiques (A, B, D et F) et rôle
  // propriétaire (C).
  {
    files: [SRC],
    ignores: [DB, ENV, TESTS],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...SYNTAXE_A,
        ...SYNTAXE_B,
        ...SYNTAXE_C,
        ...SYNTAXE_D,
        ...SYNTAXE_F,
      ],
    },
  },
  {
    files: [TESTS],
    ignores: [DB],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_A, ...SYNTAXE_B, ...SYNTAXE_C] },
  },
  {
    files: [ENV],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_A, ...SYNTAXE_C, ...SYNTAXE_D] },
  },
  {
    files: [DB],
    ignores: [TESTS, OUTILS_TEST],
    rules: {
      "no-restricted-syntax": ["error", ...SYNTAXE_B, ...SYNTAXE_C, ...SYNTAXE_D, ...SYNTAXE_F],
    },
  },
  {
    files: [TESTS_DB, OUTILS_TEST],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_B, ...SYNTAXE_C] },
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
