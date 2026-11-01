import "server-only";

import { TEXTES_PARAMETRES } from "@/textes/parametres";

import type { TransactionOrganisation } from "../db/client";
import { organisationsDuCompte, type OrganisationDuCompte } from "../db/organisations";
import {
  activerOrganisation,
  insererAdhesion,
  insererOrganisation,
  nomOrganisationActive,
} from "../db/requetes/organisations";
import { insererParametresParDefaut, insererTauxParDefaut } from "../db/requetes/parametres";

// Règles de la 2.1 : créer une organisation, en changer, lire celles du
// compte et le nom de l'organisation active. Chaque fonction reçoit la
// transaction de la chaîne, qu'elle n'ouvre pas, sauf la lecture du compte,
// faite hors de toute organisation. Fiche : docs/features/organisations.md,
// sections 4 à 6.

// Le rôle du créateur (R2 de la 0.4, docs/features/chaine-controles.md,
// section 1.2).
export const ROLE_CREATEUR = "proprietaire";

type ContexteService = {
  tx: TransactionOrganisation;
  utilisateurId: string;
  sessionId: string;
  organisationId: string;
};

// 2.2 : taux créés avec l'organisation (UC-06 étape 2, F-051 : 18 % par
// défaut, 0 % pour les exonérations). Fiche :
// docs/features/parametres-organisation.md, section 2.
export const TAUX_PAR_DEFAUT = [
  { libelle: TEXTES_PARAMETRES.tauxParDefaut.normal, tauxCentiemes: 1800 },
  { libelle: TEXTES_PARAMETRES.tauxParDefaut.exoneration, tauxCentiemes: 0 },
] as const;

// Dans la transaction de la nouvelle organisation : l'organisation, son
// Propriétaire, ses paramètres et ses taux par défaut (2.2), puis
// l'organisation active de la session. La trace est écrite par l'action,
// dans la même transaction.
export async function creerOrganisation(ctx: ContexteService, nom: string): Promise<string> {
  const organisationId = await insererOrganisation(ctx.tx, nom);
  if (organisationId !== ctx.organisationId) throw new Error("Organisation inattendue.");
  await insererAdhesion(ctx.tx, ctx.utilisateurId, ROLE_CREATEUR);
  await insererParametresParDefaut(ctx.tx);
  await insererTauxParDefaut(ctx.tx, TAUX_PAR_DEFAUT);
  await activerOrganisation(ctx.tx, ctx.sessionId, ctx.utilisateurId);
  return organisationId;
}

// Dans la transaction de l'organisation choisie, adhésion déjà relue par la
// chaîne.
export async function changerOrganisation(ctx: ContexteService): Promise<void> {
  await activerOrganisation(ctx.tx, ctx.sessionId, ctx.utilisateurId);
}

export type { OrganisationDuCompte };

export function lireOrganisationsDuCompte(utilisateurId: string): Promise<OrganisationDuCompte[]> {
  return organisationsDuCompte(utilisateurId);
}

export function lireNomOrganisationActive(tx: TransactionOrganisation): Promise<string | null> {
  return nomOrganisationActive(tx);
}
