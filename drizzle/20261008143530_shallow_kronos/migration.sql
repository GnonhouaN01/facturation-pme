CREATE TABLE "temoin_isolation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organisation_id" uuid NOT NULL,
	"valeur" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "temoin_isolation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "temoin_isolation" ADD CONSTRAINT "temoin_isolation_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "isolation_organisation" ON "temoin_isolation" AS PERMISSIVE FOR ALL TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);