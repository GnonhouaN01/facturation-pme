import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../env";

import { authRelations } from "./schema/auth";

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle({ client: pool, relations: authRelations });

export type BaseDeDonnees = typeof db;

// Transaction ouverte par executerDansOrganisation, organisation active fixée.
export type TransactionOrganisation = Parameters<Parameters<BaseDeDonnees["transaction"]>[0]>[0];

export type Acces = {
  db: BaseDeDonnees;
  executerDansOrganisation: <T>(
    organisationId: string,
    travail: (tx: TransactionOrganisation) => Promise<T>,
  ) => Promise<T>;
};

// Fiche : docs/features/acces-donnees.md, section 1. Non implémenté : les
// tests sont écrits d'abord.
export class OrganisationActiveInvalide extends Error {}

export function creerAcces(poolAcces: Pool): Acces {
  void poolAcces;
  throw new Error("non implémenté : creerAcces");
}

export async function executerDansOrganisation<T>(
  organisationId: string,
  travail: (tx: TransactionOrganisation) => Promise<T>,
): Promise<T> {
  void organisationId;
  void travail;
  throw new Error("non implémenté : executerDansOrganisation");
}
