import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { config } from "dotenv";
import pg from "pg";

const FICHIER = ".env.local";
const MOTIF = /^(DATABASE_URL="?postgresql:\/\/app_facturation:)[^@]*(@)/m;

config({ path: FICHIER });

const contenu = readFileSync(FICHIER, "utf8");
if (!MOTIF.test(contenu)) {
  console.error("Ligne DATABASE_URL du role app_facturation introuvable dans .env.local.");
  process.exit(1);
}

const nouveau = randomBytes(24).toString("hex");

const proprietaire = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATION });
await proprietaire.connect();
await proprietaire.query(`ALTER ROLE app_facturation WITH PASSWORD '${nouveau}'`);
await proprietaire.end();

writeFileSync(
  FICHIER,
  contenu.replace(MOTIF, (_, debut, fin) => debut + nouveau + fin),
);

console.log("Mot de passe du role app_facturation renouvele et inscrit dans .env.local.");
