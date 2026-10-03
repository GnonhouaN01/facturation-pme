import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

const proprietaire = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATION });
const application = new pg.Client({ connectionString: process.env.DATABASE_URL });

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
  const ok = obtenu === attendu;
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK   " : "ECHEC"} ${libelle} : obtenu ${obtenu}, attendu ${attendu}`);
}

async function compter() {
  const { rows } = await application.query("SELECT count(*)::int AS n FROM verif_isolation");
  return rows[0].n;
}

await proprietaire.connect();
await application.connect();

try {
  await proprietaire.query(`
    DROP TABLE IF EXISTS verif_isolation;
    CREATE TABLE verif_isolation (organisation_id uuid NOT NULL, valeur text NOT NULL);
    ALTER TABLE verif_isolation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE verif_isolation FORCE ROW LEVEL SECURITY;
    CREATE POLICY isolation_organisation ON verif_isolation
      USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid)
      WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);
    INSERT INTO verif_isolation VALUES ('${ORG_A}', 'donnee de A'), ('${ORG_B}', 'donnee de B');
  `);

  verifier("1. Sans organisation active, lignes visibles", await compter(), 0);

  await application.query("BEGIN");
  await application.query("SELECT set_config('app.organisation_id', $1, true)", [ORG_A]);

  verifier("2. Organisation A active, lignes visibles", await compter(), 1);

  const lecture = await application.query("SELECT valeur FROM verif_isolation");
  verifier("3. Organisation A active, donnee lue", lecture.rows[0]?.valeur, "donnee de A");

  let refuse = false;
  await application.query("SAVEPOINT avant_ecriture");
  try {
    await application.query("INSERT INTO verif_isolation VALUES ($1, 'intrusion')", [ORG_B]);
  } catch {
    refuse = true;
    await application.query("ROLLBACK TO SAVEPOINT avant_ecriture");
  }
  verifier("4. Organisation A active, ecriture chez B refusee", refuse, true);

  const modification = await application.query(
    "UPDATE verif_isolation SET valeur = 'modifie' WHERE organisation_id = $1",
    [ORG_B],
  );
  verifier("5. Organisation A active, lignes de B modifiees", modification.rowCount, 0);

  await application.query("COMMIT");

  verifier("6. Apres la transaction, lignes visibles", await compter(), 0);
} finally {
  await proprietaire.query("DROP TABLE IF EXISTS verif_isolation");
  await proprietaire.end();
  await application.end();
}

console.log(echecs === 0 ? "\nIsolation verifiee." : `\n${echecs} verification(s) en echec.`);
process.exitCode = echecs === 0 ? 0 : 1;
