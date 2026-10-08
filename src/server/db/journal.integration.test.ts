import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { journaliser } from "../journal/audit";

import { executerDansOrganisation, type TransactionOrganisation } from "./client";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { journalAudit, temoinIsolation } from "./schema/technique";

// La fonction d'écriture du journal, avec la vraie base. Ce test vit dans
// db/ : seuls les tests de db/ peuvent importer drizzle-orm et la base (règles
// ESLint de la 0.2). Fiche : docs/features/journal-audit.md, sections 5 et 7.

const ANNULATION = new Error("annulation voulue");

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [temoinIsolation],
    tablesAjoutSeul: [journalAudit],
  });
});

afterAll(async () => {
  await orgs?.nettoyer();
});

function lire(organisationId: string, ressourceId: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx.select().from(journalAudit).where(eq(journalAudit.ressourceId, ressourceId)),
  );
}

describe("journaliser, avec la base", () => {
  test("écrit une entrée complète, à l'organisation de la transaction ; B ne la voit pas", async () => {
    const auteurId = randomUUID();
    const ressourceId = randomUUID();

    await executerDansOrganisation(orgs.a, (tx) =>
      journaliser(tx, { action: "membre.role_modifie", auteurId, ressourceId }),
    );

    const lues = await lire(orgs.a, ressourceId);
    expect(lues).toHaveLength(1);
    const [entree] = lues;
    expect(entree).toMatchObject({
      organisationId: orgs.a,
      auteurId,
      action: "membre.role_modifie",
      typeRessource: "membre",
      ressourceId,
      details: {},
    });
    expect(entree?.id).toEqual(expect.any(String));
    expect(entree?.creeLe).toBeInstanceOf(Date);

    expect(await lire(orgs.b, ressourceId)).toEqual([]);
  });

  test("deux entrées d'une même transaction portent le même horodatage", async () => {
    const premiere = randomUUID();
    const seconde = randomUUID();
    let heures: Date[] = [];

    await executerDansOrganisation(orgs.a, async (tx: TransactionOrganisation) => {
      await journaliser(tx, {
        action: "invitation.creee",
        auteurId: randomUUID(),
        ressourceId: premiere,
      });
      await journaliser(tx, {
        action: "invitation.revoquee",
        auteurId: randomUUID(),
        ressourceId: seconde,
      });
      const lues = await tx
        .select({ creeLe: journalAudit.creeLe })
        .from(journalAudit)
        .where(inArray(journalAudit.ressourceId, [premiere, seconde]));
      heures = lues.map((ligne) => ligne.creeLe);
      // Rien n'est validé : ce test ne laisse aucune entrée.
      throw ANNULATION;
    }).catch((erreur: unknown) => {
      if (erreur !== ANNULATION) throw erreur;
    });

    expect(heures).toHaveLength(2);
    expect(heures[0]?.getTime()).toBe(heures[1]?.getTime());
  });
});
