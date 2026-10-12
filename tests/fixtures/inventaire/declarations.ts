import { z } from "zod";

import { declarerAction, type DeclarationAction } from "@/server/actions/action";

// Déclarations de démonstration du test d'inventaire
// (src/server/actions/inventaire.test.ts). Hors de src/ : elles ne créent
// aucun point d'entrée et ne sont pas analysées par les règles de src/.

const schema = z.strictObject({});

export const demoAgir = declarerAction({
  nom: "demo.inventaire_agir",
  droit: "organisation.membres.voir",
  entree: schema,
  journal: null,
  nouvelleAuthentification: false,
  debit: null,
  emails: [],
  executer: async () => "fait",
});

export const demoAutre = declarerAction({
  nom: "demo.inventaire_autre",
  droit: "organisation.membres.voir",
  entree: schema,
  journal: null,
  nouvelleAuthentification: false,
  debit: null,
  emails: [],
  executer: async () => "fait",
});

// Mêmes champs, écrits à la main : aucune marque de declarerAction.
export const declarationALaMain: DeclarationAction<typeof schema, null, string> = {
  nom: "demo.inventaire_a_la_main",
  droit: "organisation.membres.voir",
  entree: schema,
  journal: null,
  nouvelleAuthentification: false,
  debit: null,
  emails: [],
  executer: async () => "fait",
};
