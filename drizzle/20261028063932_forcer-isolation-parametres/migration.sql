-- Custom SQL migration file, put your code below! --
ALTER TABLE "parametres_organisation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "taux_tva" FORCE ROW LEVEL SECURITY;
REVOKE DELETE, TRUNCATE ON TABLE "parametres_organisation" FROM "app_facturation";
REVOKE DELETE, TRUNCATE ON TABLE "taux_tva" FROM "app_facturation";