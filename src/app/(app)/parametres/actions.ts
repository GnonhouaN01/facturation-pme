"use server";

import { exposer } from "@/server/actions/exposer";
import {
  ajoutTaux,
  enregistrementFiche,
  enregistrementLogo,
  etatTaux,
  instructionsPaiement,
  retraitLogo,
} from "@/server/actions/parametres";

// Actions de la page /parametres (2.2), par la chaîne de contrôles
// (docs/features/parametres-organisation.md, section 10).
export const enregistrerFiche = exposer(enregistrementFiche);
export const ajouterTaux = exposer(ajoutTaux);
export const changerEtatTaux = exposer(etatTaux);
export const enregistrerLogo = exposer(enregistrementLogo);
export const retirerLogo = exposer(retraitLogo);
export const enregistrerInstructions = exposer(instructionsPaiement);
