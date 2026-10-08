import "server-only";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db, executerDansOrganisation } from "../client";
import { organization } from "../schema/auth";

import type { TableOrganisation } from "./isolation";

// Outillage des tests avec base. Ne s'importe que depuis un fichier de test.
// Fiche : docs/features/acces-donnees.md, section 4.2.

export type Organisations = {
  a: string;
  b: string;
  // Supprime les lignes des tables indiquées, puis les deux organisations.
  nettoyer: () => Promise<void>;
};

// Deux organisations aux identifiants aléatoires. Le slug garde le préfixe
// test- : une organisation laissée par un processus tué se reconnaît à la main.
export async function creerDeuxOrganisations(options: {
  tables: TableOrganisation[];
}): Promise<Organisations> {
  const ids = [randomUUID(), randomUUID()] as const;
  const [a, b] = ids;

  await db.insert(organization).values(
    ids.map((id) => ({
      id,
      name: `Test ${id}`,
      slug: `test-${id}`,
      createdAt: new Date(),
    })),
  );

  // Ne cible que les deux identifiants créés, jamais un motif. Les lignes
  // d'abord, dans le contexte de leur organisation (la règle l'exige), puis
  // les organisations : la clé étrangère est en ON DELETE RESTRICT. Une
  // suppression qui ne trouve rien ne lève pas d'erreur : nettoyer peut être
  // appelée deux fois.
  async function nettoyer(): Promise<void> {
    for (const id of ids) {
      await executerDansOrganisation(id, async (tx) => {
        for (const table of options.tables) {
          await tx.delete(table).where(eq(table.organisationId, id));
        }
      });
    }
    await db.delete(organization).where(inArray(organization.id, [...ids]));
  }

  return { a, b, nettoyer };
}
