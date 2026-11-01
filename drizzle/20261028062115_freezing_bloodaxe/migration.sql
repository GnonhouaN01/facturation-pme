CREATE TABLE "parametres_organisation" (
	"organisation_id" uuid PRIMARY KEY,
	"adresse" text,
	"ncc" text,
	"rccm" text,
	"regime_imposition" text,
	"mentions_legales" text,
	"validite_devis_jours" integer DEFAULT 30 NOT NULL,
	"echeance_facture_jours" integer DEFAULT 30 NOT NULL,
	"paiement_mobile_money" text,
	"paiement_bancaire" text,
	"logo" bytea,
	"logo_type" text,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parametres_adresse_longueur" CHECK (char_length("adresse") BETWEEN 1 AND 300),
	CONSTRAINT "parametres_ncc_longueur" CHECK (char_length("ncc") BETWEEN 1 AND 30),
	CONSTRAINT "parametres_rccm_longueur" CHECK (char_length("rccm") BETWEEN 1 AND 50),
	CONSTRAINT "parametres_regime_longueur" CHECK (char_length("regime_imposition") BETWEEN 1 AND 100),
	CONSTRAINT "parametres_mentions_longueur" CHECK (char_length("mentions_legales") BETWEEN 1 AND 1000),
	CONSTRAINT "parametres_mobile_money_longueur" CHECK (char_length("paiement_mobile_money") BETWEEN 1 AND 200),
	CONSTRAINT "parametres_bancaire_longueur" CHECK (char_length("paiement_bancaire") BETWEEN 1 AND 500),
	CONSTRAINT "parametres_validite_devis" CHECK ("validite_devis_jours" BETWEEN 1 AND 365),
	CONSTRAINT "parametres_echeance_facture" CHECK ("echeance_facture_jours" BETWEEN 1 AND 365),
	CONSTRAINT "parametres_logo_taille" CHECK (octet_length("logo") BETWEEN 1 AND 204800),
	CONSTRAINT "parametres_logo_type" CHECK (("logo" IS NULL AND "logo_type" IS NULL) OR ("logo" IS NOT NULL AND "logo_type" IN ('image/png', 'image/jpeg')))
);
--> statement-breakpoint
ALTER TABLE "parametres_organisation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "taux_tva" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organisation_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"taux_centiemes" integer NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taux_tva_libelle_longueur" CHECK (char_length("libelle") BETWEEN 1 AND 50),
	CONSTRAINT "taux_tva_borne" CHECK ("taux_centiemes" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "taux_tva" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "taux_tva_organisation_taux_idx" ON "taux_tva" ("organisation_id","taux_centiemes");--> statement-breakpoint
ALTER TABLE "parametres_organisation" ADD CONSTRAINT "parametres_organisation_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "taux_tva" ADD CONSTRAINT "taux_tva_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "isolation_lecture" ON "parametres_organisation" AS PERMISSIVE FOR SELECT TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_insertion" ON "parametres_organisation" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_modification" ON "parametres_organisation" AS PERMISSIVE FOR UPDATE TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_lecture" ON "taux_tva" AS PERMISSIVE FOR SELECT TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_insertion" ON "taux_tva" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "isolation_modification" ON "taux_tva" AS PERMISSIVE FOR UPDATE TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);