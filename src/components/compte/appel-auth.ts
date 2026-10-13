// Appel d'un point d'entrée ouvert de /api/auth depuis le navigateur : POST,
// corps JSON, même origine (le navigateur pose Origin, que le serveur
// vérifie). La réponse est l'une de la liste fermée du gestionnaire
// (src/server/auth/points-entree.ts) ; toute autre forme, ou un échec du
// réseau, devient « erreur ». Fiche : docs/features/inscription.md,
// sections 2.2 et 5.1.

export type RaisonAuth =
  | "mot_de_passe_trop_court"
  | "mot_de_passe_compromis"
  | "invalide"
  | "trop_de_requetes"
  | "lien_invalide"
  | "refuse"
  | "erreur";

export type ReponseAuth = { ok: true } | { ok: false; raison: RaisonAuth };

const RAISONS: ReadonlySet<string> = new Set<RaisonAuth>([
  "mot_de_passe_trop_court",
  "mot_de_passe_compromis",
  "invalide",
  "trop_de_requetes",
  "lien_invalide",
  "refuse",
  "erreur",
]);

export type PointAuth = "/sign-up/email" | "/send-verification-email" | "/verify-email";

export async function appelerAuth(point: PointAuth, corps: unknown): Promise<ReponseAuth> {
  try {
    const reponse = await fetch(`/api/auth${point}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
      credentials: "same-origin",
      cache: "no-store",
    });
    const lu: unknown = await reponse.json();
    if (typeof lu === "object" && lu !== null) {
      if ("ok" in lu && lu.ok === true) return { ok: true };
      if ("raison" in lu && typeof lu.raison === "string" && RAISONS.has(lu.raison)) {
        return { ok: false, raison: lu.raison as RaisonAuth };
      }
    }
  } catch {
    // Réseau coupé ou corps illisible : erreur générique ci-dessous.
  }
  return { ok: false, raison: "erreur" };
}
