import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, onTestFinished, test } from "vitest";

import { db, executerDansOrganisation, type TransactionOrganisation } from "./client";
import { verifierIsolation } from "./outils-test/isolation";
import { creerDeuxOrganisations } from "./outils-test/organisations";
import { journalAudit, temoinIsolation } from "./schema/technique";

// La table du journal d'audit : isolation en mode ajout seul, droits du rôle
// de l'application, horodatage. Hors de schema/, que drizzle-kit charge en
// entier. Fiche : docs/features/journal-audit.md, sections 1, 2 et 8.1.

const ANNULATION = new Error("annulation voulue");

// Exécute travail dans une transaction de l'organisation, puis l'annule :
// rien n'est validé, l'organisation reste supprimable par nettoyer.
async function puisAnnuler<T>(
  organisationId: string,
  travail: (tx: TransactionOrganisation) => Promise<T>,
): Promise<T> {
  let resultat: T | undefined;
  await executerDansOrganisation(organisationId, async (tx) => {
    resultat = await travail(tx);
    throw ANNULATION;
  }).catch((erreur: unknown) => {
    if (erreur !== ANNULATION) throw erreur;
  });
  return resultat as T;
}

describe("journal_audit", () => {
  test("journalAudit est déclarée dans schema/technique.ts", () => {
    expect(journalAudit).toBeDefined();
  });

  test("passe verifierIsolation en mode ajout seul (contrôles 0 à 9)", async () => {
    // Sans la table, verifierIsolation laisserait ses deux organisations.
    expect(journalAudit, "journalAudit déclarée").toBeDefined();

    await expect(
      verifierIsolation(
        journalAudit,
        (organisationId) => ({
          organisationId,
          auteurId: randomUUID(),
          action: "membre.ajoute",
          typeRessource: "membre",
          ressourceId: randomUUID(),
        }),
        { ajoutSeul: true },
      ),
    ).resolves.toBeUndefined();
  });

  test("le rôle de l'application a SELECT et INSERT, ni UPDATE, ni DELETE, ni TRUNCATE", async () => {
    const { rows } = await db.execute<{ droit: string; accorde: boolean }>(sql`
      SELECT droit, has_table_privilege(current_user, 'public.journal_audit', droit) AS accorde
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS droit`);

    expect(Object.fromEntries(rows.map((r) => [r.droit, r.accorde]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
    });
  });

  test("une entrée reçoit son horodatage de la base", async () => {
    const { a, nettoyer } = await creerDeuxOrganisations({
      tables: [temoinIsolation],
      tablesAjoutSeul: [journalAudit],
    });
    onTestFinished(nettoyer);
    const avant = new Date();

    const [entree] = await puisAnnuler(a, async (tx) => {
      const ressourceId = randomUUID();
      await tx.insert(journalAudit).values({
        organisationId: a,
        auteurId: randomUUID(),
        action: "membre.ajoute",
        typeRessource: "membre",
        ressourceId,
      });
      return tx
        .select({ creeLe: journalAudit.creeLe })
        .from(journalAudit)
        .where(eq(journalAudit.ressourceId, ressourceId));
    });

    const apres = new Date();
    expect(entree?.creeLe).toBeInstanceOf(Date);
    // Marge d'une seconde : horloges du poste et de la base.
    expect(entree!.creeLe.getTime()).toBeGreaterThanOrEqual(avant.getTime() - 1_000);
    expect(entree!.creeLe.getTime()).toBeLessThanOrEqual(apres.getTime() + 1_000);
  });
});
