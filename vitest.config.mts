import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { configDefaults, defineConfig } from "vitest/config";

// Variables de .env.local, lues dans un objet séparé : process.env n'est pas
// modifié, et seul le projet integration les reçoit. En CI, le fichier
// n'existe pas : les variables viennent de l'environnement du job.
// Fiche : docs/features/acces-donnees.md, section 4.1.
const variablesLocales = config({ path: ".env.local", processEnv: {}, quiet: true }).parsed ?? {};

const INTEGRATION = "src/**/*.integration.test.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unitaires",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, INTEGRATION],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [INTEGRATION],
          // Garde-fou : refuse toute base non marquée, avant chaque fichier.
          setupFiles: ["src/server/db/outils-test/preparation.ts"],
          env: variablesLocales,
          // Sur dev, chaque requête traverse le réseau jusqu'à Neon : les tests
          // qui en enchaînent plusieurs dizaines dépassent les 5 s par défaut.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
