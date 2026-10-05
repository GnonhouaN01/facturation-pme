import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { setTimeout as attendre } from "node:timers/promises";

import pg from "pg";

const FICHIER = ".env.local";
const OPTIONS = "sslmode=verify-full&channel_binding=require";
const SERVEUR_PRODUCTION = "ep-spring-frog-b1oeybhv";

function arreter(message) {
  console.error(message);
  process.exit(1);
}

function lirePressePapiers() {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"], {
    encoding: "utf8",
  }).trim();
}

const invite = createInterface({ input: process.stdin, output: process.stdout });
await invite.question(
  "Dans Neon : branche dev, role neondb_owner, pooling desactive, icone de copie. Reviens ici, puis Entree. ",
);
invite.close();

let source;
try {
  source = new URL(lirePressePapiers());
} catch {
  arreter("Le presse-papiers ne contient pas une adresse de connexion.");
}
if (source.username !== "neondb_owner")
  arreter("L'adresse copiee doit etre celle de neondb_owner.");
if (source.hostname.includes("-pooler"))
  arreter("Desactive Connection pooling, recopie, puis relance.");
if (source.hostname.startsWith(SERVEUR_PRODUCTION)) {
  arreter("Cette adresse est celle de la branche production. Choisis la branche dev.");
}

const urlProprietaire = `postgresql://${source.username}:${source.password}@${source.hostname}${source.pathname}?${OPTIONS}`;
const nouveau = randomBytes(24).toString("hex");

const proprietaire = new pg.Client({ connectionString: urlProprietaire });
try {
  await proprietaire.connect();
  await proprietaire.query(`ALTER ROLE app_facturation WITH PASSWORD '${nouveau}'`);
} catch (erreur) {
  arreter(`Connexion du proprietaire refusee : ${erreur.message}`);
} finally {
  await proprietaire.end().catch(() => {});
}

const [premier, ...reste] = source.hostname.split(".");
const hoteGroupe = [`${premier}-pooler`, ...reste].join(".");
const urlApplication = `postgresql://app_facturation:${nouveau}@${hoteGroupe}${source.pathname}?${OPTIONS}`;

let verifie = false;
for (let essai = 1; essai <= 3 && !verifie; essai += 1) {
  const application = new pg.Client({ connectionString: urlApplication });
  try {
    await application.connect();
    const { rows } = await application.query("SELECT current_user AS role");
    verifie = rows[0].role === "app_facturation";
  } catch {
    await attendre(3000);
  } finally {
    await application.end().catch(() => {});
  }
}
if (!verifie)
  arreter("La connexion de l'application n'a pas pu etre verifiee. Rien n'a ete ecrit.");

const contenu = readFileSync(FICHIER, "utf8")
  .replace(/^DATABASE_URL_MIGRATION=.*$/m, () => `DATABASE_URL_MIGRATION="${urlProprietaire}"`)
  .replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL="${urlApplication}"`);
writeFileSync(FICHIER, contenu);

spawnSync("clip", { input: " " });
console.log(`Serveur de la branche dev : ${source.hostname}`);
console.log("Les deux adresses sont inscrites dans .env.local. Presse-papiers vide.");
