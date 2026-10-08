import "server-only";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import { env } from "../env";

import { authRelations } from "./schema/auth";

// Fiche : docs/features/acces-donnees.md, section 1.

function creerBase(pool: Pool) {
  return drizzle({ client: pool, relations: authRelations });
}

export type BaseDeDonnees = ReturnType<typeof creerBase>;

// Transaction ouverte par executerDansOrganisation, organisation active fixée.
// Les fonctions de requetes/ la prennent en premier paramètre.
export type TransactionOrganisation = Parameters<Parameters<BaseDeDonnees["transaction"]>[0]>[0];

export type Acces = {
  db: BaseDeDonnees;
  executerDansOrganisation: <T>(
    organisationId: string,
    travail: (tx: TransactionOrganisation) => Promise<T>,
  ) => Promise<T>;
};

// Message fixe : ni la valeur reçue, ni cause (S-54, T-35).
const MESSAGE_INVALIDE = "Identifiant d'organisation active invalide.";

export class OrganisationActiveInvalide extends Error {
  constructor() {
    super(MESSAGE_INVALIDE);
    this.name = "OrganisationActiveInvalide";
  }
}

const identifiantOrganisation = z.uuid();

// Fabrique liée à un Pool. Les exports db et executerDansOrganisation sont
// l'instance liée au Pool principal ; les tests s'en servent pour un Pool
// d'une seule connexion ou un Pool factice.
export function creerAcces(pool: Pool): Acces {
  const base = creerBase(pool);

  async function executer<T>(
    organisationId: string,
    travail: (tx: TransactionOrganisation) => Promise<T>,
  ): Promise<T> {
    // Validation avant toute connexion : un identifiant invalide ne prend
    // rien dans le Pool et n'envoie aucune requête.
    const resultat = identifiantOrganisation.safeParse(organisationId);
    if (!resultat.success) throw new OrganisationActiveInvalide();

    return base.transaction(async (tx) => {
      // Première instruction de la transaction. Le troisième argument true rend
      // le réglage local à la transaction : il disparaît au COMMIT comme au
      // ROLLBACK, et ne passe donc pas à un autre client par le regroupement de
      // connexions. Identifiant en paramètre lié (S-86).
      // Interdits : l'instruction SET sur ce réglage, ou set_config avec un
      // troisième argument à faux (réglage de session) ; SET LOCAL (pas de
      // paramètre lié) ; fixer l'organisation hors de la transaction qui
      // interroge.
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${resultat.data}, true)`);
      return travail(tx);
    });
  }

  return { db: base, executerDansOrganisation: executer };
}

const principal = creerAcces(new Pool({ connectionString: env.DATABASE_URL }));

// db n'a pas d'organisation active : réservé à Better Auth (règle ESLint).
export const db = principal.db;

// Seule façon autorisée d'exécuter une requête métier.
export const executerDansOrganisation = principal.executerDansOrganisation;
