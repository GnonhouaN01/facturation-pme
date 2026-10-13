import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createRequire } from "node:module";

// Lanceur du serveur en panne (port 3101, base injoignable) : next start,
// sortie standard et sortie d'erreur écrites dans un fichier, que le test
// T-39 relit (e2e/erreurs.attaque.spec.ts) pour vérifier qu'aucun jeton,
// aucune adresse ni aucune requête SQL n'y figure. Chemin du fichier et port
// passés par playwright.config.ts. Fiche : docs/features/inscription.md,
// section 1.3, test 2.
//
//   node e2e/lancer-serveur-panne.mjs <port> <fichier du journal>

const [port, journal] = process.argv.slice(2);
if (!port || !journal) {
  console.error("Usage : node e2e/lancer-serveur-panne.mjs <port> <fichier>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const sortie = openSync(journal, "w");

const serveur = spawn(process.execPath, [next, "start", "-p", port], {
  stdio: ["ignore", sortie, sortie],
  env: process.env,
});

serveur.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => serveur.kill(signal));
}
