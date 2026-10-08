import "server-only";

import { sql } from "drizzle-orm";

import { db } from "../client";

// Garde-fou des tests avec base : refuse toute base qui n'est pas marquée
// comme base de test. Fiche : docs/features/acces-donnees.md, section 5.

// Commentaire de base posé par le rôle propriétaire (COMMENT ON DATABASE),
// par scripts/retablir-acces-dev.mjs et scripts/preparer-base-test.mjs.
const MARQUE_TEST = "environnement:test";
const ROLE_APPLICATION = "app_facturation";

// Raisons destinées au développeur : jamais l'hôte, le nom de la base, ni la
// valeur lue (S-54).
const RAISONS = {
  marque: "la base visée n'est pas marquée comme base de test",
  role: "le rôle de connexion n'est pas app_facturation",
  contourne: "le rôle de connexion contourne l'isolation",
} as const;

export type EtatBase = {
  marque: string | null;
  role: string | null;
  contourne: boolean | null;
};

function refuser(raison: string): never {
  throw new Error(`Tests refusés : ${raison}.`);
}

// Décision pure, appliquée au résultat de la requête du garde-fou. Fermée par
// défaut : seule la valeur exacte de la marque est acceptée.
export function deciderBaseDeTest(etat: EtatBase): void {
  if (etat.marque !== MARQUE_TEST) refuser(RAISONS.marque);
  if (etat.role !== ROLE_APPLICATION) refuser(RAISONS.role);
  if (etat.contourne !== false) refuser(RAISONS.contourne);
}

const REQUETE = sql`
  SELECT shobj_description(d.oid, 'pg_database') AS marque,
         current_user AS role,
         (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS contourne
  FROM pg_database d
  WHERE d.datname = current_database()`;

export async function verifierBaseDeTest(): Promise<void> {
  const resultat = await db.execute<EtatBase>(REQUETE);
  deciderBaseDeTest(resultat.rows[0] ?? { marque: null, role: null, contourne: null });
}
