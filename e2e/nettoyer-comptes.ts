import { config } from "dotenv";
import { Pool } from "pg";

import { ADRESSES_E2E } from "./comptes-e2e";

// Fin de l'exécution de bout en bout (globalTeardown) : suppression des
// comptes créés par les tests de l'inscription ; sessions et comptes de
// connexion suivent par ON DELETE CASCADE. Conditions fixées par le
// développeur (PR 2 de la 1.1), chacune testée (e2e/nettoyer-comptes.spec.ts) :
// - refus si VERCEL_ENV est défini : jamais sur un déploiement ;
// - DATABASE_URL seule, le rôle de l'application, aucune autre variable ;
//   prise dans l'environnement en CI, sinon dans .env.local, lu dans un objet
//   séparé comme vitest.config.mts, rien n'est affiché ;
// - la liste exacte des adresses de l'exécution, toutes en .invalid,
//   comparées par égalité : ni LIKE, ni motif.
// Fiche : docs/features/inscription.md, test 12.

type Source = Readonly<Record<string, string | undefined>>;

export type PoolNettoyage = {
  query: (texte: string, valeurs: unknown[]) => Promise<{ rowCount: number | null }>;
  end: () => Promise<void>;
};

export const REQUETE_NETTOYAGE = 'DELETE FROM "user" WHERE email = ANY($1::text[])';

// Forme exacte d'une adresse de comptes-e2e.ts : aucun caractère de motif,
// domaine .invalid, qui ne reçoit aucun email réel.
const ADRESSE_E2E = /^e2e-[0-9a-f]{8}-\d{1,3}@exemple\.invalid$/;

export async function nettoyer(options: {
  source: Source;
  lireLocales: () => Source;
  adresses: readonly string[];
  ouvrir: (adresse: string) => PoolNettoyage;
}): Promise<number> {
  const { source, adresses } = options;
  if (source.VERCEL_ENV !== undefined) {
    throw new Error("Nettoyage des comptes de bout en bout refusé : VERCEL_ENV est défini.");
  }
  if (adresses.length === 0 || !adresses.every((adresse) => ADRESSE_E2E.test(adresse))) {
    throw new Error("Nettoyage des comptes de bout en bout refusé : liste d'adresses invalide.");
  }
  const base = source.DATABASE_URL ?? options.lireLocales().DATABASE_URL;
  if (!base) throw new Error("Nettoyage des comptes de bout en bout : DATABASE_URL absente.");

  const pool = options.ouvrir(base);
  try {
    const { rowCount } = await pool.query(REQUETE_NETTOYAGE, [[...adresses]]);
    return rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

export default async function nettoyerComptes(): Promise<void> {
  const supprimes = await nettoyer({
    source: process.env,
    lireLocales: () => config({ path: ".env.local", processEnv: {}, quiet: true }).parsed ?? {},
    adresses: ADRESSES_E2E,
    ouvrir: (adresse) => new Pool({ connectionString: adresse, max: 1 }),
  });
  console.log(`Comptes de bout en bout supprimés : ${supprimes}.`);
}
