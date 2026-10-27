import pg from "pg";
import type { TestProject } from "vitest/node";

// globalSetup du projet Vitest integration : réveille la base une seule fois,
// avant le premier fichier. Neon met le calcul de dev en veille après 5 min
// sans activité (docs/STACK.md) ; sans ce réveil, le premier test de chaque
// fichier lancé en parallèle paie le démarrage à froid, et l'un d'eux pouvait
// dépasser ses 60 s. Fiche : docs/features/acces-donnees.md, section 4.1.

// Attente bornée : une base injoignable fait échouer la suite au bout de ce
// délai, avant tout test, au lieu de faire attendre chaque fichier.
const ATTENTE_TOTALE_MS = 120_000;
const ATTENTE_CONNEXION_MS = 20_000;
const PAUSE_MS = 2_000;

// Message fixe : ni l'hôte, ni l'adresse de connexion, ni le message de pg
// (S-54).
const MESSAGE_ECHEC = "Réveil de la base : aucune réponse dans le délai imparti.";

async function essayer(adresse: string): Promise<boolean> {
  const client = new pg.Client({
    connectionString: adresse,
    connectionTimeoutMillis: ATTENTE_CONNEXION_MS,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export default async function reveillerBase(projet: TestProject): Promise<void> {
  // En local, les variables de .env.local passées par vitest.config.mts ; en
  // CI, celles de l'environnement du job.
  const adresse = projet.config.env.DATABASE_URL ?? process.env.DATABASE_URL;
  // Sans adresse, rien à réveiller : le garde-fou de preparation.ts refusera
  // la suite avec son propre message.
  if (typeof adresse !== "string" || adresse === "") return;

  const debut = Date.now();
  const echeance = debut + ATTENTE_TOTALE_MS;
  while (Date.now() < echeance) {
    if (await essayer(adresse)) {
      console.info(`Réveil de la base : ${Date.now() - debut} ms.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  throw new Error(MESSAGE_ECHEC);
}
