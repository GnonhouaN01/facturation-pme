CREATE TABLE "compteur_debit" (
	"cle" text PRIMARY KEY,
	"compte" integer DEFAULT 0 NOT NULL,
	"fenetre_debut" timestamp with time zone DEFAULT now() NOT NULL
);
