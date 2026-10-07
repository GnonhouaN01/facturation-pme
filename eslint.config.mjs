import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fichiers de l'application. Les règles d'architecture ne visent que src/ :
// scripts/, drizzle.config.ts et les fichiers de configuration à la racine
// en sont exclus par construction.
const SRC = "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const DB = "src/server/db/**";
const ENV = "src/server/env.ts";
// Exception temporaire : client.ts lit encore process.env tant que
// src/server/env.ts n'existe pas (CLAUDE.md, règle 12). À retirer avec
// la première fonctionnalité, qui crée env.ts.
const CLIENT = "src/server/db/client.ts";

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
  // Imports statiques (A et B).
  {
    files: [SRC],
    ignores: [DB, ENV],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_A, IMPORTS_B) },
  },
  {
    files: [ENV],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_A) },
  },
  {
    files: [DB],
    ignores: [CLIENT],
    rules: { "no-restricted-imports": restreindreImports(IMPORTS_B) },
  },
  // Lecture de process.env (B).
  {
    files: [SRC],
    ignores: [ENV, CLIENT],
    rules: { "no-restricted-properties": ["error", ...PROPRIETES_B] },
  },
  // Syntaxe interdite : imports dynamiques (A et B) et rôle propriétaire (C).
  {
    files: [SRC],
    ignores: [DB, ENV],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_A, ...SYNTAXE_B, ...SYNTAXE_C] },
  },
  {
    files: [ENV],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_A, ...SYNTAXE_C] },
  },
  {
    files: [DB],
    ignores: [CLIENT],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_B, ...SYNTAXE_C] },
  },
  {
    files: [CLIENT],
    rules: { "no-restricted-syntax": ["error", ...SYNTAXE_C] },
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
