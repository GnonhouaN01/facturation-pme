import { count, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { env } from "../env";

import { creerAcces, type BaseDeDonnees, type TransactionOrganisation } from "./client";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { temoinIsolation } from "./schema/technique";

// Lancés en local sur dev, ces tests traversent le regroupement de Neon. En
// CI, ils ne prouvent que le comportement de PostgreSQL et du Pool de pg.
// Fiche : docs/features/acces-donnees.md, section 1.2 et décision 5.

let orgs: Organisations;
const pools: Pool[] = [];

function acces(max: number) {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max });
  pools.push(pool);
  return creerAcces(pool);
}

async function lireReglage(tx: TransactionOrganisation): Promise<string | null> {
  const resultat = await tx.execute<{ valeur: string | null }>(
    sql`SELECT current_setting('app.organisation_id', true) AS valeur`,
  );
  return resultat.rows[0]?.valeur ?? null;
}

function lireLignes(tx: TransactionOrganisation) {
  return tx
    .select({ organisationId: temoinIsolation.organisationId })
    .from(temoinIsolation)
    .where(inArray(temoinIsolation.organisationId, [orgs.a, orgs.b]));
}

async function compterSansOrganisation(db: BaseDeDonnees): Promise<number> {
  const [ligne] = await db
    .select({ n: count() })
    .from(temoinIsolation)
    .where(inArray(temoinIsolation.organisationId, [orgs.a, orgs.b]));
  return ligne?.n ?? -1;
}

// Barrière : la promesse renvoyée ne se résout que lorsque `nombre` appels
// ont eu lieu. Prouve le chevauchement sans attente fixe.
function barriere(nombre: number): () => Promise<void> {
  let arrivees = 0;
  let ouvrir: () => void = () => undefined;
  const ouverte = new Promise<void>((resoudre) => {
    ouvrir = resoudre;
  });
  return async () => {
    arrivees += 1;
    if (arrivees === nombre) ouvrir();
    await ouverte;
  };
}

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [temoinIsolation] });
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await orgs?.nettoyer();
});

describe("concurrence", () => {
  test("deux transactions simultanées sur deux organisations ne voient que leurs lignes", async () => {
    const { executerDansOrganisation } = acces(2);
    const attendre = barriere(2);

    const travail = (moi: string) =>
      executerDansOrganisation(moi, async (tx) => {
        const fixe = await lireReglage(tx);
        await attendre();
        const avant = await lireLignes(tx);
        await tx.insert(temoinIsolation).values({ organisationId: moi, valeur: "simultanee" });
        const apres = await lireLignes(tx);
        return { moi, fixe, avant, apres, final: await lireReglage(tx) };
      });

    const resultats = await Promise.all([travail(orgs.a), travail(orgs.b)]);

    for (const r of resultats) {
      expect(r.fixe).toBe(r.moi);
      expect(r.final).toBe(r.moi);
      expect(r.apres).toHaveLength(r.avant.length + 1);
      for (const ligne of [...r.avant, ...r.apres]) {
        expect(ligne.organisationId).toBe(r.moi);
      }
    }
  });

  test("Pool d'une connexion : après une transaction validée, puis annulée, 0 ligne sans organisation", async () => {
    const { db, executerDansOrganisation } = acces(1);

    await executerDansOrganisation(orgs.a, (tx) =>
      tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "validee" }),
    );
    expect(await compterSansOrganisation(db)).toBe(0);

    await expect(
      executerDansOrganisation(orgs.a, async (tx) => {
        await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "annulee" });
        throw new Error("échec voulu");
      }),
    ).rejects.toThrow("échec voulu");
    expect(await compterSansOrganisation(db)).toBe(0);
  });

  test("quarante transactions alternées sur un Pool de trois connexions", async () => {
    const { db, executerDansOrganisation } = acces(3);

    const resultats = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const moi = i % 2 === 0 ? orgs.a : orgs.b;
        return executerDansOrganisation(moi, async (tx) => {
          await tx
            .insert(temoinIsolation)
            .values({ organisationId: moi, valeur: `alternance-${i}` });
          const lignes = await lireLignes(tx);
          return { moi, lignes, reglage: await lireReglage(tx) };
        });
      }),
    );

    for (const r of resultats) {
      expect(r.reglage).toBe(r.moi);
      expect(r.lignes.length).toBeGreaterThan(0);
      for (const ligne of r.lignes) {
        expect(ligne.organisationId).toBe(r.moi);
      }
    }
    expect(await compterSansOrganisation(db)).toBe(0);
  });
});
