import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as attendre } from "node:timers/promises";

import { config } from "dotenv";
import pg from "pg";
import { createInterface } from "node:readline/promises";

config({ path: ".env.local", quiet: true });

function arreter(message) {
  console.error(message);
  process.exit(1);
}

function lirePressePapiers() {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"], {
    encoding: "utf8",
  }).trim();
}

function ecrirePressePapiers(texte) {
  const resultat = spawnSync("clip", { input: texte });
  if (resultat.status !== 0) arreter("Ecriture dans le presse-papiers impossible.");
}

const invite = createInterface({ input: process.stdin, output: process.stdout });
await invite.question(
  "Copie l adresse dans Neon avec l icone de copie, reviens ici, puis appuie sur Entree. ",
);
invite.close();

let source;
try {
  source = new URL(lirePressePapiers());
} catch {
  arreter(
    "Le presse-papiers ne contient pas une adresse de connexion. Copie-la dans Neon, puis relance.",
  );
}

if (!source.protocol.startsWith("postgres")) {
  arreter("Le presse-papiers ne contient pas une adresse PostgreSQL.");
}
if (source.username !== "neondb_owner") {
  arreter("L'adresse copiee doit etre celle du role neondb_owner.");
}
if (source.hostname.includes("-pooler")) {
  arreter("Desactive Connection pooling dans Neon, recopie l'adresse, puis relance.");
}

const hoteDev = process.env.DATABASE_URL_MIGRATION
  ? new URL(process.env.DATABASE_URL_MIGRATION).hostname
  : "";
if (source.hostname === hoteDev) {
  arreter("Cette adresse est celle de la branche dev. Choisis une autre branche dans Neon.");
}

const options = "sslmode=verify-full&channel_binding=require";
const urlProprietaire = `postgresql://${source.username}:${source.password}@${source.hostname}${source.pathname}?${options}`;

const nouveau = randomBytes(24).toString("hex");
const proprietaire = new pg.Client({ connectionString: urlProprietaire });
await proprietaire.connect();
await proprietaire.query(`ALTER ROLE app_facturation WITH PASSWORD '${nouveau}'`);
await proprietaire.end();

const [premier, ...reste] = source.hostname.split(".");
const hoteGroupe = [`${premier}-pooler`, ...reste].join(".");
const urlApplication = `postgresql://app_facturation:${nouveau}@${hoteGroupe}${source.pathname}?${options}`;

let verifie = false;
for (let essai = 1; essai <= 3 && !verifie; essai += 1) {
  const application = new pg.Client({ connectionString: urlApplication });
  try {
    await application.connect();
    const { rows } = await application.query(
      "SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS contourne_rls",
    );
    verifie = rows[0].role === "app_facturation" && rows[0].contourne_rls === false;
  } catch {
    await attendre(3000);
  } finally {
    await application.end().catch(() => {});
  }
}
if (!verifie)
  arreter("Le mot de passe a ete renouvele, mais la verification de connexion a echoue.");

ecrirePressePapiers(urlApplication);
if (lirePressePapiers() !== urlApplication)
  arreter("Le presse-papiers est reste inchange. Relance le script.");
console.log(`Contenu du presse-papiers : ${urlApplication.replace(nouveau, "****")}`);

console.log(`Branche visee : ${source.hostname}`);
console.log("Mot de passe de app_facturation renouvele, connexion verifiee.");
console.log("L'adresse de l'application est dans le presse-papiers : colle-la dans Vercel.");
