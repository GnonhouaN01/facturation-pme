import { z } from "zod";

import { CODE_TOTP, LONGUEUR_MAX_CODE_SAISI, LONGUEUR_MAX_MOT_DE_PASSE } from "./regles-compte";

// Schémas des sept points de la double authentification (1.4). Objets
// stricts : ni trustDevice, ni disableSession, ni method, ni issuer, ni
// password (nom de Better Auth). Le code de secours est normalisé et vérifié
// par la passerelle (normaliserCodeSecours) ; un code de gestion est soit
// celui de l'application, soit un code de secours. Fiche :
// docs/features/double-authentification.md, section 2.1.

const codeApplication = z.string().regex(CODE_TOTP);
const codeSaisi = z.string().min(1).max(LONGUEUR_MAX_CODE_SAISI);
const motDePasse = z.string().min(1).max(LONGUEUR_MAX_MOT_DE_PASSE);

export const schemaCodeConnexion = z.strictObject({ code: codeApplication });
export const schemaCodeSecoursConnexion = z.strictObject({ code: codeSaisi });
export const schemaActivation = z.strictObject({ motDePasse });
export const schemaConfirmation = z.strictObject({ code: codeApplication });
export const schemaGestion = z.strictObject({ motDePasse, code: codeSaisi });
