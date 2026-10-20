import { z } from "zod";

import { champNom } from "./compte";
import { LONGUEUR_MAX_MOT_DE_PASSE } from "./regles-compte";

// Schémas des quatre points du profil et des sessions (1.5). Objets stricts :
// ni token, ni revokeOtherSessions, ni currentPassword, ni newPassword, ni
// name, ni image, ni email (noms de Better Auth). Une session se désigne par
// son identifiant, jamais par son jeton. La longueur minimale du nouveau mot
// de passe est vérifiée à part (mot_de_passe_trop_court). Fiche :
// docs/features/profil-sessions.md, section 2.1.

const motDePasse = z.string().min(1).max(LONGUEUR_MAX_MOT_DE_PASSE);

export const schemaRevocationSession = z.strictObject({ session: z.uuid() });
export const schemaRevocationAutresSessions = z.strictObject({});
export const schemaChangementMotDePasse = z.strictObject({
  motDePasseActuel: motDePasse,
  nouveauMotDePasse: motDePasse,
});
export const schemaModificationNom = z.strictObject({ nom: champNom });
