// Vérifie, en lecture seule, que les identifiants des tables de Better Auth
// sont de type uuid dans la base. Script provisoire : il sera remplacé par un
// test Vitest avec l'outillage de la fonctionnalité 0.2.
// Fiche : docs/features/identifiants-uuid.md.
//
// Les deux requêtes SQL ci-dessous se copient telles quelles dans l'éditeur
// SQL de Neon, pour vérifier preview et production sans leur adresse.

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const TABLES = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "two_factor",
  "user",
  "verification",
];

// table.colonne -> table.colonne visée
const CLES_ETRANGERES = [
  "account.user_id -> user.id",
  "invitation.inviter_id -> user.id",
  "invitation.organization_id -> organization.id",
  "member.organization_id -> organization.id",
  "member.user_id -> user.id",
  "session.user_id -> user.id",
  "two_factor.user_id -> user.id",
];

const REQUETE_COLONNES = `
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('account', 'invitation', 'member', 'organization',
                     'session', 'two_factor', 'user', 'verification')
ORDER BY table_name, column_name;`;

const REQUETE_CLES = `
SELECT src.relname AS table_source,
       a.attname AS colonne_source,
       format_type(a.atttypid, a.atttypmod) AS type_source,
       dst.relname AS table_cible,
       b.attname AS colonne_cible,
       format_type(b.atttypid, b.atttypmod) AS type_cible,
       cardinality(c.conkey) AS nombre_colonnes
FROM pg_constraint c
JOIN pg_class src ON src.oid = c.conrelid
JOIN pg_namespace n ON n.oid = src.relnamespace
JOIN pg_class dst ON dst.oid = c.confrelid
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = c.confkey[1]
WHERE c.contype = 'f'
  AND n.nspname = 'public'
  AND src.relname IN ('account', 'invitation', 'member', 'organization',
                      'session', 'two_factor', 'user', 'verification')
ORDER BY table_source, colonne_source;`;

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
  const ok = obtenu === attendu;
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK   " : "ECHEC"} ${libelle} : obtenu ${obtenu}, attendu ${attendu}`);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let colonnes;
let cles;
try {
  // Transaction en lecture seule : toute écriture serait refusée par la base.
  await client.query("BEGIN TRANSACTION READ ONLY");
  colonnes = (await client.query(REQUETE_COLONNES)).rows;
  cles = (await client.query(REQUETE_CLES)).rows;
  await client.query("ROLLBACK");
} finally {
  await client.end();
}

const typeDe = (table, colonne) =>
  colonnes.find((c) => c.table_name === table && c.column_name === colonne)?.data_type ?? "absente";
const defautDe = (table, colonne) =>
  colonnes.find((c) => c.table_name === table && c.column_name === colonne)?.column_default ?? null;

console.log("Colonnes id :");
for (const table of TABLES) {
  verifier(`${table}.id, type`, typeDe(table, "id"), "uuid");
  verifier(
    `${table}.id, valeur par défaut gen_random_uuid()`,
    defautDe(table, "id")?.includes("gen_random_uuid()") ?? false,
    true,
  );
}

console.log("\nColonnes des clés étrangères :");
for (const cle of CLES_ETRANGERES) {
  const [table, colonne] = cle.split(" -> ")[0].split(".");
  verifier(`${table}.${colonne}, type`, typeDe(table, colonne), "uuid");
}

console.log("\nContraintes de clé étrangère :");
const clesTrouvees = cles.map(
  (c) => `${c.table_source}.${c.colonne_source} -> ${c.table_cible}.${c.colonne_cible}`,
);
verifier("Clés étrangères présentes", clesTrouvees.join(", "), CLES_ETRANGERES.join(", "));
for (const c of cles) {
  const libelle = `${c.table_source}.${c.colonne_source} -> ${c.table_cible}.${c.colonne_cible}`;
  verifier(`${libelle}, nombre de colonnes`, c.nombre_colonnes, 1);
  verifier(`${libelle}, types`, `${c.type_source} -> ${c.type_cible}`, "uuid -> uuid");
}

console.log("\nException documentée :");
verifier(
  "session.active_organization_id, type",
  typeDe("session", "active_organization_id"),
  "text",
);

console.log("\nTotal :");
verifier(
  "Colonnes uuid dans les 8 tables",
  colonnes.filter((c) => c.data_type === "uuid").length,
  15,
);

console.log(echecs === 0 ? "\nIdentifiants verifies." : `\n${echecs} verification(s) en echec.`);
process.exitCode = echecs === 0 ? 0 : 1;
