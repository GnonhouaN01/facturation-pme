// Tâche quotidienne, appelée par Vercel Cron (vercel.json). Forme exacte,
// vérifiée par le test d'inventaire : tout le contrôle vit dans
// src/server/taches/quotidienne.ts. Fiche : docs/features/tache-quotidienne.md.
import { traiterTache } from "@/server/taches/quotidienne";

export const GET = traiterTache;
