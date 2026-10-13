import { config } from "dotenv";
import { Pool } from "pg";

import { MOTIF_COMPTES_E2E } from "./comptes-e2e";

// Fin de l'exécution de bout en bout : suppression des comptes créés par les
// tests de l'inscription (adresses e2e-<exécution>-<n>@exemple.invalid) ;
// sessions et comptes de connexion suivent par ON DELETE CASCADE. Même rôle
// que le serveur (app_facturation). DATABASE_URL vient de l'environnement en
// CI, sinon de .env.local, lu dans un objet séparé comme vitest.config.mts :
// rien n'est affiché. Fiche : docs/features/inscription.md, test 12.
export default async function nettoyerComptes(): Promise<void> {
  const locales = config({ path: ".env.local", processEnv: {}, quiet: true }).parsed ?? {};
  const adresse = process.env.DATABASE_URL ?? locales.DATABASE_URL;
  if (!adresse) throw new Error("Nettoyage des comptes de bout en bout : DATABASE_URL absente.");

  const pool = new Pool({ connectionString: adresse, max: 1 });
  try {
    const { rowCount } = await pool.query('DELETE FROM "user" WHERE email LIKE $1', [
      MOTIF_COMPTES_E2E,
    ]);
    console.log(`Comptes de bout en bout supprimés : ${rowCount ?? 0}.`);
  } finally {
    await pool.end();
  }
}
