import "server-only";

import {
  schemaChangementMotDePasse,
  schemaModificationNom,
  schemaRevocationAutresSessions,
  schemaRevocationSession,
} from "@/schemas/profil";
import { LONGUEUR_MIN_MOT_DE_PASSE } from "@/schemas/regles-compte";

import {
  extraireCookie,
  jetonDuSetCookie,
  nomCookieSession,
  type OutilsPoint,
  type PointCompose,
  type ReponseBetterAuth,
  type ResultatCompose,
} from "./double-authentification";
import { consignerIncidentAuth } from "./journal";

// Les quatre points du profil et des sessions de /api/auth (1.5), composés
// par notre passerelle : fermer une session ou les autres, changer son mot de
// passe, corriger son nom. Le cookie de session seul est lu ; une session se
// désigne par son identifiant, jamais par son jeton ; la révocation ne touche
// que les sessions de l'utilisateur de la session, et répond pareil qu'elle
// supprime ou non (S-02). Seul le changement du mot de passe appelle Better
// Auth (/change-password), après la limite, le mot de passe actuel et Have I
// Been Pwned ; la session est remplacée, les autres fermées et vérifiées, les
// liens de réinitialisation supprimés, l'email planifié. Corps de Better Auth
// jamais transmis. Les contrôles communs (origine, taille, type, schéma
// strict, production) sont ceux de points-entree.ts. Fiche :
// docs/features/profil-sessions.md, sections 2 à 6.

export type SessionProfil = { utilisateurId: string; jeton: string };

export type ModeleProfil = "compte.mot_de_passe_change";

export type DependancesProfil = {
  // La session du cookie reçu, relue en base ; null si absente, expirée ou
  // d'un utilisateur non vérifié.
  lireSession: (entetes: Headers) => Promise<SessionProfil | null>;
  // auth.profil_compte et auth.mot_de_passe_compte : vrai si admis.
  limiterProfil: (utilisateurId: string) => Promise<boolean>;
  limiterMotDePasse: (utilisateurId: string) => Promise<boolean>;
  motDePasseValide: (utilisateurId: string, motDePasse: string) => Promise<boolean>;
  // Have I Been Pwned ; lève si le service ne répond pas (fermé par défaut).
  motDePasseCompromis: (motDePasse: string) => Promise<boolean>;
  // Supprime la session d'identifiant donné si elle est à l'utilisateur et
  // n'est pas celle du jeton gardé ; ne dit pas si elle l'a fait.
  revoquerSessionDe: (
    utilisateurId: string,
    sessionId: string,
    jetonGarde: string,
  ) => Promise<void>;
  revoquerAutresSessions: (utilisateurId: string, jetonGarde: string) => Promise<void>;
  supprimerJetonsReinitialisation: (utilisateurId: string) => Promise<void>;
  modifierNom: (utilisateurId: string, nom: string) => Promise<void>;
  // Planifie l'email, après la réponse ; ne doit pas lever.
  notifier: (modele: ModeleProfil, utilisateurId: string) => void;
  // 2.1, report de la 1.5 : l'organisation active de la session du jeton
  // donné ; puis sa reprise sur la session neuve, adhésion exigée
  // (docs/features/organisations.md, section 5).
  organisationActive: (jeton: string) => Promise<string | null>;
  reprendreOrganisationActive: (
    utilisateurId: string,
    jetonNeuf: string,
    organisationId: string,
  ) => Promise<void>;
};

// Le seul chemin de Better Auth que ces points appellent (limite par
// adresse IP, debit/better-auth.ts).
export const CHEMINS_INTERNES_PROFIL = ["/change-password"] as const;

type Contexte = { session: SessionProfil; paire: string };

function estRefus(valeur: object): valeur is { raison: "connexion_requise" | "trop_de_requetes" } {
  return "raison" in valeur;
}

// Session et cookie de session présents, puis la limite du profil.
async function ouvrir(
  outils: OutilsPoint,
): Promise<Contexte | { raison: "connexion_requise" | "trop_de_requetes" }> {
  const { profil, entetes, origine } = outils;
  const paire = extraireCookie(entetes.get("cookie"), nomCookieSession(origine));
  if (paire === null) return { raison: "connexion_requise" };
  const session = await profil.lireSession(entetes);
  if (session === null) return { raison: "connexion_requise" };
  if (!(await profil.limiterProfil(session.utilisateurId))) return { raison: "trop_de_requetes" };
  return { session, paire };
}

function reussi(lue: ReponseBetterAuth): boolean {
  return lue.statut >= 200 && lue.statut < 300;
}

// Codes d'erreur de /change-password, traduits en une liste fermée ; tout le
// reste est « erreur ».
function traduire(lue: ReponseBetterAuth): ResultatCompose {
  switch (lue.code) {
    case "INVALID_PASSWORD":
      return { raison: "mot_de_passe_incorrect" };
    case "PASSWORD_TOO_SHORT":
      return { raison: "mot_de_passe_trop_court" };
    case "PASSWORD_COMPROMISED":
      return { raison: "mot_de_passe_compromis" };
    case "UNAUTHORIZED":
      return { raison: "connexion_requise" };
    default:
      break;
  }
  if (lue.statut === 429) return { raison: "trop_de_requetes" };
  return { raison: "erreur" };
}

// Les cookies de session posés par une réponse, non vides : rien d'autre
// n'est transmis (ni session_data, ni dont_remember).
function cookiesSession(lue: ReponseBetterAuth, origine: string): string[] {
  const nom = nomCookieSession(origine);
  return lue.cookies.filter((cookie) => {
    const paire = cookie.split(";")[0] ?? "";
    const egal = paire.indexOf("=");
    return egal > 0 && paire.slice(0, egal).trim() === nom && paire.slice(egal + 1).trim() !== "";
  });
}

async function changerMotDePasse(
  donnees: Record<string, unknown>,
  outils: OutilsPoint,
): Promise<ResultatCompose> {
  const contexte = await ouvrir(outils);
  if (estRefus(contexte)) return contexte;
  const { profil, origine } = outils;
  const { utilisateurId } = contexte.session;
  if (!(await profil.limiterMotDePasse(utilisateurId))) return { raison: "trop_de_requetes" };

  const actuel = String(donnees.motDePasseActuel);
  const nouveau = String(donnees.nouveauMotDePasse);
  if (nouveau.length < LONGUEUR_MIN_MOT_DE_PASSE) return { raison: "mot_de_passe_trop_court" };
  if (!(await profil.motDePasseValide(utilisateurId, actuel))) {
    return { raison: "mot_de_passe_incorrect" };
  }
  if (await profil.motDePasseCompromis(nouveau)) return { raison: "mot_de_passe_compromis" };

  // L'organisation active de la session remplacée, lue avant que Better Auth
  // ne la supprime (2.1).
  const organisation = await profil.organisationActive(contexte.session.jeton);

  const lue = await outils.appeler(
    "/change-password",
    { currentPassword: actuel, newPassword: nouveau, revokeOtherSessions: true },
    contexte.paire,
  );
  if (!reussi(lue)) return traduire(lue);
  const cookies = cookiesSession(lue, origine);
  const jetonNeuf = jetonDuSetCookie(cookies, nomCookieSession(origine));
  if (cookies.length === 0 || jetonNeuf === null) return { raison: "erreur" };

  // Better Auth a supprimé toutes les sessions avant d'ouvrir la neuve ; une
  // session ouverte entre-temps est fermée ici. En échec : « erreur », aucun
  // cookie (section 4, étape 4).
  await profil.revoquerAutresSessions(utilisateurId, jetonNeuf);
  // La session neuve reprend l'organisation active, si l'adhésion existe
  // toujours. En échec, le changement reste fait : une ligne fixe, et
  // l'utilisateur rouvre son organisation depuis /compte (2.1).
  if (organisation !== null) {
    try {
      await profil.reprendreOrganisationActive(utilisateurId, jetonNeuf, organisation);
    } catch {
      consignerIncidentAuth();
    }
  }
  // Un lien demandé avant le changement ne permet plus de le défaire. En
  // échec, le changement reste fait : une ligne fixe, le lien expire seul.
  try {
    await profil.supprimerJetonsReinitialisation(utilisateurId);
  } catch {
    consignerIncidentAuth();
  }
  try {
    profil.notifier("compte.mot_de_passe_change", utilisateurId);
  } catch {
    // Planification impossible : la porte d'envoi consigne ses échecs.
  }
  return { ok: true, cookies };
}

export const POINTS_PROFIL: Readonly<Record<string, PointCompose>> = Object.freeze({
  // UC-05, étape 2 : une session, désignée par son identifiant.
  "/revoke-session": {
    methode: "POST",
    schema: schemaRevocationSession,
    executer: async (donnees, outils) => {
      const contexte = await ouvrir(outils);
      if (estRefus(contexte)) return contexte;
      const { utilisateurId, jeton } = contexte.session;
      await outils.profil.revoquerSessionDe(utilisateurId, String(donnees.session), jeton);
      return { ok: true, cookies: [] };
    },
  },
  // UC-05, étape 2 : toutes sauf la sienne.
  "/revoke-other-sessions": {
    methode: "POST",
    schema: schemaRevocationAutresSessions,
    executer: async (_donnees, outils) => {
      const contexte = await ouvrir(outils);
      if (estRefus(contexte)) return contexte;
      const { utilisateurId, jeton } = contexte.session;
      await outils.profil.revoquerAutresSessions(utilisateurId, jeton);
      return { ok: true, cookies: [] };
    },
  },
  // S-17 : changer son mot de passe depuis une session.
  "/change-password": {
    methode: "POST",
    schema: schemaChangementMotDePasse,
    executer: changerMotDePasse,
  },
  // Report de la 1.3 (décision B) : corriger son nom, sans Better Auth.
  "/update-user": {
    methode: "POST",
    schema: schemaModificationNom,
    executer: async (donnees, outils) => {
      const contexte = await ouvrir(outils);
      if (estRefus(contexte)) return contexte;
      await outils.profil.modifierNom(contexte.session.utilisateurId, String(donnees.nom).trim());
      return { ok: true, cookies: [] };
    },
  },
} satisfies Record<string, PointCompose>);
