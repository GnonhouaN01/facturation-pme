-- Custom SQL migration file, put your code below! --
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "journal_audit" FROM "app_facturation";