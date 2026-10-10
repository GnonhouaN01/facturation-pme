import "server-only";

import type { DeclarationQuelconque } from "./action";

// Liste de toutes les actions déclarées. Toute action exposée y figure
// (vérifié par inventaire.test.ts), et chacune est testée pour chacun des
// quatre rôles (registre.integration.test.ts). Vide en 0.4. Fiche :
// docs/features/chaine-controles.md, sections 7 et 8.4.
export const REGISTRE = [] as const satisfies readonly DeclarationQuelconque[];

export type NomAction = (typeof REGISTRE)[number]["nom"];
