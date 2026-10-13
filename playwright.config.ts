import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { ADRESSE_PANNE, CONFIGURATION_PANNE, PORT_PANNE } from "./e2e/serveur-panne";

// Les tests tournent sur le site construit, en CI comme en local : lancer
// npm run build avant. Les en-têtes de next dev diffèrent (politique de
// développement). Aucun serveur existant n'est réutilisé : un next dev
// oublié sur le port 3000 ferait passer ou échouer les tests pour une autre
// raison. Fiche : docs/features/socle-interface.md, section 6.
const ADRESSE = "http://localhost:3000";

// next start charge .env.local (NODE_ENV=production). Chaque serveur impose
// le transport fichier, dans un dossier propre aux tests : aucun ne peut
// envoyer un vrai email, même si une variable d'envoi se trouvait par erreur
// dans .env.local. Les variables passées par env l'emportent. Fiche :
// docs/features/envoi-emails.md, section 2.1.
const EMAILS_E2E = {
  EMAIL_TRANSPORT: "fichier",
  EMAIL_DOSSIER: join(tmpdir(), "facturation-pme-e2e-emails"),
};

// Secret de la tâche quotidienne pour le serveur du port 3000 : tiré au
// hasard à chaque exécution, jamais écrit. Ce fichier est relu par chaque
// processus de Playwright : la valeur tirée par le premier est posée dans
// l'environnement, dont héritent les suivants, pour que tous partagent la
// même. Le serveur en panne (port 3101) n'en reçoit pas : la tâche y refuse
// tout appel. Fiche : docs/features/tache-quotidienne.md, test 9.
process.env.CRON_SECRET_E2E ??= randomBytes(32).toString("base64url");
const TACHE_E2E = { CRON_SECRET: process.env.CRON_SECRET_E2E };

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
  // Deux largeurs (NF-03, NF-04), décision 31. L'affichage (accueil,
  // affichage) tourne dans les deux ; les en-têtes et les attaques, qui ne
  // dépendent pas de la largeur, dans ordinateur-1280 seul ; 360 px
  // (affichage-360) dans mobile-390 seul. Aucun test sauté. Fiche : section 12.
  projects: [
    {
      name: "mobile-390",
      testMatch: [/(^|\W)accueil\.spec\.ts$/, /(^|\W)affichage(-360)?\.spec\.ts$/],
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "ordinateur-1280",
      testIgnore: [/(^|\W)affichage-360\.spec\.ts$/],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: "npm run start",
      url: ADRESSE,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...EMAILS_E2E, ...TACHE_E2E },
    },
    // Second serveur : configuration valide, base injoignable (section 4.3,
    // décision 17). Les variables passées ici l'emportent sur .env.local et
    // sur l'environnement du job de CI.
    {
      command: `npm run start -- -p ${PORT_PANNE}`,
      url: ADRESSE_PANNE,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...CONFIGURATION_PANNE, ...EMAILS_E2E },
    },
  ],
});
