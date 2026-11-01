import "server-only";

import {
  schemaAjoutTaux,
  schemaEtatTaux,
  schemaFiche,
  schemaInstructions,
  schemaLogo,
  schemaRetraitLogo,
} from "@/schemas/parametres";

import {
  ajouterTaux,
  enregistrerFiche,
  enregistrerInstructions,
  enregistrerLogo,
  modifierEtatTaux,
  supprimerLogo,
} from "../services/parametres";

import { declarerAction } from "./action";

// Les six actions de la 2.2 (UC-07), réservées au Propriétaire par la
// matrice. Chaque enregistrement est tracé ; seules les instructions de
// paiement demandent une nouvelle authentification (S-14) et préviennent
// chaque Propriétaire, seulement quand elles changent réellement (S-33,
// décision 5 du développeur). Fiche :
// docs/features/parametres-organisation.md, sections 3 à 6 et 10.

const FICHE = "organisation.fiche.modifier";
const PARAMETRES_MODIFIES = "organisation.parametres_modifies";

export const enregistrementFiche = declarerAction({
  nom: "parametres.fiche",
  droit: FICHE,
  entree: schemaFiche,
  journal: PARAMETRES_MODIFIES,
  nouvelleAuthentification: false,
  debit: "membre.action",
  emails: [],
  executer: async (ctx, fiche) => {
    await enregistrerFiche(ctx, fiche);
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    return null;
  },
});

export const ajoutTaux = declarerAction({
  nom: "parametres.taux.ajouter",
  droit: FICHE,
  entree: schemaAjoutTaux,
  journal: PARAMETRES_MODIFIES,
  nouvelleAuthentification: false,
  debit: "membre.action",
  emails: [],
  executer: async (ctx, entree) => {
    await ajouterTaux(ctx, { libelle: entree.libelle, tauxCentiemes: entree.taux });
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    return null;
  },
});

export const etatTaux = declarerAction({
  nom: "parametres.taux.etat",
  droit: FICHE,
  entree: schemaEtatTaux,
  journal: PARAMETRES_MODIFIES,
  nouvelleAuthentification: false,
  debit: "membre.action",
  emails: [],
  executer: async (ctx, entree) => {
    await modifierEtatTaux(ctx, entree);
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    return null;
  },
});

export const enregistrementLogo = declarerAction({
  nom: "parametres.logo.enregistrer",
  droit: FICHE,
  entree: schemaLogo,
  journal: PARAMETRES_MODIFIES,
  nouvelleAuthentification: false,
  debit: "membre.action",
  emails: [],
  executer: async (ctx, entree) => {
    await enregistrerLogo(ctx, entree.contenu);
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    return null;
  },
});

export const retraitLogo = declarerAction({
  nom: "parametres.logo.retirer",
  droit: FICHE,
  entree: schemaRetraitLogo,
  journal: PARAMETRES_MODIFIES,
  nouvelleAuthentification: false,
  debit: "membre.action",
  emails: [],
  executer: async (ctx) => {
    await supprimerLogo(ctx);
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    return null;
  },
});

// Trace à chaque validation (la tentative est une information) ; email à
// chaque Propriétaire, raison sociale seule, sur un changement réel.
export const instructionsPaiement = declarerAction({
  nom: "parametres.instructions_paiement",
  droit: "organisation.instructions_paiement.modifier",
  entree: schemaInstructions,
  journal: "organisation.instructions_paiement_modifiees",
  nouvelleAuthentification: true,
  debit: "membre.action",
  emails: ["organisation.instructions_paiement_modifiees"],
  executer: async (ctx, instructions) => {
    const resultat = await enregistrerInstructions(ctx, instructions);
    await ctx.journaliser({ ressourceId: ctx.organisationId });
    if (resultat.modifiees) {
      for (const destinataire of resultat.destinataires) {
        ctx.preparerEmail({
          modele: "organisation.instructions_paiement_modifiees",
          destinataire,
          parametres: { organisation: resultat.organisation },
        });
      }
    }
    return { modifiees: resultat.modifiees };
  },
});
