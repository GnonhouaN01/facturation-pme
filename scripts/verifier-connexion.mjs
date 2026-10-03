import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

for (const nom of ["DATABASE_URL", "DATABASE_URL_MIGRATION"]) {
  const client = new pg.Client({ connectionString: process.env[nom] });
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS contourne_rls",
    );
    console.log(nom, rows[0]);
  } catch (erreur) {
    console.error(nom, "ECHEC :", erreur.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
