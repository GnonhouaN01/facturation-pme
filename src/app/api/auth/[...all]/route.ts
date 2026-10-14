// Points d'entrée de Better Auth (1.1). Forme exacte, vérifiée par le test
// d'inventaire : tout le contrôle vit dans src/server/auth/ (liste fermée,
// origine, validation, réponses normalisées). Fiche :
// docs/features/inscription.md, section 2.
import { traiterRequeteAuth } from "@/server/auth/gestionnaire";

export const GET = traiterRequeteAuth;
export const POST = traiterRequeteAuth;
