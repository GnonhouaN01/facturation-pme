import pg from "pg";

function arreter(message) {
  console.error(message);
  process.exit(1);
}

const urlProprietaire = process.env.DATABASE_URL_MIGRATION;
const urlApplication = process.env.DATABASE_URL;
if (!urlProprietaire || !urlApplication) {
  arreter("DATABASE_URL_MIGRATION et DATABASE_URL doivent etre definies.");
}

const hote = new URL(urlProprietaire).hostname;
if (!["localhost", "127.0.0.1"].includes(hote)) {
  arreter("Ce script ne s'execute que sur une base locale de test. Hote refuse.");
}

const application = new URL(urlApplication);
if (application.username !== "app_facturation") {
  arreter("DATABASE_URL doit utiliser le role app_facturation.");
}
const motDePasse = decodeURIComponent(application.password);
if (!/^[A-Za-z0-9_-]+$/.test(motDePasse)) {
  arreter("Le mot de passe de test ne doit contenir que des lettres, chiffres, tirets.");
}

const client = new pg.Client({ connectionString: urlProprietaire });
await client.connect();
await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_facturation') THEN
      CREATE ROLE app_facturation LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  $$;
  ALTER ROLE app_facturation WITH PASSWORD '${motDePasse}';
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO app_facturation;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_facturation;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_facturation;
`);
await client.end();

console.log(
  "Base de test preparee : role app_facturation cree, sans droit de contourner l'isolation.",
);
