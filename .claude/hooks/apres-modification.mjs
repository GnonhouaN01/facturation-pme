import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

let entree = "";
for await (const morceau of process.stdin) entree += morceau;

let chemin;
try {
  chemin = JSON.parse(entree).tool_input?.file_path;
} catch {
  process.exit(0);
}

const formatable = /\.(ts|tsx|mts|mjs|js|jsx|json|css)$/;
const ignore = /[\\/](drizzle|docs|node_modules|\.next|\.claude)[\\/]/;
if (!chemin || !existsSync(chemin) || !formatable.test(chemin) || ignore.test(chemin)) {
  process.exit(0);
}

try {
  execSync(`npx prettier --write "${chemin}"`, { stdio: "pipe" });
  if (/\.(ts|tsx|mts)$/.test(chemin)) {
    execSync(`npx eslint "${chemin}"`, { stdio: "pipe" });
  }
} catch (erreur) {
  process.stderr.write(`Controle automatique en echec sur ${chemin}\n`);
  process.stderr.write(String(erreur.stdout ?? "") + String(erreur.stderr ?? ""));
  process.exit(2);
}
