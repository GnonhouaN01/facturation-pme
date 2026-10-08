CREATE TABLE "journal_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organisation_id" uuid NOT NULL,
	"auteur_id" uuid NOT NULL,
	"action" text NOT NULL,
	"type_ressource" text NOT NULL,
	"ressource_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "journal_audit_organisation_cree_le_idx" ON "journal_audit" ("organisation_id","cree_le");--> statement-breakpoint
ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "isolation_organisation" ON "journal_audit" AS PERMISSIVE FOR ALL TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);