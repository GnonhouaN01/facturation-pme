// Appel d'un point d'entrée ouvert de /api/auth depuis le navigateur : POST,
// corps JSON, même origine (le navigateur pose Origin, que le serveur
// vérifie). La réponse est l'une de la liste fermée du gestionnaire
// (src/server/auth/points-entree.ts) ; toute autre forme, ou un échec du
// réseau, devient « erreur ». L'identifiant d'incident d'une erreur n'est
// gardé que s'il a la forme d'un UUID (S-85). Fiches :
// docs/features/inscription.md, sections 2.2 et 5.1 ;
// docs/features/connexion.md, section 6.

export type RaisonAuth =
  | "mot_de_passe_trop_court"
  | "mot_de_passe_compromis"
  | "invalide"
  | "identifiants_incorrects"
  | "trop_de_requetes"
  | "lien_invalide"
  | "refuse"
  | "erreur";

export type ReponseAuth =
  | { ok: true }
  | { ok: false; raison: Exclude<RaisonAuth, "erreur"> }
  | { ok: false; raison: "erreur"; incident?: string };

const RAISONS: ReadonlySet<string> = new Set<RaisonAuth>([
  "mot_de_passe_trop_court",
  "mot_de_passe_compromis",
  "invalide",
  "identifiants_incorrects",
  "trop_de_requetes",
  "lien_invalide",
  "refuse",
  "erreur",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type PointAuth =
  "/sign-up/email" | "/send-verification-email" | "/verify-email" | "/sign-in/email" | "/sign-out";

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
        if (lu.raison !== "erreur") {
          return { ok: false, raison: lu.raison as Exclude<RaisonAuth, "erreur"> };
        }
        const incident = "incident" in lu ? lu.incident : undefined;
        return typeof incident === "string" && UUID.test(incident)
          ? { ok: false, raison: "erreur", incident }
          : { ok: false, raison: "erreur" };
      }
    }
  } catch {
    // Réseau coupé ou corps illisible : erreur générique ci-dessous.
  }
  return { ok: false, raison: "erreur" };
}
