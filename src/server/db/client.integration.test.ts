import { randomUUID } from "node:crypto";

import { count, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { env } from "../env";

import {
  creerAcces,
  executerDansOrganisation,
  type BaseDeDonnees,
  type TransactionOrganisation,
} from "./client";
import { codeDuRefus } from "./outils-test/isolation";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { temoinIsolation } from "./schema/technique";

// Fiche : docs/features/acces-donnees.md, sections 1.1 à 1.3.

let orgs: Organisations;
const pools: Pool[] = [];

// Pool dédié : max = 1 garantit que deux requêtes successives passent par la
// même connexion du côté de l'application.
function poolDedie(max: number): Pool {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max });
  pools.push(pool);
  return pool;
}

async function lireReglage(x: BaseDeDonnees | TransactionOrganisation): Promise<string | null> {
  const resultat = await x.execute<{ valeur: string | null }>(
    sql`SELECT current_setting('app.organisation_id', true) AS valeur`,
  );
  return resultat.rows[0]?.valeur ?? null;
}

async function compter(x: BaseDeDonnees | TransactionOrganisation): Promise<number> {
  const [ligne] = await x
    .select({ n: count() })
    .from(temoinIsolation)
    .where(inArray(temoinIsolation.organisationId, [orgs.a, orgs.b]));
  return ligne?.n ?? -1;
}

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [temoinIsolation] });
  for (const organisationId of [orgs.a, orgs.b]) {
    await executerDansOrganisation(organisationId, (tx) =>
      tx.insert(temoinIsolation).values({ organisationId, valeur: "client" }),
    );
  }
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await orgs?.nettoyer();
});

describe("executerDansOrganisation", () => {
  test("fixe l'organisation active dans la transaction", async () => {
    const valeur = await executerDansOrganisation(orgs.a, (tx) => lireReglage(tx));

    expect(valeur).toBe(orgs.a);
  });

  test("renvoie la valeur renvoyée par travail", async () => {
    const objet = { marque: randomUUID() };

    await expect(executerDansOrganisation(orgs.a, async () => objet)).resolves.toBe(objet);
  });

  test("une exception dans travail annule les écritures et remonte telle quelle", async () => {
    const erreur = new Error("échec voulu");
    const valeur = `annulee-${randomUUID()}`;

    const promesse = executerDansOrganisation(orgs.a, async (tx) => {
      await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur });
      throw erreur;
    });

    await expect(promesse).rejects.toBe(erreur);
    const lignes = await executerDansOrganisation(orgs.a, (tx) =>
      tx.select().from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
    );
    expect(lignes).toEqual([]);
  });

  test("après une transaction réussie, la connexion n'a plus d'organisation active", async () => {
    const acces = creerAcces(poolDedie(1));

    await acces.executerDansOrganisation(orgs.a, async () => undefined);

    expect(["", null]).toContain(await lireReglage(acces.db));
  });

  test("après une transaction annulée, la connexion n'a plus d'organisation active", async () => {
    const acces = creerAcces(poolDedie(1));

    await expect(
      acces.executerDansOrganisation(orgs.a, async () => {
        throw new Error("échec voulu");
      }),
    ).rejects.toThrow("échec voulu");

    expect(["", null]).toContain(await lireReglage(acces.db));
  });
});

describe("sans organisation fixée", () => {
  test("connexion neuve : lecture = 0 ligne, sans erreur", async () => {
    const acces = creerAcces(poolDedie(1));

    await expect(compter(acces.db)).resolves.toBe(0);
  });

  test("après une transaction : lecture = 0 ligne, sans erreur", async () => {
    const acces = creerAcces(poolDedie(1));
    await acces.executerDansOrganisation(orgs.a, async () => undefined);

    await expect(compter(acces.db)).resolves.toBe(0);
  });

  // Avec le regroupement de Neon, la requête qui suit une transaction peut
  // partir sur une autre connexion du serveur : l'état « réglage vide » n'y est
  // pas garanti. On le fixe donc explicitement, dans une transaction brute.
  test("réglage vide : lecture = 0 ligne, sans erreur de conversion", async () => {
    const acces = creerAcces(poolDedie(1));

    const n = await acces.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', '', true)`);
      expect(await lireReglage(tx)).toBe("");
      return compter(tx);
    });

    expect(n).toBe(0);
  });

  test("réglage vide : insertion refusée par 42501, pas 22P02", async () => {
    const acces = creerAcces(poolDedie(1));

    const code = await codeDuRefus(
      acces.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.organisation_id', '', true)`);
        await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "vide" });
      }),
    );

    expect(code).toBe("42501");
  });

  test("connexion neuve : insertion refusée par 42501, pas 22P02", async () => {
    const acces = creerAcces(poolDedie(1));

    const code = await codeDuRefus(
      acces.db.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "sans" }),
    );

    expect(code).toBe("42501");
  });

  test("après une transaction (réglage vide) : insertion refusée par 42501, pas 22P02", async () => {
    const acces = creerAcces(poolDedie(1));
    await acces.executerDansOrganisation(orgs.a, async () => undefined);

    const code = await codeDuRefus(
      acces.db.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "sans" }),
    );

    expect(code).toBe("42501");
  });
});
