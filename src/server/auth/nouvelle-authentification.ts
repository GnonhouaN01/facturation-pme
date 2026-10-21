import "server-only";

import { schemaNouvelleAuthentification } from "@/schemas/nouvelle-authentification";

import {
  extraireCookie,
  lireCode,
  nomCookieSession,
  verifierCode,
  type PointCompose,
  type ResultatCompose,
} from "./double-authentification";

// Le point de la nouvelle authentification de /api/auth (1.6), composé par
// notre passerelle : POST /verify-password, mot de passe et, si le second
// facteur est actif, code de l'application ou de secours, vérifiés pour
// l'utilisateur de la session ; puis une preuve posée pour cette session,
// que l'étape 8 de la chaîne consomme. Le point de Better Auth du même nom
// n'est jamais appelé : il ne limite rien et n'écrit rien. Limite par
// utilisateur avant toute vérification ; aucune preuve sur un refus ; ni
// cookie ni corps de Better Auth dans la réponse. Les contrôles communs
// (origine, taille, type, schéma strict, production) sont ceux de
// points-entree.ts. Fiche : docs/features/nouvelle-authentification.md,
// sections 2 à 6.

export type SessionNouvelleAuthentification = {
  utilisateurId: string;
  // L'identifiant de la session, jamais son jeton : la preuve s'y rattache.
  sessionId: string;
  // user.two_factor_enabled, relu avec la session.
  doubleAuthentification: boolean;
  jeton: string;
};

export type DependancesNouvelleAuthentification = {
  // La session du cookie reçu, relue en base ; null si absente, expirée ou
  // d'un utilisateur non vérifié.
  lireSession: (entetes: Headers) => Promise<SessionNouvelleAuthentification | null>;
  // auth.nouvelle_authentification : vrai si l'essai est admis.
  limiter: (utilisateurId: string) => Promise<boolean>;
  motDePasseValide: (utilisateurId: string, motDePasse: string) => Promise<boolean>;
  enregistrerPreuve: (utilisateurId: string, sessionId: string) => Promise<void>;
};

export const POINTS_NOUVELLE_AUTHENTIFICATION: Readonly<Record<string, PointCompose>> =
  Object.freeze({
    // S-14 : UC-07 (étape 4), UC-10 (étape 2), UC-13 (étape 3), UC-30
    // (étape 1).
    "/verify-password": {
      methode: "POST",
      schema: schemaNouvelleAuthentification,
      executer: async (donnees, outils): Promise<ResultatCompose> => {
        const { nouvelleAuthentification: dependances, origine, entetes } = outils;

        // 1. Cookie de session et session relue en base.
        const paire = extraireCookie(entetes.get("cookie"), nomCookieSession(origine));
        if (paire === null) return { raison: "connexion_requise" };
        const session = await dependances.lireSession(entetes);
        if (session === null) return { raison: "connexion_requise" };

        // 2. Limite par utilisateur, comptée avant toute vérification (T-01).
        if (!(await dependances.limiter(session.utilisateurId))) {
          return { raison: "trop_de_requetes" };
        }

        // 3. Forme du code selon l'état du second facteur ; pendant un
        // remplacement, vérifier le code l'achèverait (section 1).
        const saisi = donnees.code;
        const code = saisi === undefined ? null : lireCode(saisi);
        if (session.doubleAuthentification) {
          if (code === null) return { raison: "invalide" };
          if ((await outils.dependances.etatLigne(session.utilisateurId)) !== "active") {
            return { raison: "refuse" };
          }
        } else if (saisi !== undefined) {
          return { raison: "invalide" };
        }

        // 4. Mot de passe, avant le code.
        const motDePasse = String(donnees.motDePasse);
        if (!(await dependances.motDePasseValide(session.utilisateurId, motDePasse))) {
          return { raison: "mot_de_passe_incorrect" };
        }

        // 5. Code, avec le seul cookie de session (anti-rejeu de la 1.4).
        if (code !== null) {
          const refus = await verifierCode(code, session.utilisateurId, paire, outils);
          if (refus !== null) return refus;
          // Un code de secours consommé prévient le titulaire, comme à la
          // connexion (1.4) ; l'email ne change jamais la réponse.
          if (code.sorte === "secours") {
            try {
              outils.dependances.notifier("compte.code_secours_utilise", session.utilisateurId);
            } catch {
              // Planification impossible : la porte d'envoi consigne ses échecs.
            }
          }
        }

        // 6. Preuve pour cette session, et pour elle seule.
        await dependances.enregistrerPreuve(session.utilisateurId, session.sessionId);
        return { ok: true, cookies: [] };
      },
    },
  } satisfies Record<string, PointCompose>);
