import { z } from "zod";

import {
  JETON_REINITIALISATION,
  LONGUEUR_MAX_MOT_DE_PASSE,
  LONGUEUR_MAX_NOM,
  LONGUEUR_MIN_MOT_DE_PASSE,
} from "./regles-compte";

// Schémas des points d'entrée ouverts de /api/auth (1.1), partagés par les
// formulaires et le gestionnaire. Objets stricts : tout champ non prévu est
// refusé. Le serveur applique en plus la règle d'adresse de la porte d'envoi
// (src/server/email/adresse.ts). Fiche : docs/features/inscription.md,
// sections 2.2 et 5.2.

export { LONGUEUR_MAX_MOT_DE_PASSE, LONGUEUR_MAX_NOM, LONGUEUR_MIN_MOT_DE_PASSE };
const LONGUEUR_MAX_ADRESSE = 254;
const LONGUEUR_MAX_JETON = 1024;

// Caractères de contrôle C0, DEL et C1.
const SANS_CONTROLE = /^[^\u0000-\u001f\u007f-\u009f]*$/u;
// Jeton de vérification : un JWT, trois segments base64url non vides.
const JETON_VERIFICATION = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

const nom = z
  .string()
  .max(LONGUEUR_MAX_NOM)
  .regex(SANS_CONTROLE)
  .refine((valeur) => valeur.trim().length > 0);

const email = z.string().max(LONGUEUR_MAX_ADRESSE);

// La longueur minimale est vérifiée à part : un mot de passe trop court a sa
// propre raison (UC-01, 2a).
const motDePasse = z.string().max(LONGUEUR_MAX_MOT_DE_PASSE);

export const schemaInscription = z.strictObject({ nom, email, motDePasse });
export const schemaRenvoiVerification = z.strictObject({ email });
// Connexion (1.2) : ni rememberMe, ni callbackURL. Aucune longueur minimale :
// un mot de passe trop court reçoit la même réponse qu'un mauvais (T-07).
// Fiche : docs/features/connexion.md, section 1.1.
export const schemaConnexion = z.strictObject({
  email,
  motDePasse: z.string().min(1).max(LONGUEUR_MAX_MOT_DE_PASSE),
});
export const schemaDeconnexion = z.strictObject({});
export const schemaVerification = z.strictObject({
  jeton: z.string().max(LONGUEUR_MAX_JETON).regex(JETON_VERIFICATION),
});

// Mot de passe oublié (1.3) : la demande ne porte que l'adresse (ni
// redirectTo, ni callbackURL) ; la réinitialisation, le jeton lu dans le
// fragment du lien et le nouveau mot de passe, dont la longueur minimale est
// vérifiée à part (mot_de_passe_trop_court, jeton intact). Fiche :
// docs/features/mot-de-passe.md, section 2.1.
export const schemaDemandeReinitialisation = z.strictObject({ email });
export const schemaReinitialisation = z.strictObject({
  jeton: z.string().regex(JETON_REINITIALISATION),
  motDePasse,
});
