ALTER TABLE "account" DROP CONSTRAINT "account_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_inviter_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "two_factor" DROP CONSTRAINT "two_factor_user_id_user_id_fkey";--> statement-breakpoint
DROP TABLE "account";--> statement-breakpoint
DROP TABLE "invitation";--> statement-breakpoint
DROP TABLE "member";--> statement-breakpoint
DROP TABLE "organization";--> statement-breakpoint
DROP TABLE "session";--> statement-breakpoint
DROP TABLE "two_factor";--> statement-breakpoint
DROP TABLE "user";--> statement-breakpoint
DROP TABLE "verification";