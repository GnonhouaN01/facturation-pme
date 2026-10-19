import "server-only";

import { createHash } from "node:crypto";

import type { z } from "zod";

import {
  schemaActivation,
  schemaCodeConnexion,
  schemaCodeSecoursConnexion,
  schemaConfirmation,
  schemaGestion,
} from "@/schemas/double-authentification";
import { CODE_SECOURS, CODE_TOTP, normaliserCodeSecours } from "@/schemas/regles-compte";

// Les sept points de la double authentification de /api/auth (1.4), composés
// par notre passerelle sur les points de l'extension twoFactor de Better
// Auth : un cookie par usage (celui de la connexion en attente pour la
// connexion, celui de la session pour la gestion), corps de Better Auth
// jamais transmis (seuls la matrice du code QR, la clé et les codes, une
// fois), limites par compte et de gestion, anti-rejeu par la dernière tranche
// acceptée, mot de passe vérifié avant le code, désactivation refusée à un
// rôle exigeant, autres sessions fermées après un changement, emails. Les
// contrôles communs (origine, taille, type, schéma strict, production) sont
// ceux de points-entree.ts. Fiche : docs/features/double-authentification.md,
// sections 2 à 10.

export type SessionGestion = {
  utilisateurId: string;
  // user.two_factor_enabled, relu avec la session.
  doubleAuthentification: boolean;
  jeton: string;
};

// La ligne two_factor du compte : absente, en attente de confirmation
// (activation ou remplacement en cours), ou active.
export type EtatLigne = "aucune" | "a_confirmer" | "active";

export type ModeleDoubleAuth =
  | "compte.double_auth_activee"
  | "compte.double_auth_desactivee"
  | "compte.double_auth_remplacee"
  | "compte.codes_secours_regeneres"
  | "compte.code_secours_utilise"
  | "compte.double_auth_tentatives";

export type DependancesDoubleAuth = {
  // La session du cookie reçu, relue en base ; null si absente, expirée ou
  // d'un utilisateur non vérifié.
  lireSession: (entetes: Headers) => Promise<SessionGestion | null>;
  etatLigne: (utilisateurId: string) => Promise<EtatLigne>;
  // L'utilisateur d'une connexion en attente, par l'identifiant lu dans le
  // cookie (la ligne est cherchée sous son empreinte) ; null si absente ou
  // expirée.
  utilisateurDuDefi: (identifiant: string) => Promise<string | null>;
  // auth.double_auth_compte et auth.double_auth_gestion : vrai si admis.
  limiterConnexion: (utilisateurId: string) => Promise<boolean>;
  limiterGestion: (utilisateurId: string) => Promise<boolean>;
  // Décision 4 : la tranche du code est calculée (secret déchiffré) et
  // réservée pour le compte ; « aucune » si le code ne correspond à aucune
  // tranche de la fenêtre (code faux : Better Auth compte l'échec).
  reserverTranche: (
    utilisateurId: string,
    code: string,
  ) => Promise<"reservee" | "deja_utilisee" | "aucune">;
  motDePasseValide: (utilisateurId: string, motDePasse: string) => Promise<boolean>;
  // Propriétaire ou Comptable dans au moins une organisation.
  aRoleExigeant: (utilisateurId: string) => Promise<boolean>;
  // Ligne two_factor marquée non vérifiée, avant la nouvelle activation.
  preparerRemplacement: (utilisateurId: string) => Promise<void>;
  revoquerAutresSessions: (utilisateurId: string, jetonGarde: string) => Promise<void>;
  // Empreinte d'un code de secours normalisé (codes-secours.ts).
  empreinteCodeSecours: (code: string) => string;
  matriceQr: (texte: string) => string[];
  // Planifie l'email, après la réponse ; ne doit pas lever.
  notifier: (modele: ModeleDoubleAuth, utilisateurId: string) => void;
};

export type RaisonDoubleAuth =
  | "code_incorrect"
  | "connexion_expiree"
  | "connexion_requise"
  | "mot_de_passe_incorrect"
  | "double_authentification_obligatoire"
  | "trop_de_requetes"
  | "refuse"
  | "invalide"
  | "erreur";

export type ResultatCompose =
  { raison: RaisonDoubleAuth } | { ok: true; cookies: string[]; donnees?: Record<string, unknown> };

export type ReponseBetterAuth = {
  statut: number;
  code: string | null;
  cookies: string[];
  corps: unknown;
};

export type OutilsPoint = {
  entetes: Headers;
  origine: string;
  // Un appel interne à Better Auth, avec le seul cookie donné.
  appeler: (
    chemin: string,
    corps: Record<string, unknown>,
    cookie: string | null,
  ) => Promise<ReponseBetterAuth>;
  // La révocation de la session du cookie reçu (correctif de la 1.2).
  revoquerSessionRecue: () => Promise<void>;
  dependances: DependancesDoubleAuth;
};

export type PointCompose = {
  methode: "POST";
  schema: z.ZodType;
  executer: (donnees: Record<string, unknown>, outils: OutilsPoint) => Promise<ResultatCompose>;
};

// Les chemins de Better Auth que ces points appellent (limites par adresse
// IP, debit/better-auth.ts).
export const CHEMINS_INTERNES_DOUBLE_AUTH = [
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/enable",
  "/two-factor/generate-backup-codes",
  "/two-factor/disable",
] as const;

// Noms des cookies de Better Auth : préfixe __Secure- en https.
function nomCookie(base: string, origine: string): string {
  return new URL(origine).protocol === "https:" ? `__Secure-${base}` : base;
}
export function nomCookieSession(origine: string): string {
  return nomCookie("better-auth.session_token", origine);
}
export function nomCookieAttente(origine: string): string {
  return nomCookie("better-auth.two_factor", origine);
}

// La paire « nom=valeur » exacte d'un cookie de l'en-tête reçu, par son nom ;
// null si absente ou vide.
export function extraireCookie(entete: string | null, nom: string): string | null {
  if (entete === null) return null;
  for (const morceau of entete.split(";")) {
    const egal = morceau.indexOf("=");
    if (egal < 0 || morceau.slice(0, egal).trim() !== nom) continue;
    const valeur = morceau.slice(egal + 1).trim();
    return valeur === "" ? null : `${nom}=${valeur}`;
  }
  return null;
}

// La valeur signée « valeur.signature » d'une paire, décodée, sans la
// signature (vérifiée par Better Auth) ; null si mal formée.
function sansSignature(valeurEncodee: string): string | null {
  let valeur: string;
  try {
    valeur = decodeURIComponent(valeurEncodee);
  } catch {
    return null;
  }
  const point = valeur.lastIndexOf(".");
  return point > 0 ? valeur.slice(0, point) : null;
}

export function identifiantAttente(paire: string): string | null {
  return sansSignature(paire.slice(paire.indexOf("=") + 1));
}

// Le nom d'un en-tête Set-Cookie, et sa valeur.
function lireSetCookie(cookie: string): { nom: string; valeur: string } {
  const paire = cookie.split(";")[0] ?? "";
  const egal = paire.indexOf("=");
  return egal < 0
    ? { nom: paire.trim(), valeur: "" }
    : { nom: paire.slice(0, egal).trim(), valeur: paire.slice(egal + 1).trim() };
}

// Le jeton du cookie de session posé par une réponse, ou null.
export function jetonDuSetCookie(cookies: readonly string[], nom: string): string | null {
  for (const cookie of cookies) {
    const lu = lireSetCookie(cookie);
    if (lu.nom === nom && lu.valeur !== "") return sansSignature(lu.valeur);
  }
  return null;
}

// verification.storeIdentifier pour les identifiants 2fa-... : la base ne
// contient jamais l'identifiant porté par le cookie. Préfixe distinct de
// 2fa- : Better Auth essaie aussi la forme en clair (comme pour la 1.3).
export const PREFIXE_EMPREINTE_ATTENTE = "double-auth:";

export async function empreinteAttenteDoubleAuth(identifiant: string): Promise<string> {
  return `${PREFIXE_EMPREINTE_ATTENTE}${createHash("sha256").update(identifiant).digest("base64url")}`;
}

const SECRET_BASE32 = /^[A-Z2-7]{16,128}$/u;

function codesValides(valeur: unknown): valeur is string[] {
  return (
    Array.isArray(valeur) &&
    valeur.length === 10 &&
    valeur.every((code) => typeof code === "string" && CODE_SECOURS.test(code))
  );
}

// La remise unique de l'activation, lue dans le corps de Better Auth et
// vérifiée (S-87) : matrice du code QR, clé groupée par 4, dix codes. Jamais
// totpURI en entier. Hors forme : null.
export function lireActivation(
  corps: unknown,
  matriceQr: (texte: string) => string[],
): { qr: string[]; cle: string; codes: string[] } | null {
  if (typeof corps !== "object" || corps === null) return null;
  const { totpURI, backupCodes } = corps as { totpURI?: unknown; backupCodes?: unknown };
  if (typeof totpURI !== "string" || !totpURI.startsWith("otpauth://totp/")) return null;
  let secret: string | null;
  try {
    secret = new URL(totpURI).searchParams.get("secret");
  } catch {
    return null;
  }
  if (secret === null || !SECRET_BASE32.test(secret) || !codesValides(backupCodes)) return null;
  return {
    qr: matriceQr(totpURI),
    cle: (secret.match(/.{1,4}/gu) ?? []).join(" "),
    codes: backupCodes,
  };
}

function reussi(lue: ReponseBetterAuth): boolean {
  return lue.statut >= 200 && lue.statut < 300;
}

// Codes d'erreur de l'extension twoFactor et du noyau, traduits en une liste
// fermée ; tout le reste est « erreur ».
function traduire(lue: ReponseBetterAuth): { raison: RaisonDoubleAuth } {
  switch (lue.code) {
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
    case "TOTP_NOT_ENABLED":
      return { raison: "code_incorrect" };
    case "INVALID_TWO_FACTOR_COOKIE":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return { raison: "connexion_expiree" };
    case "ACCOUNT_TEMPORARILY_LOCKED":
      return { raison: "trop_de_requetes" };
    case "INVALID_PASSWORD":
      return { raison: "mot_de_passe_incorrect" };
    case "UNAUTHORIZED":
      return { raison: "connexion_requise" };
    default:
      break;
  }
  if (lue.statut === 429) return { raison: "trop_de_requetes" };
  // Usage simultané d'un même code de secours : l'autre requête a gagné.
  if (lue.statut === 409) return { raison: "code_incorrect" };
  return { raison: "erreur" };
}

// L'email ne change jamais la réponse : la porte consigne elle-même ses
// échecs.
function notifier(
  dependances: DependancesDoubleAuth,
  modele: ModeleDoubleAuth,
  utilisateurId: string,
): void {
  try {
    dependances.notifier(modele, utilisateurId);
  } catch {
    // Planification impossible : aucune suite.
  }
}

// Les cookies de session posés par une réponse, non vides.
function cookiesSession(lue: ReponseBetterAuth, origine: string): string[] {
  const nom = nomCookieSession(origine);
  return lue.cookies.filter((cookie) => {
    const lu = lireSetCookie(cookie);
    return lu.nom === nom && lu.valeur !== "";
  });
}

type Code = { sorte: "application"; valeur: string } | { sorte: "secours"; valeur: string };

// Un code de gestion : celui de l'application, ou un code de secours
// normalisé ; sinon null.
function lireCode(saisie: unknown): Code | null {
  const texte = String(saisie);
  if (CODE_TOTP.test(texte)) return { sorte: "application", valeur: texte };
  const normalise = normaliserCodeSecours(texte);
  return normalise === null ? null : { sorte: "secours", valeur: normalise };
}

// --- Connexion (UC-02, étape 3 et erreurs 3a, 3b) ---

async function connexion(code: Code, outils: OutilsPoint): Promise<ResultatCompose> {
  const { dependances, entetes, origine } = outils;
  const paire = extraireCookie(entetes.get("cookie"), nomCookieAttente(origine));
  const identifiant = paire === null ? null : identifiantAttente(paire);
  if (paire === null || identifiant === null) return { raison: "connexion_expiree" };
  const utilisateurId = await dependances.utilisateurDuDefi(identifiant);
  if (utilisateurId === null) return { raison: "connexion_expiree" };

  if (!(await dependances.limiterConnexion(utilisateurId))) {
    notifier(dependances, "compte.double_auth_tentatives", utilisateurId);
    return { raison: "trop_de_requetes" };
  }

  let lue: ReponseBetterAuth;
  if (code.sorte === "application") {
    if ((await dependances.reserverTranche(utilisateurId, code.valeur)) === "deja_utilisee") {
      return { raison: "code_incorrect" };
    }
    lue = await outils.appeler("/two-factor/verify-totp", { code: code.valeur }, paire);
  } else {
    const empreinte = dependances.empreinteCodeSecours(code.valeur);
    lue = await outils.appeler("/two-factor/verify-backup-code", { code: empreinte }, paire);
  }
  if (!reussi(lue)) return traduire(lue);

  // Le cookie de session neuf et l'effacement de l'attente, rien d'autre
  // (ni appareil de confiance, ni dont_remember).
  const nomSession = nomCookieSession(origine);
  const nomAttente = nomCookieAttente(origine);
  const cookies = lue.cookies.filter((cookie) => {
    const { nom } = lireSetCookie(cookie);
    return nom === nomSession || nom === nomAttente;
  });
  if (cookiesSession(lue, origine).length === 0) return { raison: "erreur" };

  // Correctif de la 1.2, déplacé après le code (section 8.1).
  await outils.revoquerSessionRecue();
  if (code.sorte === "secours") notifier(dependances, "compte.code_secours_utilise", utilisateurId);
  return { ok: true, cookies };
}

// --- Gestion (UC-04) ---

type Contexte = { session: SessionGestion; paire: string; etat: EtatLigne };

async function ouvrirGestion(
  outils: OutilsPoint,
): Promise<Contexte | { raison: RaisonDoubleAuth }> {
  const { dependances, entetes, origine } = outils;
  const session = await dependances.lireSession(entetes);
  if (session === null) return { raison: "connexion_requise" };
  const paire = extraireCookie(entetes.get("cookie"), nomCookieSession(origine));
  if (paire === null) return { raison: "connexion_requise" };
  if (!(await dependances.limiterGestion(session.utilisateurId))) {
    return { raison: "trop_de_requetes" };
  }
  const etat = await dependances.etatLigne(session.utilisateurId);
  return { session, paire, etat };
}

// Vérification du code avant une opération : code de l'application (tranche
// réservée, puis Better Auth) ou code de secours (consommé par Better Auth).
async function verifierCode(
  code: Code,
  contexte: Contexte,
  outils: OutilsPoint,
): Promise<{ raison: RaisonDoubleAuth } | null> {
  const { dependances } = outils;
  let lue: ReponseBetterAuth;
  if (code.sorte === "application") {
    const tranche = await dependances.reserverTranche(contexte.session.utilisateurId, code.valeur);
    if (tranche === "deja_utilisee") return { raison: "code_incorrect" };
    lue = await outils.appeler("/two-factor/verify-totp", { code: code.valeur }, contexte.paire);
  } else {
    const empreinte = dependances.empreinteCodeSecours(code.valeur);
    lue = await outils.appeler(
      "/two-factor/verify-backup-code",
      { code: empreinte },
      contexte.paire,
    );
  }
  return reussi(lue) ? null : traduire(lue);
}

async function motDePasseJuste(
  contexte: Contexte,
  motDePasse: string,
  outils: OutilsPoint,
): Promise<boolean> {
  return outils.dependances.motDePasseValide(contexte.session.utilisateurId, motDePasse);
}

function estRefus(valeur: object): valeur is { raison: RaisonDoubleAuth } {
  return "raison" in valeur;
}

// Fermeture des autres sessions, en gardant celle du cookie neuf, ou celle du
// cookie reçu.
async function fermerAutresSessions(
  contexte: Contexte,
  lue: ReponseBetterAuth,
  outils: OutilsPoint,
): Promise<string[]> {
  const nouveaux = cookiesSession(lue, outils.origine);
  const jeton =
    jetonDuSetCookie(nouveaux, nomCookieSession(outils.origine)) ?? contexte.session.jeton;
  await outils.dependances.revoquerAutresSessions(contexte.session.utilisateurId, jeton);
  return nouveaux;
}

async function activer(
  contexte: Contexte,
  motDePasse: string,
  outils: OutilsPoint,
): Promise<ResultatCompose> {
  const lue = await outils.appeler(
    "/two-factor/enable",
    { password: motDePasse, method: "totp" },
    contexte.paire,
  );
  if (!reussi(lue)) return traduire(lue);
  const activation = lireActivation(lue.corps, outils.dependances.matriceQr);
  if (activation === null) return { raison: "erreur" };
  return { ok: true, cookies: [], donnees: activation };
}

export const POINTS_DOUBLE_AUTH: Readonly<Record<string, PointCompose>> = Object.freeze({
  // UC-02, étape 3 : code de l'application.
  "/two-factor/verify-totp": {
    methode: "POST",
    schema: schemaCodeConnexion,
    executer: (donnees, outils) =>
      connexion({ sorte: "application", valeur: String(donnees.code) }, outils),
  },
  // UC-02, erreur 3b : code de secours, normalisé ; son empreinte seule part
  // vers Better Auth.
  "/two-factor/verify-backup-code": {
    methode: "POST",
    schema: schemaCodeSecoursConnexion,
    executer: async (donnees, outils) => {
      const valeur = normaliserCodeSecours(String(donnees.code));
      if (valeur === null) return { raison: "invalide" };
      return connexion({ sorte: "secours", valeur }, outils);
    },
  },
  // UC-04, étapes 1 et 2 : mot de passe, puis code QR, clé et codes.
  "/two-factor/enable": {
    methode: "POST",
    schema: schemaActivation,
    executer: async (donnees, outils) => {
      const contexte = await ouvrirGestion(outils);
      if (estRefus(contexte)) return contexte;
      if (contexte.session.doubleAuthentification || contexte.etat === "active") {
        return { raison: "refuse" };
      }
      const motDePasse = String(donnees.motDePasse);
      if (!(await motDePasseJuste(contexte, motDePasse, outils))) {
        return { raison: "mot_de_passe_incorrect" };
      }
      return activer(contexte, motDePasse, outils);
    },
  },
  // UC-04, étapes 3 et 4, et fin d'un remplacement : le code de la nouvelle
  // application ; autres sessions fermées ; email.
  "/two-factor/confirm-enable": {
    methode: "POST",
    schema: schemaConfirmation,
    executer: async (donnees, outils) => {
      const contexte = await ouvrirGestion(outils);
      if (estRefus(contexte)) return contexte;
      if (contexte.etat !== "a_confirmer") return { raison: "refuse" };
      const code = String(donnees.code);
      const { session } = contexte;
      if (
        (await outils.dependances.reserverTranche(session.utilisateurId, code)) === "deja_utilisee"
      ) {
        return { raison: "code_incorrect" };
      }
      const lue = await outils.appeler("/two-factor/verify-totp", { code }, contexte.paire);
      if (!reussi(lue)) return traduire(lue);
      const cookies = await fermerAutresSessions(contexte, lue, outils);
      notifier(
        outils.dependances,
        session.doubleAuthentification
          ? "compte.double_auth_remplacee"
          : "compte.double_auth_activee",
        session.utilisateurId,
      );
      return { ok: true, cookies };
    },
  },
  // Nouveau téléphone (section 7.1) : mot de passe et code, puis la ligne
  // marquée non vérifiée et une nouvelle activation ; le second facteur reste
  // actif tout du long.
  "/two-factor/replace": {
    methode: "POST",
    schema: schemaGestion,
    executer: async (donnees, outils) => {
      const code = lireCode(donnees.code);
      if (code === null) return { raison: "invalide" };
      const contexte = await ouvrirGestion(outils);
      if (estRefus(contexte)) return contexte;
      if (!contexte.session.doubleAuthentification || contexte.etat === "aucune") {
        return { raison: "refuse" };
      }
      const motDePasse = String(donnees.motDePasse);
      if (!(await motDePasseJuste(contexte, motDePasse, outils))) {
        return { raison: "mot_de_passe_incorrect" };
      }
      const refus = await verifierCode(code, contexte, outils);
      if (refus !== null) return refus;
      await outils.dependances.preparerRemplacement(contexte.session.utilisateurId);
      return activer(contexte, motDePasse, outils);
    },
  },
  // Nouveaux codes de secours (section 5.2) : mot de passe et code.
  "/two-factor/generate-backup-codes": {
    methode: "POST",
    schema: schemaGestion,
    executer: async (donnees, outils) => {
      const code = lireCode(donnees.code);
      if (code === null) return { raison: "invalide" };
      const contexte = await ouvrirGestion(outils);
      if (estRefus(contexte)) return contexte;
      if (!contexte.session.doubleAuthentification || contexte.etat === "aucune") {
        return { raison: "refuse" };
      }
      const motDePasse = String(donnees.motDePasse);
      if (!(await motDePasseJuste(contexte, motDePasse, outils))) {
        return { raison: "mot_de_passe_incorrect" };
      }
      const refus = await verifierCode(code, contexte, outils);
      if (refus !== null) return refus;
      const lue = await outils.appeler(
        "/two-factor/generate-backup-codes",
        { password: motDePasse },
        contexte.paire,
      );
      if (!reussi(lue)) return traduire(lue);
      const codes = (lue.corps as { backupCodes?: unknown } | null)?.backupCodes;
      if (!codesValides(codes)) return { raison: "erreur" };
      notifier(
        outils.dependances,
        "compte.codes_secours_regeneres",
        contexte.session.utilisateurId,
      );
      return { ok: true, cookies: [], donnees: { codes } };
    },
  },
  // Désactivation (UC-04, « Abus ») : refusée à un rôle exigeant ; mot de
  // passe et code ; autres sessions fermées ; email.
  "/two-factor/disable": {
    methode: "POST",
    schema: schemaGestion,
    executer: async (donnees, outils) => {
      const code = lireCode(donnees.code);
      if (code === null) return { raison: "invalide" };
      const contexte = await ouvrirGestion(outils);
      if (estRefus(contexte)) return contexte;
      if (!contexte.session.doubleAuthentification || contexte.etat === "aucune") {
        return { raison: "refuse" };
      }
      if (await outils.dependances.aRoleExigeant(contexte.session.utilisateurId)) {
        return { raison: "double_authentification_obligatoire" };
      }
      const motDePasse = String(donnees.motDePasse);
      if (!(await motDePasseJuste(contexte, motDePasse, outils))) {
        return { raison: "mot_de_passe_incorrect" };
      }
      const refus = await verifierCode(code, contexte, outils);
      if (refus !== null) return refus;
      const lue = await outils.appeler(
        "/two-factor/disable",
        { password: motDePasse },
        contexte.paire,
      );
      if (!reussi(lue)) return traduire(lue);
      const cookies = await fermerAutresSessions(contexte, lue, outils);
      notifier(outils.dependances, "compte.double_auth_desactivee", contexte.session.utilisateurId);
      return { ok: true, cookies };
    },
  },
} satisfies Record<string, PointCompose>);
