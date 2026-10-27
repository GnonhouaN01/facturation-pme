import { z } from "zod";

import {
  LONGUEUR_MAX_SAISIE_RAISON_SOCIALE,
  normaliserRaisonSociale,
  raisonSocialeValide,
} from "./regles-organisation";

// Entrées des deux actions de compte de la 2.1 : créer une organisation et
// en changer. Objets stricts : ni organisationId à la création (tiré par la
// chaîne), ni rôle, ni slug, ni utilisateur. Fiche :
// docs/features/organisations.md, sections 4 et 5.

export { LONGUEUR_MAX_RAISON_SOCIALE } from "./regles-organisation";

const raisonSociale = z
  .string()
  .max(LONGUEUR_MAX_SAISIE_RAISON_SOCIALE)
  .refine(raisonSocialeValide)
  .transform(normaliserRaisonSociale);

export const schemaCreationOrganisation = z.strictObject({ raisonSociale });

export const schemaChangementOrganisation = z.strictObject({ organisationId: z.uuid() });
