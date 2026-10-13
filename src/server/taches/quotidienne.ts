import "server-only";

import { secretTache } from "../env";

import { ETAPES, executerEtapes } from "./etapes";
import { secretValide } from "./secret";

// Le gestionnaire de /api/taches/[tache], appelé par Vercel Cron une fois par
// jour avec Authorization: Bearer <CRON_SECRET>. Son propre contrôle tient
// lieu de chaîne : le secret remplace session et rôle ; rien d'autre n'est lu
// (ni paramètre, ni corps, ni cookie, ni User-Agent). Un appel refusé et un
// appel vers une tâche inconnue reçoivent reponseInexistante(), octet pour
// octet ; aucune tâche n'est lancée, rien n'est écrit au journal. Fiche :
// docs/features/tache-quotidienne.md, sections 2 et 3.

// Renvoie vrai si toutes les étapes ont réussi.
export type Tache = () => Promise<boolean>;

export type ContexteTache = { params: Promise<{ tache: string }> };

const SANS_CACHE = { "Cache-Control": "no-store" } as const;

// Seule réponse d'un refus ou d'une tâche inconnue : 404, corps vide.
export function reponseInexistante(): Response {
  return new Response(null, { status: 404, headers: SANS_CACHE });
}

export function creerTraitementTache(options: {
  secret: string | null;
  taches: Readonly<Record<string, Tache>>;
}): (requete: Request, contexte: ContexteTache) => Promise<Response> {
  const { secret, taches } = options;
  return async (requete, contexte) => {
    // Toujours calculé, que la tâche existe ou non.
    const autorise = secretValide(requete.headers.get("authorization"), secret);
    const { tache: nom } = await contexte.params;
    const tache = Object.hasOwn(taches, nom) ? taches[nom] : undefined;
    if (!autorise || tache === undefined) return reponseInexistante();

    const reussie = await tache();
    return Response.json({ ok: reussie }, { status: reussie ? 200 : 500, headers: SANS_CACHE });
  };
}

// Liste fermée des tâches. Le nom figure aussi dans vercel.json.
export const TACHES: Readonly<Record<string, Tache>> = Object.freeze({
  quotidienne: () => executerEtapes(ETAPES),
});

export const traiterTache = creerTraitementTache({ secret: secretTache.secret, taches: TACHES });
