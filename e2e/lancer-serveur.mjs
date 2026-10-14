import { spawn } from "node:child_process";
import { openSync, writeSync } from "node:fs";
import { createRequire } from "node:module";

// Lanceur des deux serveurs de bout en bout : next start, sortie standard et
// sortie d'erreur écrites dans un fichier de .e2e-journaux/, conservé pour
// expliquer après coup une réponse 500 (docs/features/e2e-base-jetable.md,
// section 4). Le test T-39 relit celui du serveur en panne
// (e2e/erreurs.attaque.spec.ts) pour vérifier qu'aucun jeton, aucune adresse
// ni aucune requête SQL n'y figure (docs/features/inscription.md,
// section 1.3, test 2). Avec --recopier-erreurs, la sortie d'erreur est aussi
// affichée dans le terminal, comme une commande directe de Playwright. Port
// et chemin passés par playwright.config.ts.
//
//   node e2e/lancer-serveur.mjs <port> <fichier du journal> [--recopier-erreurs]

const [port, journal, option] = process.argv.slice(2);
if (!port || !journal || (option !== undefined && option !== "--recopier-erreurs")) {
  console.error("Usage : node e2e/lancer-serveur.mjs <port> <fichier> [--recopier-erreurs]");
  process.exit(2);
}
const recopier = option === "--recopier-erreurs";

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const fichier = openSync(journal, "w");

const serveur = spawn(process.execPath, [next, "start", "-p", port], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

// Écriture immédiate : le test T-39 lit le fichier pendant l'exécution.
serveur.stdout.on("data", (morceau) => writeSync(fichier, morceau));
serveur.stderr.on("data", (morceau) => {
  writeSync(fichier, morceau);
  if (recopier) process.stderr.write(morceau);
});

serveur.on("close", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => serveur.kill(signal));
}
