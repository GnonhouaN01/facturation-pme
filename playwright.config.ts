import { defineConfig, devices } from "@playwright/test";

// Les tests tournent sur le site construit, en CI comme en local : lancer
// npm run build avant. Les en-têtes de next dev diffèrent (politique de
// développement). Aucun serveur existant n'est réutilisé : un next dev
// oublié sur le port 3000 ferait passer ou échouer les tests pour une autre
// raison. Fiche : docs/features/socle-interface.md, section 6.
const ADRESSE = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: ADRESSE,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: ADRESSE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
