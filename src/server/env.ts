import "server-only";

import { validerConfigurationEmail, validerEnvironnement, validerSecretTache } from "./env-schema";

// Seul fichier de src/ qui lit process.env (CLAUDE.md, règle 12).
export const env = validerEnvironnement(process.env);

// Configuration de l'envoi d'emails. Invalide, elle fait échouer le
// chargement de ce module, comme une variable de env (fiche
// docs/features/envoi-emails.md, section 2.2).
export const configurationEmail = validerConfigurationEmail(process.env);

// Secret de la tâche quotidienne, lu en dernier : obligatoire en production,
// absent ailleurs (la tâche refuse alors tout appel). Fiche :
// docs/features/tache-quotidienne.md, section 2.3.
export const secretTache = validerSecretTache(process.env);
