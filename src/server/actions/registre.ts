import "server-only";

import type { DeclarationCompteQuelconque, DeclarationQuelconque } from "./action";
import { changementOrganisation, creationOrganisation } from "./organisations";

// Liste de toutes les actions déclarées. Toute action exposée y figure
// (vérifié par inventaire.test.ts), et chacune est testée pour chacun des
// quatre rôles (registre.integration.test.ts). Vide en 0.4. Fiche :
// docs/features/chaine-controles.md, sections 7 et 8.4.
export const REGISTRE = [] as const satisfies readonly DeclarationQuelconque[];

export type NomAction = (typeof REGISTRE)[number]["nom"];

// Actions de compte (2.1), sans organisation active ni adhésion au départ :
// hors de la matrice, chacune a son cas dans registre.integration.test.ts.
// Fiche : docs/features/organisations.md, section 3.
export const REGISTRE_COMPTE = [
  creationOrganisation,
  changementOrganisation,
] as const satisfies readonly DeclarationCompteQuelconque[];

export type NomActionCompte = (typeof REGISTRE_COMPTE)[number]["nom"];
