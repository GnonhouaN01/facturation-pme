import "server-only";

import type { TransactionOrganisation } from "../db/client";
import { organisationsDuCompte, type OrganisationDuCompte } from "../db/organisations";
import {
  activerOrganisation,
  insererAdhesion,
  insererOrganisation,
  nomOrganisationActive,
} from "../db/requetes/organisations";

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

// Dans la transaction de la nouvelle organisation : l'organisation, son
// Propriétaire, puis l'organisation active de la session. La trace est
// écrite par l'action, dans la même transaction.
export async function creerOrganisation(ctx: ContexteService, nom: string): Promise<string> {
  const organisationId = await insererOrganisation(ctx.tx, nom);
  if (organisationId !== ctx.organisationId) throw new Error("Organisation inattendue.");
  await insererAdhesion(ctx.tx, ctx.utilisateurId, ROLE_CREATEUR);
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
