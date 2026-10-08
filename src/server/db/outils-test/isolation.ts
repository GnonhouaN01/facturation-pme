import "server-only";

import { count, eq, getTableName, inArray, sql, type InferInsertModel } from "drizzle-orm";
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
// Option ajoutSeul (table sans UPDATE, DELETE ni TRUNCATE pour le rôle de
// l'application, comme le journal d'audit) : le contrôle 0 vérifie d'abord ces
// droits, les contrôles 5, 7 et 8 attendent un refus de droit et des lignes
// intactes, le contrôle 9 tente un TRUNCATE. Sans l'option, rien ne change.
// Fiche : docs/features/journal-audit.md, section 8.1.
export async function verifierIsolation<T extends TableOrganisation>(
  table: T,
  fabriquer: (organisationId: string) => InferInsertModel<T>,
  options: { ajoutSeul?: boolean } = {},
): Promise<void> {
  const ajoutSeul = options.ajoutSeul === true;
  const { a, b, nettoyer } = await creerDeuxOrganisations(
    ajoutSeul ? { tables: [], tablesAjoutSeul: [table] } : { tables: [table] },
  );
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
  // Lignes d'une organisation, lues dans son contexte, pour vérifier
  // qu'un refus les a laissées intactes.
  const lire = (organisationId: string) =>
    acces.executerDansOrganisation(organisationId, (tx) =>
      tx
        .select()
        .from(table as PgTable)
        .where(eq(table.organisationId, organisationId)),
    );

  try {
    if (ajoutSeul) {
      // Avant toute écriture : une table qui a encore ces droits ne passe
      // pas, et ses organisations restent supprimables.
      const nom = getTableName(table);
      const { rows } = await acces.db.execute<Record<string, boolean>>(sql`
        SELECT has_table_privilege(current_user, ${nom}, 'SELECT') AS lecture,
               has_table_privilege(current_user, ${nom}, 'INSERT') AS insertion,
               has_table_privilege(current_user, ${nom}, 'UPDATE') AS modification,
               has_table_privilege(current_user, ${nom}, 'DELETE') AS suppression,
               has_table_privilege(current_user, ${nom}, 'TRUNCATE') AS vidage`);
      const droits = rows[0];
      exiger(
        droits?.lecture === true &&
          droits.insertion === true &&
          droits.modification === false &&
          droits.suppression === false &&
          droits.vidage === false,
        "contrôle 0 (droits de l'ajout seul)",
      );
    }

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

    const lignesA = ajoutSeul ? await lire(a) : [];
    const lignesB = ajoutSeul ? await lire(b) : [];
    const intactes = async () =>
      JSON.stringify(await lire(a)) === JSON.stringify(lignesA) &&
      JSON.stringify(await lire(b)) === JSON.stringify(lignesB);

    const modifierB = () =>
      acces.executerDansOrganisation(a, (tx) =>
        tx
          .update(table as PgTable)
          .set({ organisationId: b } as never)
          .where(eq(table.organisationId, b))
          .returning({ organisationId: table.organisationId }),
      );
    if (ajoutSeul) {
      const code = await codeDuRefus(modifierB());
      exiger(
        code === REFUS_DROIT && (await intactes()),
        "contrôle 5 (modification des lignes de B par A)",
      );
    } else {
      const modifiees = await modifierB();
      exiger(modifiees.length === 0, "contrôle 5 (modification des lignes de B par A)");
    }

    exiger((await compter(acces.db)) === 0, "contrôle 6 (après la transaction, même connexion)");

    const supprimerB = () =>
      acces.executerDansOrganisation(a, (tx) =>
        tx
          .delete(table as PgTable)
          .where(eq(table.organisationId, b))
          .returning({ organisationId: table.organisationId }),
      );
    if (ajoutSeul) {
      const code = await codeDuRefus(supprimerB());
      exiger(
        code === REFUS_DROIT && (await intactes()),
        "contrôle 7 (suppression des lignes de B par A)",
      );
    } else {
      const supprimees = await supprimerB();
      const restantesB = await acces.executerDansOrganisation(b, (tx) => compter(tx));
      exiger(
        supprimees.length === 0 && restantesB === 1,
        "contrôle 7 (suppression des lignes de B par A)",
      );
    }

    const deplacement = await codeDuRefus(
      acces.executerDansOrganisation(a, (tx) =>
        tx
          .update(table as PgTable)
          .set({ organisationId: b } as never)
          .where(eq(table.organisationId, a)),
      ),
    );
    exiger(
      deplacement === REFUS_DROIT && (!ajoutSeul || (await intactes())),
      "contrôle 8 (déplacement d'une ligne de A vers B)",
    );

    if (ajoutSeul) {
      // TRUNCATE ignore la règle d'isolation : seul le retrait du droit
      // l'arrête. Drizzle rend l'objet table comme un identifiant.
      const vidage = await codeDuRefus(
        acces.executerDansOrganisation(a, (tx) => tx.execute(sql`TRUNCATE ${table}`)),
      );
      exiger(vidage === REFUS_DROIT && (await intactes()), "contrôle 9 (TRUNCATE par A)");
    }
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
