import "server-only";

import { validerEnvironnement } from "./env-schema";

// Seul fichier de src/ qui lit process.env (CLAUDE.md, règle 12).
export const env = validerEnvironnement(process.env);
