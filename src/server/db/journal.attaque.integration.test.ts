import { randomUUID } from "node:crypto";

import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import { EntreeJournalInvalide, journaliser, type EntreeJournal } from "../journal/audit";

import { db, executerDansOrganisation } from "./client";
import { codeDuRefus } from "./outils-test/isolation";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { organization, user } from "./schema/auth";
import { journalAudit, temoinIsolation } from "./schema/technique";

// Tests d'attaque des menaces T-20 et T-21, trace au nom d'une autre
// organisation, annulation de la transaction (S-70) et injection. Ce test
// vit dans db/ : seuls les tests de db/ peuvent importer drizzle-orm et la
// base (règles ESLint de la 0.2). Fiche : docs/features/journal-audit.md,
// « Tests d'attaque ».

const REFUS_DROIT = "42501";
const ANNULATION = new Error("annulation voulue");

let orgs: Organisations;
let entreeA: string;
let entreeB: string;

function entree(ressourceId = randomUUID()): EntreeJournal {
  return { action: "membre.ajoute", auteurId: randomUUID(), ressourceId };
}

// Entrée validée, insérée directement dans la table : les attaques sur la
// table ne dépendent pas de la fonction d'écriture.
async function inserer(organisationId: string, auteurId: string = randomUUID()): Promise<string> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx
      .insert(journalAudit)
      .values({
        organisationId,
        auteurId,
        action: "membre.ajoute",
        typeRessource: "membre",
        ressourceId: randomUUID(),
      })
      .returning({ id: journalAudit.id }),
  );
  if (!ligne) throw new Error("insertion sans ligne renvoyée");
  return ligne.id;
}

async function relire(organisationId: string, id: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx.select().from(journalAudit).where(eq(journalAudit.id, id)),
  );
}

// Nombre d'entrées d'une ressource, lu dans l'organisation indiquée.
async function entreesDe(organisationId: string, ressourceId: string): Promise<number> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx.select({ n: count() }).from(journalAudit).where(eq(journalAudit.ressourceId, ressourceId)),
  );
  return ligne?.n ?? -1;
}

async function lignesTemoin(organisationId: string, valeur: string): Promise<number> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx.select({ n: count() }).from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
  );
  return ligne?.n ?? -1;
}

async function totalEntrees(organisationId: string): Promise<number> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx.select({ n: count() }).from(journalAudit),
  );
  return ligne?.n ?? -1;
}

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [temoinIsolation],
    tablesAjoutSeul: [journalAudit],
  });
  entreeA = await inserer(orgs.a);
  entreeB = await inserer(orgs.b);
});

afterAll(async () => {
  await orgs?.nettoyer();
});

describe("T-21 : effacer ou modifier ses traces", () => {
  test("modification de l'action : refus 42501, entrée intacte", async () => {
    const [avant] = await relire(orgs.a, entreeA);

    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx
          .update(journalAudit)
          .set({ action: "membre.retire" })
          .where(eq(journalAudit.id, entreeA)),
      ),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toEqual([avant]);
  });

  test("modification de l'auteur : refus 42501, entrée intacte", async () => {
    const [avant] = await relire(orgs.a, entreeA);

    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx.update(journalAudit).set({ auteurId: randomUUID() }).where(eq(journalAudit.id, entreeA)),
      ),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toEqual([avant]);
  });

  test("suppression de l'entrée, puis de toutes : refus 42501, entrée intacte", async () => {
    const cible = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx.delete(journalAudit).where(eq(journalAudit.id, entreeA)),
      ),
    );
    const toutes = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) => tx.delete(journalAudit)),
    );

    expect(cible).toBe(REFUS_DROIT);
    expect(toutes).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toHaveLength(1);
  });

  test("vidage par TRUNCATE : refus 42501, entrées de A et de B intactes", async () => {
    // TRUNCATE ignore la règle d'isolation : seul le retrait du droit l'arrête.
    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) => tx.execute(sql`TRUNCATE ${journalAudit}`)),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toHaveLength(1);
    expect(await relire(orgs.b, entreeB)).toHaveLength(1);
  });

  test("réécriture par INSERT ... ON CONFLICT DO UPDATE : refus 42501, entrée intacte", async () => {
    const [avant] = await relire(orgs.a, entreeA);

    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx
          .insert(journalAudit)
          .values({
            id: entreeA,
            organisationId: orgs.a,
            auteurId: randomUUID(),
            action: "membre.retire",
            typeRessource: "membre",
            ressourceId: randomUUID(),
          })
          .onConflictDoUpdate({ target: journalAudit.id, set: { action: "membre.retire" } }),
      ),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toEqual([avant]);
  });

  test("sans organisation active, par db : UPDATE et DELETE refusés 42501", async () => {
    const modification = await codeDuRefus(
      db.update(journalAudit).set({ action: "membre.retire" }).where(eq(journalAudit.id, entreeA)),
    );
    const suppression = await codeDuRefus(
      db.delete(journalAudit).where(eq(journalAudit.id, entreeA)),
    );

    // Le refus de droit précède la règle : ce n'est pas « 0 ligne ».
    expect(modification).toBe(REFUS_DROIT);
    expect(suppression).toBe(REFUS_DROIT);
    expect(await relire(orgs.a, entreeA)).toHaveLength(1);
  });

  test("suppression de l'organisation : refus 23001, entrées intactes", async () => {
    const code = await codeDuRefus(db.delete(organization).where(eq(organization.id, orgs.a)));

    // 23001 (restrict_violation), PostgreSQL 18, clé en ON DELETE RESTRICT.
    expect(code).toBe("23001");
    expect(await relire(orgs.a, entreeA)).toHaveLength(1);
  });

  test("suppression du compte de l'auteur : réussit, l'entrée garde son auteur", async () => {
    const [compte] = await db
      .insert(user)
      .values({ name: "Test journal", email: `test-${randomUUID()}@exemple.invalid` })
      .returning({ id: user.id });
    if (!compte) throw new Error("compte de test non créé");
    // Filet si le test échoue avant la suppression.
    onTestFinished(async () => {
      await db.delete(user).where(eq(user.id, compte.id));
    });
    const id = await inserer(orgs.a, compte.id);

    await db.delete(user).where(eq(user.id, compte.id));

    const [apres] = await relire(orgs.a, id);
    expect(apres?.auteurId).toBe(compte.id);
  });
});

describe("trace au nom d'une autre organisation", () => {
  test("journaliser avec une organisation dans l'entrée : EntreeJournalInvalide, rien n'est écrit", async () => {
    const ressourceId = randomUUID();

    const promesse = executerDansOrganisation(orgs.a, (tx) =>
      journaliser(tx, { ...entree(ressourceId), organisationId: orgs.b } as EntreeJournal),
    );

    await expect(promesse).rejects.toBeInstanceOf(EntreeJournalInvalide);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(0);
    expect(await entreesDe(orgs.b, ressourceId)).toBe(0);
  });

  test("insertion directe pour B dans une transaction de A : refus 42501", async () => {
    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, (tx) =>
        tx.insert(journalAudit).values({
          organisationId: orgs.b,
          auteurId: randomUUID(),
          action: "membre.ajoute",
          typeRessource: "membre",
          ressourceId: randomUUID(),
        }),
      ),
    );

    expect(code).toBe(REFUS_DROIT);
  });

  test("l'entrée écrite par journaliser porte A, et B ne la voit pas", async () => {
    const ressourceId = randomUUID();

    await executerDansOrganisation(orgs.a, (tx) => journaliser(tx, entree(ressourceId)));

    const [lue] = await executerDansOrganisation(orgs.a, (tx) =>
      tx
        .select({ organisationId: journalAudit.organisationId })
        .from(journalAudit)
        .where(eq(journalAudit.ressourceId, ressourceId)),
    );
    expect(lue?.organisationId).toBe(orgs.a);
    expect(await entreesDe(orgs.b, ressourceId)).toBe(0);
  });
});

describe("sans organisation active", () => {
  // Code attendu : 42501 (règle). Si la base renvoie 23502 (NOT NULL), le
  // constater à l'implémentation et figer ici le code observé (fiche,
  // section 5).
  test("transaction sans réglage : refus, rien n'est écrit", async () => {
    const ressourceId = randomUUID();

    const code = await codeDuRefus(db.transaction((tx) => journaliser(tx, entree(ressourceId))));

    expect(code).toBe(REFUS_DROIT);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(0);
  });

  test("transaction avec le réglage vide : refus, rien n'est écrit", async () => {
    const ressourceId = randomUUID();

    const code = await codeDuRefus(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.organisation_id', '', true)`);
        await journaliser(tx, entree(ressourceId));
      }),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(0);
  });
});

describe("S-70 : l'action et sa trace réussissent ou échouent ensemble", () => {
  test("action puis trace, puis exception : ni l'une ni l'autre n'existent", async () => {
    const valeur = `annulation-${randomUUID()}`;
    const ressourceId = randomUUID();

    await executerDansOrganisation(orgs.a, async (tx) => {
      await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur });
      await journaliser(tx, entree(ressourceId));
      throw ANNULATION;
    }).catch((erreur: unknown) => {
      if (erreur !== ANNULATION) throw erreur;
    });

    expect(await lignesTemoin(orgs.a, valeur)).toBe(0);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(0);
  });

  test("trace invalide : EntreeJournalInvalide remonte, l'action n'a pas lieu", async () => {
    const valeur = `trace-invalide-${randomUUID()}`;

    const promesse = executerDansOrganisation(orgs.a, async (tx) => {
      await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur });
      await journaliser(tx, { ...entree(), details: { email: "personne@exemple.invalid" } });
    });

    await expect(promesse).rejects.toBeInstanceOf(EntreeJournalInvalide);
    expect(await lignesTemoin(orgs.a, valeur)).toBe(0);
  });

  test("trace puis action refusée par la base : la trace n'existe pas", async () => {
    const ressourceId = randomUUID();

    const code = await codeDuRefus(
      executerDansOrganisation(orgs.a, async (tx) => {
        await journaliser(tx, entree(ressourceId));
        await tx.insert(temoinIsolation).values({ organisationId: orgs.b, valeur: "intrusion" });
      }),
    );

    expect(code).toBe(REFUS_DROIT);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(0);
  });

  test("action et trace réussies : les deux existent", async () => {
    const valeur = `reussite-${randomUUID()}`;
    const ressourceId = randomUUID();

    await executerDansOrganisation(orgs.a, async (tx) => {
      await tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur });
      await journaliser(tx, entree(ressourceId));
    });

    expect(await lignesTemoin(orgs.a, valeur)).toBe(1);
    expect(await entreesDe(orgs.a, ressourceId)).toBe(1);
  });
});

describe("injection", () => {
  test.each([
    ["ressourceId", { ressourceId: "00000000-0000-4000-8000-000000000000' OR '1'='1" }],
    ["auteurId", { auteurId: "'; DELETE FROM journal_audit; --" }],
    ["action", { action: "membre.ajoute'; TRUNCATE journal_audit; --" }],
  ])("%s : refusé par la validation, rien n'est écrit", async (_nom, falsifie) => {
    const avant = await totalEntrees(orgs.a);

    const promesse = executerDansOrganisation(orgs.a, (tx) =>
      journaliser(tx, { ...entree(), ...falsifie } as EntreeJournal),
    );

    await expect(promesse).rejects.toBeInstanceOf(EntreeJournalInvalide);
    expect(await totalEntrees(orgs.a)).toBe(avant);
  });
});
