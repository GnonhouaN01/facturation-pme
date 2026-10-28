// Logo de l'organisation active, servi à ses membres (2.2). Forme exacte,
// vérifiée par le test d'inventaire : tout le contrôle vit dans
// src/server/actions/exposer.ts. Fiche :
// docs/features/parametres-organisation.md, section 5.
import { servirLogo } from "@/server/actions/exposer";

export const GET = servirLogo;
