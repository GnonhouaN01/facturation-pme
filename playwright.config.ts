import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import { ADRESSES_E2E } from "./e2e/comptes-e2e";
import { DOSSIER_JOURNAUX, preparerJournaux } from "./e2e/journaux";
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

// Inscription (1.1). Have I Been Pwned : chaque serveur précharge
// e2e/simuler-hibp.mjs, qui répond à la place du service ; aucun appel réel.
// Adresses : la porte d'envoi ne remet qu'aux adresses autorisées, tirées
// pour cette exécution (e2e/comptes-e2e.ts). Fiche :
// docs/features/inscription.md, sections 5.2 et « Tests à écrire ».
const PRECHARGEMENT_HIBP = `--import=${pathToFileURL(resolve("e2e/simuler-hibp.mjs")).href}`;
const INSCRIPTION_E2E = {
  NODE_OPTIONS: [process.env.NODE_OPTIONS, PRECHARGEMENT_HIBP].filter(Boolean).join(" "),
  EMAIL_DESTINATAIRES_AUTORISES: ADRESSES_E2E.join(","),
};

// Sortie des deux serveurs, conservée à chaque exécution dans .e2e-journaux/
// (ignoré par git), pour expliquer après coup une réponse 500 ; celle du
// serveur en panne est relue par le test T-39 (e2e/erreurs.attaque.spec.ts).
// Chemins tirés par le premier processus et partagés comme CRON_SECRET_E2E.
// Fiches : docs/features/e2e-base-jetable.md, section 4 ;
// docs/features/inscription.md, section 1.3, test 2.
if (!process.env.JOURNAL_SITE_E2E || !process.env.JOURNAL_PANNE_E2E) {
  const journaux = preparerJournaux({ dossier: resolve(DOSSIER_JOURNAUX) });
  process.env.JOURNAL_SITE_E2E = journaux.site;
  process.env.JOURNAL_PANNE_E2E = journaux.panne;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // Comptes créés par les tests de l'inscription, supprimés à la fin.
  globalTeardown: "./e2e/nettoyer-comptes.ts",
  use: {
    baseURL: ADRESSE,
    trace: "on-first-retry",
  },
  // Deux largeurs (NF-03, NF-04), décision 31. L'affichage (accueil,
  // affichage) et le parcours d'inscription (1.1) tournent dans les deux ; les en-têtes et les attaques, qui ne
  // dépendent pas de la largeur, dans ordinateur-1280 seul ; 360 px
  // (affichage-360) dans mobile-390 seul. Aucun test sauté. Fiche : section 12.
  projects: [
    {
      name: "mobile-390",
      testMatch: [
        /(^|\W)accueil\.spec\.ts$/,
        /(^|\W)affichage(-360)?\.spec\.ts$/,
        /(^|\W)inscription\.spec\.ts$/,
        // 1.2 : connexion et gabarit connecté, aux deux largeurs
        // (docs/features/connexion.md, tests 19 et 24).
        /(^|\W)connexion\.spec\.ts$/,
        /(^|\W)affichage-connecte\.spec\.ts$/,
      ],
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
      // next start sur le port 3000, sortie écrite dans JOURNAL_SITE_E2E,
      // sortie d'erreur aussi affichée dans le terminal.
      command: `node e2e/lancer-serveur.mjs 3000 "${process.env.JOURNAL_SITE_E2E}" --recopier-erreurs`,
      url: ADRESSE,
      reuseExistingServer: false,
      timeout: 120_000,
      // BETTER_AUTH_URL imposée : l'origine acceptée par /api/auth est celle
      // des tests, quelle que soit la valeur de .env.local.
      env: { ...EMAILS_E2E, ...TACHE_E2E, ...INSCRIPTION_E2E, BETTER_AUTH_URL: ADRESSE },
    },
    // Second serveur : configuration valide, base injoignable (section 4.3,
    // décision 17). Les variables passées ici l'emportent sur .env.local et
    // sur l'environnement du job de CI.
    {
      // Sortie écrite dans JOURNAL_PANNE_E2E (test T-39).
      command: `node e2e/lancer-serveur.mjs ${PORT_PANNE} "${process.env.JOURNAL_PANNE_E2E}"`,
      url: ADRESSE_PANNE,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...CONFIGURATION_PANNE, ...EMAILS_E2E, ...INSCRIPTION_E2E },
    },
  ],
});
