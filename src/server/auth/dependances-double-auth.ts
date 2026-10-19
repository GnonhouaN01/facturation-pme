import "server-only";

import { symmetricDecrypt, type SecretConfig } from "better-auth/crypto";

import { ROLES_DOUBLE_AUTH } from "../autorisation/matrice";
import type { NomLimite } from "../debit/limites";
import type { EtatDoubleAuth } from "../db/double-authentification";

import type {
  DependancesDoubleAuth,
  ModeleDoubleAuth,
  SessionGestion,
} from "./double-authentification";
import { jetonDeSession } from "./points-entree";
import { trancheDuCode } from "./tranche-totp";

// Les dépendances de la double authentification liées à une instance de
// Better Auth, à un compteur et aux requêtes de db/ : une seule fabrique pour
// gestionnaire.ts et pour le banc des tests d'intégration. Lectures par
// l'adaptateur interne de Better Auth (jamais auth.api, dont l'extension
// nextCookies écrirait des cookies dans notre réponse, constat de la 1.2).
// Fiche : docs/features/double-authentification.md, sections 2, 6 et 7.

type Contexte = {
  secretConfig: string | SecretConfig;
  authCookies: { sessionToken: { name: string } };
  internalAdapter: {
    findSession: (jeton: string) => Promise<{
      session: { token: string; expiresAt: Date };
      user: { id: string; emailVerified: boolean; twoFactorEnabled?: boolean | null };
    } | null>;
    findVerificationValue: (
      identifiant: string,
    ) => Promise<{ value: string; expiresAt: Date } | null>;
    findAccounts: (
      utilisateurId: string,
    ) => Promise<{ providerId: string; password?: string | null }[]>;
  };
  password: { verify: (donnees: { hash: string; password: string }) => Promise<boolean> };
};

export type OptionsDependancesDoubleAuth = {
  contexte: () => Promise<unknown>;
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  requetes: {
    etatDoubleAuth: (utilisateurId: string) => Promise<EtatDoubleAuth>;
    secretChiffre: (utilisateurId: string) => Promise<string | null>;
    reserverTranche: (utilisateurId: string, tranche: number) => Promise<boolean>;
    preparerRemplacement: (utilisateurId: string) => Promise<void>;
    aRoleExigeant: (utilisateurId: string, roles: readonly string[]) => Promise<boolean>;
    adresseUtilisateur: (utilisateurId: string) => Promise<string | null>;
  };
  revoquerAutresSessions: (utilisateurId: string, jetonGarde: string) => Promise<unknown>;
  empreinteCodeSecours: (code: string) => string;
  matriceQr: (texte: string) => string[];
  emailDoubleAuth: (modele: ModeleDoubleAuth, lireAdresse: () => Promise<string | null>) => void;
  maintenant?: () => number;
};

export function creerDependancesDoubleAuth(
  options: OptionsDependancesDoubleAuth,
): DependancesDoubleAuth {
  const contexte = async () => (await options.contexte()) as Contexte;
  const maintenant = options.maintenant ?? (() => Date.now());

  return {
    lireSession: async (entetes): Promise<SessionGestion | null> => {
      const ctx = await contexte();
      const jeton = jetonDeSession(entetes.get("cookie"), ctx.authCookies.sessionToken.name);
      if (jeton === null) return null;
      const lue = await ctx.internalAdapter.findSession(jeton);
      if (!lue || lue.user.emailVerified !== true) return null;
      if (new Date(lue.session.expiresAt).getTime() <= maintenant()) return null;
      return {
        utilisateurId: lue.user.id,
        doubleAuthentification: lue.user.twoFactorEnabled === true,
        jeton: lue.session.token,
      };
    },
    etatLigne: async (utilisateurId) =>
      (await options.requetes.etatDoubleAuth(utilisateurId)).ligne,
    utilisateurDuDefi: async (identifiant) => {
      const ctx = await contexte();
      const ligne = await ctx.internalAdapter.findVerificationValue(identifiant);
      if (!ligne || new Date(ligne.expiresAt).getTime() <= maintenant()) return null;
      return ligne.value;
    },
    limiterConnexion: (utilisateurId) =>
      options.verifierDebit("auth.double_auth_compte", utilisateurId),
    limiterGestion: (utilisateurId) =>
      options.verifierDebit("auth.double_auth_gestion", utilisateurId),
    reserverTranche: async (utilisateurId, code) => {
      const chiffre = await options.requetes.secretChiffre(utilisateurId);
      if (chiffre === null) return "aucune";
      const ctx = await contexte();
      const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: chiffre });
      const tranche = trancheDuCode(secret, code, maintenant());
      if (tranche === null) return "aucune";
      return (await options.requetes.reserverTranche(utilisateurId, tranche))
        ? "reservee"
        : "deja_utilisee";
    },
    motDePasseValide: async (utilisateurId, motDePasse) => {
      const ctx = await contexte();
      const comptes = await ctx.internalAdapter.findAccounts(utilisateurId);
      const hachage = comptes.find((compte) => compte.providerId === "credential")?.password;
      if (!hachage) return false;
      return ctx.password.verify({ hash: hachage, password: motDePasse });
    },
    aRoleExigeant: (utilisateurId) =>
      options.requetes.aRoleExigeant(utilisateurId, ROLES_DOUBLE_AUTH),
    preparerRemplacement: (utilisateurId) => options.requetes.preparerRemplacement(utilisateurId),
    revoquerAutresSessions: async (utilisateurId, jetonGarde) => {
      await options.revoquerAutresSessions(utilisateurId, jetonGarde);
    },
    empreinteCodeSecours: options.empreinteCodeSecours,
    matriceQr: options.matriceQr,
    notifier: (modele, utilisateurId) => {
      options.emailDoubleAuth(modele, () => options.requetes.adresseUtilisateur(utilisateurId));
    },
  };
}
