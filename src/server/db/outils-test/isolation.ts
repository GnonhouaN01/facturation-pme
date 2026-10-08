import "server-only";

import { count, eq, inArray, type InferInsertModel } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import { env } from "../../env";
import { creerAcces, type BaseDeDonnees, type TransactionOrganisation } from "../client";

import { creerDeuxOrganisations } from "./organisations";

// Outillage des tests avec base. Ne s'importe que depuis un fichier de test.
// Fiche : docs/features/acces-donnees.md, section 4.3.

export type TableOrganisation = PgTable & { organisationId: AnyPgColumn };

const REFUS_DROIT = "42501";

function exiger(condition: boolean, controle: string): void {
  if (!condition) throw new Error(`Isolation : échec du ${controle}.`);
}

// Passe les huit contrôles d'isolation sur la table. Lève une erreur qui
// nomme le contrôle en échec. Les comptages ne portent que sur les deux
// organisations créées : d'autres tests peuvent écrire en parallèle.
export async function verifierIsolation<T extends TableOrganisation>(
  table: T,
  fabriquer: (organisationId: string) => InferInsertModel<T>,
): Promise<void> {
  const { a, b, nettoyer } = await creerDeuxOrganisations({ tables: [table] });
  // Une seule connexion : le contrôle 6 se fait sur la connexion même qui
  // vient de servir à la transaction.
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const acces = creerAcces(pool);
  const lesDeux = inArray(table.organisationId, [a, b]);

  const compter = async (x: BaseDeDonnees | TransactionOrganisation) => {
    const [ligne] = await x
      .select({ n: count() })
      .from(table as PgTable)
      .where(lesDeux);
    return ligne?.n ?? -1;
  };
  const inserer = (organisationId: string, valeurs: InferInsertModel<T>) =>
    acces.executerDansOrganisation(organisationId, (tx) =>
      tx.insert(table as PgTable).values(valeurs as never),
    );

  try {
    await inserer(a, fabriquer(a));
    await inserer(b, fabriquer(b));

    exiger((await compter(acces.db)) === 0, "contrôle 1 (lecture sans organisation active)");

    const vues = await acces.executerDansOrganisation(a, async (tx) => ({
      n: await compter(tx),
      lignes: await tx
        .select({ organisationId: table.organisationId })
        .from(table as PgTable)
        .where(lesDeux),
    }));
    exiger(vues.n === 1, "contrôle 2 (comptage par A)");
    exiger(
      vues.lignes.length === 1 && vues.lignes[0]?.organisationId === a,
      "contrôle 3 (lecture par A)",
    );

    const insertion = await codeDuRefus(inserer(a, fabriquer(b)));
    exiger(insertion === REFUS_DROIT, "contrôle 4 (insertion pour B par A)");

    const modifiees = await acces.executerDansOrganisation(a, (tx) =>
      tx
        .update(table as PgTable)
        .set({ organisationId: b } as never)
        .where(eq(table.organisationId, b))
        .returning({ organisationId: table.organisationId }),
    );
    exiger(modifiees.length === 0, "contrôle 5 (modification des lignes de B par A)");

    exiger((await compter(acces.db)) === 0, "contrôle 6 (après la transaction, même connexion)");

    const supprimees = await acces.executerDansOrganisation(a, (tx) =>
      tx
        .delete(table as PgTable)
        .where(eq(table.organisationId, b))
        .returning({ organisationId: table.organisationId }),
    );
    const restantesB = await acces.executerDansOrganisation(b, (tx) => compter(tx));
    exiger(
      supprimees.length === 0 && restantesB === 1,
      "contrôle 7 (suppression des lignes de B par A)",
    );

    const deplacement = await codeDuRefus(
      acces.executerDansOrganisation(a, (tx) =>
        tx
          .update(table as PgTable)
          .set({ organisationId: b } as never)
          .where(eq(table.organisationId, a)),
      ),
    );
    exiger(deplacement === REFUS_DROIT, "contrôle 8 (déplacement d'une ligne de A vers B)");
  } finally {
    await pool.end();
    await nettoyer();
  }
}

// Code PostgreSQL du refus de la promesse, en parcourant la chaîne des cause :
// Drizzle enveloppe l'erreur de pg. « aucun refus » si la promesse réussit,
// « aucun code » si l'erreur n'en porte pas.
export async function codeDuRefus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (erreur) {
    let courante: unknown = erreur;
    for (let profondeur = 0; profondeur < 10 && courante; profondeur += 1) {
      if (typeof courante === "object" && "code" in courante) {
        const { code } = courante as { code: unknown };
        if (typeof code === "string") return code;
      }
      courante = (courante as { cause?: unknown }).cause;
    }
    return "aucun code";
  }
  return "aucun refus";
}
