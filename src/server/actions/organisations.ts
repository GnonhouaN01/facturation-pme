import "server-only";

import { schemaChangementOrganisation, schemaCreationOrganisation } from "@/schemas/organisation";

import { ROLES_DOUBLE_AUTH, type Role } from "../autorisation/matrice";
import { changerOrganisation, creerOrganisation } from "../services/organisations";

import { declarerActionCompte } from "./action";

// Les deux actions de compte de la 2.1 (UC-06, UC-11). Hors de la matrice :
// ouvertes à tout utilisateur connecté. La réponse dit seulement si le
// second facteur manque pour le rôle (S-12, S-13) : l'étape 7 de la chaîne
// refuse déjà toute donnée de l'organisation jusqu'à son activation. Fiche :
// docs/features/organisations.md, sections 4 et 5.

function doubleAuthentificationRequise(role: Role, doubleAuthentification: boolean): boolean {
  return ROLES_DOUBLE_AUTH.includes(role) && !doubleAuthentification;
}

export const creationOrganisation = declarerActionCompte({
  nom: "organisation.creer",
  entree: schemaCreationOrganisation,
  cible: "nouvelle_organisation",
  journal: "organisation.creee",
  debit: "organisation.creation",
  executer: async (ctx, entree) => {
    const organisationId = await creerOrganisation(ctx, entree.raisonSociale);
    await ctx.journaliser({ ressourceId: organisationId });
    return {
      organisationId,
      doubleAuthentificationRequise: doubleAuthentificationRequise(
        "proprietaire",
        ctx.doubleAuthentification,
      ),
    };
  },
});

export const changementOrganisation = declarerActionCompte({
  nom: "organisation.changer",
  entree: schemaChangementOrganisation,
  cible: "adhesion",
  journal: null,
  debit: "membre.action",
  executer: async (ctx) => {
    await changerOrganisation(ctx);
    return {
      doubleAuthentificationRequise:
        ctx.role !== null && doubleAuthentificationRequise(ctx.role, ctx.doubleAuthentification),
    };
  },
});
