import { count, inArray } from "drizzle-orm";
import { describe, expect, onTestFinished, test } from "vitest";

import { db, executerDansOrganisation } from "../client";
import { organization } from "../schema/auth";
import { temoinIsolation } from "../schema/technique";

import { verifierBaseDeTest } from "./garde-base";
import { creerDeuxOrganisations } from "./organisations";

// Fiche : docs/features/acces-donnees.md, sections 4.2 et 5.

async function organisationsRestantes(ids: string[]): Promise<number> {
  const [ligne] = await db
    .select({ n: count() })
    .from(organization)
    .where(inArray(organization.id, ids));
  return ligne?.n ?? -1;
}

// Lignes de temoin_isolation d'une organisation, lues dans son contexte : la
// règle les rend invisibles sans organisation active.
async function lignesTemoin(organisationId: string): Promise<number> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx
      .select({ n: count() })
      .from(temoinIsolation)
      .where(inArray(temoinIsolation.organisationId, [organisationId])),
  );
  return ligne?.n ?? -1;
}

async function ajouterLigne(organisationId: string, valeur: string): Promise<void> {
  await executerDansOrganisation(organisationId, (tx) =>
    tx.insert(temoinIsolation).values({ organisationId, valeur }),
  );
}

describe("creerDeuxOrganisations", () => {
  test("deux appels donnent quatre identifiants distincts, slugs préfixés par test-", async () => {
    const premier = await creerDeuxOrganisations({ tables: [temoinIsolation] });
    onTestFinished(premier.nettoyer);
    const second = await creerDeuxOrganisations({ tables: [temoinIsolation] });
    onTestFinished(second.nettoyer);
    const ids = [premier.a, premier.b, second.a, second.b];

    expect(new Set(ids).size).toBe(4);
    const lignes = await db
      .select({ slug: organization.slug })
      .from(organization)
      .where(inArray(organization.id, ids));
    expect(lignes).toHaveLength(4);
    for (const { slug } of lignes) {
      expect(slug.startsWith("test-")).toBe(true);
    }
  });

  test("après nettoyer, les organisations et leurs lignes ont disparu", async () => {
    const { a, b, nettoyer } = await creerDeuxOrganisations({ tables: [temoinIsolation] });
    onTestFinished(nettoyer);
    await ajouterLigne(a, "nettoyage");
    await ajouterLigne(b, "nettoyage");

    await nettoyer();

    expect(await organisationsRestantes([a, b])).toBe(0);
    expect(await lignesTemoin(a)).toBe(0);
    expect(await lignesTemoin(b)).toBe(0);
  });

  test("nettoyer appelé deux fois ne lève pas d'erreur", async () => {
    const { nettoyer } = await creerDeuxOrganisations({ tables: [temoinIsolation] });

    await nettoyer();
    await expect(nettoyer()).resolves.toBeUndefined();
  });
});

describe("un test en échec nettoie quand même", () => {
  let laissees: string[] = [];

  // Ce test doit échouer : test.fails le compte comme réussi s'il échoue.
  test.fails("crée des organisations et des lignes, puis échoue", async () => {
    const { a, b, nettoyer } = await creerDeuxOrganisations({ tables: [temoinIsolation] });
    onTestFinished(nettoyer);
    laissees = [a, b];
    await ajouterLigne(a, "echec");
    await ajouterLigne(b, "echec");

    throw new Error("échec voulu");
  });

  test("les organisations du test en échec ont disparu", async () => {
    expect(laissees).toHaveLength(2);
    expect(await organisationsRestantes(laissees)).toBe(0);
  });
});

describe("garde-fou", () => {
  test("accepte la base marquée (CI ou dev)", async () => {
    await expect(verifierBaseDeTest()).resolves.toBeUndefined();
  });
});
