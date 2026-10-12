import "server-only";

import { validerConfigurationEmail, validerEnvironnement } from "./env-schema";

// Seul fichier de src/ qui lit process.env (CLAUDE.md, règle 12).
export const env = validerEnvironnement(process.env);

// Configuration de l'envoi d'emails. Invalide, elle fait échouer le
// chargement de ce module, comme une variable de env (fiche
// docs/features/envoi-emails.md, section 2.2).
export const configurationEmail = validerConfigurationEmail(process.env);
