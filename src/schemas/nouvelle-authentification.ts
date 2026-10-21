import { z } from "zod";

import { LONGUEUR_MAX_CODE_SAISI, LONGUEUR_MAX_MOT_DE_PASSE } from "./regles-compte";

// Schéma du point de la nouvelle authentification (1.6). Objet strict : ni
// password (nom de Better Auth), ni session, ni utilisateur, ni durée, ni
// trustDevice. Le code est celui de l'application ou un code de secours,
// exigé si le second facteur est actif et refusé sinon (vérifié par la
// passerelle, qui connaît l'état). Fiche :
// docs/features/nouvelle-authentification.md, section 2.
export const schemaNouvelleAuthentification = z.strictObject({
  motDePasse: z.string().min(1).max(LONGUEUR_MAX_MOT_DE_PASSE),
  code: z.string().min(1).max(LONGUEUR_MAX_CODE_SAISI).optional(),
});
