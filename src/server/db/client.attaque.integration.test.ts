import { count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, executerDansOrganisation, OrganisationActiveInvalide } from "./client";
import { codeDuRefus } from "./outils-test/isolation";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { temoinIsolation } from "./schema/technique";

// Tests d'attaque des menaces T-30 et T-53, et injection par l'identifiant.
// Fiche : docs/features/acces-donnees.md, « Tests d'attaque ».

let orgs: Organisations;
let ligneA: string;
let ligneB: string;

async function inserer(organisationId: string, valeur: string): Promise<string> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx
      .insert(temoinIsolation)
      .values({ organisationId, valeur })
      .returning({ id: temoinIsolation.id }),
  );
  if (!ligne) throw new Error("insertion sans ligne renvoyée");
  return ligne.id;
}

async function relire(organisationId: string, id: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx.select().from(temoinIsolation).where(eq(temoinIsolation.id, id)),
  );
}

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [temoinIsolation] });
  ligneA = await inserer(orgs.a, "ligne de A");
  ligneB = await inserer(orgs.b, "ligne de B");
});

afterAll(async () => {
  await orgs?.nettoyer();
});

describe("T-30 : l'organisation A n'atteint pas les lignes de B", () => {
  test("lecture filtrée sur l'identifiant d'une ligne de B : aucune ligne", async () => {
    const lignes = await relire(orgs.a, ligneB);

    expect(lignes).toEqual([]);
  });

  test("insertion d'une ligne pour B : refus 42501", async () => {
    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx.insert(temoinIsolation).values({ organisationId: orgs.b, valeur: "intrusion" }),
      ),
    );

    expect(code).toBe("42501");
  });

  test("modification des lignes de B : 0 ligne, la ligne de B est intacte", async () => {
    const modifiees = await executerDansOrganisation(orgs.a, (tx) =>
      tx
        .update(temoinIsolation)
        .set({ valeur: "modifiée par A" })
        .where(eq(temoinIsolation.organisationId, orgs.b))
        .returning({ id: temoinIsolation.id }),
    );

    expect(modifiees).toEqual([]);
    const [ligne] = await relire(orgs.b, ligneB);
    expect(ligne?.valeur).toBe("ligne de B");
  });

  test("suppression des lignes de B : 0 ligne, la ligne de B existe toujours", async () => {
    const supprimees = await executerDansOrganisation(orgs.a, (tx) =>
      tx
        .delete(temoinIsolation)
        .where(eq(temoinIsolation.organisationId, orgs.b))
        .returning({ id: temoinIsolation.id }),
    );

    expect(supprimees).toEqual([]);
    expect(await relire(orgs.b, ligneB)).toHaveLength(1);
  });

  test("déplacement de sa propre ligne vers B : refus 42501, la ligne reste à A", async () => {
    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx
          .update(temoinIsolation)
          .set({ organisationId: orgs.b })
          .where(eq(temoinIsolation.id, ligneA)),
      ),
    );

    expect(code).toBe("42501");
    const [ligne] = await relire(orgs.a, ligneA);
    expect(ligne?.organisationId).toBe(orgs.a);
  });
});

describe("T-53 : sans organisation active, rien n'est visible", () => {
  test("lecture par db : 0 ligne", async () => {
    const [ligne] = await db
      .select({ n: count() })
      .from(temoinIsolation)
      .where(inArray(temoinIsolation.organisationId, [orgs.a, orgs.b]));

    expect(ligne?.n).toBe(0);
  });

  test("insertion par db : refus 42501", async () => {
    const code = await codeDuRefus(
      db.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: "sans organisation" }),
    );

    expect(code).toBe("42501");
  });

  test("le rôle de la connexion est app_facturation, sans BYPASSRLS ni super-utilisateur", async () => {
    const resultat = await db.execute<{ role: string; contourne: boolean; super: boolean }>(sql`
      SELECT current_user AS role, rolbypassrls AS contourne, rolsuper AS super
      FROM pg_roles WHERE rolname = current_user`);

    expect(resultat.rows).toEqual([{ role: "app_facturation", contourne: false, super: false }]);
  });
});

describe("injection par l'identifiant d'organisation", () => {
  const VALEUR = "00000000-0000-4000-8000-000000000000' OR '1'='1";

  test("refusée par la validation", async () => {
    await expect(
      executerDansOrganisation(VALEUR, (tx) => tx.select().from(temoinIsolation)),
    ).rejects.toBeInstanceOf(OrganisationActiveInvalide);
  });

  test("validation contournée, valeur en paramètre lié : la conversion ::uuid échoue (22P02)", async () => {
    let lues: unknown[] | undefined;

    const code = await codeDuRefus(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.organisation_id', ${VALEUR}, true)`);
        lues = await tx.select().from(temoinIsolation);
      }),
    );

    expect(code).toBe("22P02");
    expect(lues).toBeUndefined();
  });
});
