import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fichiers de l'application. Les règles d'architecture ne visent que src/ :
// scripts/, drizzle.config.ts et les fichiers de configuration à la racine
// en sont exclus par construction.
const SRC = "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A. drizzle-orm et pg restent confinés à la couche d'accès aux données.
  {
    files: [SRC],
    ignores: ["src/server/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message:
                "drizzle-orm et pg ne s'importent que dans src/server/db/ (CLAUDE.md, règle 4).",
            },
            {
              name: "pg",
              message:
                "drizzle-orm et pg ne s'importent que dans src/server/db/ (CLAUDE.md, règle 4).",
            },
          ],
          patterns: [
            {
              group: ["drizzle-orm/*"],
              message:
                "drizzle-orm et pg ne s'importent que dans src/server/db/ (CLAUDE.md, règle 4).",
            },
          ],
        },
      ],
    },
  },
  // B. process.env ne se lit que dans src/server/env.ts.
  {
    files: [SRC],
    ignores: [
      "src/server/env.ts",
      // Exception temporaire : client.ts lit encore process.env tant que
      // src/server/env.ts n'existe pas (CLAUDE.md, règle 12). À retirer avec
      // la première fonctionnalité, qui crée env.ts.
      "src/server/db/client.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "process.env ne se lit que dans src/server/env.ts (CLAUDE.md, règle 12).",
        },
      ],
    },
  },
  // C. Le rôle propriétaire n'apparaît nulle part dans l'application.
  {
    files: [SRC],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "Identifier[name='DATABASE_URL_MIGRATION']",
          "Literal[value=/DATABASE_URL_MIGRATION/]",
          "TemplateElement[value.raw=/DATABASE_URL_MIGRATION/]",
          "JSXText[value=/DATABASE_URL_MIGRATION/]",
        ].map((selector) => ({
          selector,
          message: "L'application n'utilise jamais le rôle propriétaire (CLAUDE.md, règle 2).",
        })),
      ],
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
