// Appel d'un point d'entrée ouvert de /api/auth depuis le navigateur : POST,
// corps JSON, même origine (le navigateur pose Origin, que le serveur
// vérifie). La réponse est l'une de la liste fermée du gestionnaire
// (src/server/auth/points-entree.ts) ; toute autre forme, ou un échec du
// réseau, devient « erreur ». L'identifiant d'incident d'une erreur n'est
// gardé que s'il a la forme d'un UUID (S-85). Fiches :
// docs/features/inscription.md, sections 2.2 et 5.1 ;
// docs/features/connexion.md, section 6. Double authentification (1.4) :
// cinq raisons de plus, l'étape du code de la connexion, et la remise unique
// de l'activation (matrice du code QR, clé, codes) ou des nouveaux codes,
// lues seulement à la bonne forme. Fiche :
// docs/features/double-authentification.md, sections 2.4 et 3.4.

import { CODE_SECOURS } from "@/schemas/regles-compte";

export type RaisonAuth =
  | "mot_de_passe_trop_court"
  | "mot_de_passe_compromis"
  | "invalide"
  | "identifiants_incorrects"
  | "trop_de_requetes"
  | "lien_invalide"
  | "refuse"
  | "erreur"
  | "code_incorrect"
  | "connexion_expiree"
  | "connexion_requise"
  | "mot_de_passe_incorrect"
  | "double_authentification_obligatoire";

export type Activation = { qr: string[]; cle: string; codes: string[] };

export type ReponseAuth =
  | { ok: true; etape?: "code"; activation?: Activation; codes?: string[] }
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
  "code_incorrect",
  "connexion_expiree",
  "connexion_requise",
  "mot_de_passe_incorrect",
  "double_authentification_obligatoire",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

// 1.3 : demande et réinitialisation du mot de passe
// (docs/features/mot-de-passe.md, section 7).
export type PointAuth =
  | "/sign-up/email"
  | "/send-verification-email"
  | "/verify-email"
  | "/sign-in/email"
  | "/sign-out"
  | "/request-password-reset"
  | "/reset-password"
  // 1.4.
  | "/two-factor/verify-totp"
  | "/two-factor/verify-backup-code"
  | "/two-factor/enable"
  | "/two-factor/confirm-enable"
  | "/two-factor/replace"
  | "/two-factor/generate-backup-codes"
  | "/two-factor/disable";

const LIGNE_QR = /^[01]+$/u;
const CLE = /^[A-Z2-7]{1,4}( [A-Z2-7]{1,4})*$/u;

function codesValides(valeur: unknown): valeur is string[] {
  return (
    Array.isArray(valeur) &&
    valeur.length === 10 &&
    valeur.every((code) => typeof code === "string" && CODE_SECOURS.test(code))
  );
}

function matriceValide(valeur: unknown): valeur is string[] {
  return (
    Array.isArray(valeur) &&
    valeur.length > 0 &&
    valeur.every(
      (ligne) =>
        typeof ligne === "string" && ligne.length === valeur.length && LIGNE_QR.test(ligne),
    )
  );
}

// Un succès : l'étape du code, l'activation ou les nouveaux codes ; toute
// autre forme d'une de ces valeurs est une erreur.
function succes(lu: object): ReponseAuth {
  const valeurs = lu as Record<string, unknown>;
  if ("qr" in valeurs || "cle" in valeurs) {
    const { qr, cle, codes } = valeurs;
    if (!matriceValide(qr) || typeof cle !== "string" || !CLE.test(cle) || !codesValides(codes)) {
      return { ok: false, raison: "erreur" };
    }
    return { ok: true, activation: { qr, cle, codes } };
  }
  if ("codes" in valeurs) {
    return codesValides(valeurs.codes)
      ? { ok: true, codes: valeurs.codes }
      : { ok: false, raison: "erreur" };
  }
  return valeurs.etape === "code" ? { ok: true, etape: "code" } : { ok: true };
}

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
      if ("ok" in lu && lu.ok === true) return succes(lu);
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
