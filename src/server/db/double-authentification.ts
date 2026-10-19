import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { member, twoFactor, user, verification } from "./schema/auth";

// Requêtes de la double authentification (1.4), sur des tables de Better Auth
// sans organisation_id : par db, sans organisation active, toujours filtrées
// sur l'utilisateur de la session ou de la connexion en attente (RR-8).
// Fiche : docs/features/double-authentification.md, sections 5, 6.1 et 7.

export type EtatDoubleAuth = {
  ligne: "aucune" | "a_confirmer" | "active";
  codesRestants: number;
};

// Échéance de la ligne d'anti-rejeu : au-delà de la fenêtre d'acceptation
// (±1 tranche de 30 secondes).
const DUREE_TRANCHE_MS = 3 * 60 * 1000;
const PREFIXE_TRANCHE = "double-auth-tranche:";

function nombreDeCodes(stockes: string): number {
  try {
    const liste: unknown = JSON.parse(stockes);
    return Array.isArray(liste) ? liste.length : 0;
  } catch {
    return 0;
  }
}

export function creerRequetesDoubleAuth(base: BaseDeDonnees) {
  return {
    // L'état de la ligne two_factor et le nombre de codes de secours restants
    // (longueur de la liste d'empreintes), sans rien en montrer.
    etatDoubleAuth: async (utilisateurId: string): Promise<EtatDoubleAuth> => {
      const [ligne] = await base
        .select({ verifiee: twoFactor.verified, codes: twoFactor.backupCodes })
        .from(twoFactor)
        .where(eq(twoFactor.userId, utilisateurId))
        .limit(1);
      if (!ligne) return { ligne: "aucune", codesRestants: 0 };
      return {
        ligne: ligne.verifiee === false ? "a_confirmer" : "active",
        codesRestants: nombreDeCodes(ligne.codes),
      };
    },

    // Le secret chiffré, pour l'anti-rejeu (déchiffré par la passerelle).
    secretChiffre: async (utilisateurId: string): Promise<string | null> => {
      const [ligne] = await base
        .select({ secret: twoFactor.secret })
        .from(twoFactor)
        .where(eq(twoFactor.userId, utilisateurId))
        .limit(1);
      return ligne?.secret ?? null;
    },

    // Décision 4 : réserve la tranche pour le compte si elle est plus récente
    // que la dernière acceptée. La ligne two_factor est verrouillée : deux
    // requêtes d'un même compte passent l'une après l'autre.
    reserverTranche: async (utilisateurId: string, tranche: number): Promise<boolean> =>
      base.transaction(async (tx) => {
        const [verrou] = await tx
          .select({ id: twoFactor.id })
          .from(twoFactor)
          .where(eq(twoFactor.userId, utilisateurId))
          .for("update");
        if (!verrou) return false;
        const identifiant = `${PREFIXE_TRANCHE}${utilisateurId}`;
        const lignes = await tx
          .select({ value: verification.value, expiresAt: verification.expiresAt })
          .from(verification)
          .where(eq(verification.identifier, identifiant));
        const maintenant = new Date();
        const derniere = lignes
          .filter((ligne) => ligne.expiresAt > maintenant)
          .map((ligne) => Number(ligne.value))
          .filter(Number.isInteger)
          .reduce((max, valeur) => Math.max(max, valeur), Number.NEGATIVE_INFINITY);
        if (derniere >= tranche) return false;
        await tx.delete(verification).where(eq(verification.identifier, identifiant));
        await tx.insert(verification).values({
          identifier: identifiant,
          value: String(tranche),
          expiresAt: new Date(maintenant.getTime() + DUREE_TRANCHE_MS),
        });
        return true;
      }),

    // Remplacement (section 7.1) : la ligne marquée non vérifiée, pour que
    // Better Auth accepte une nouvelle activation ; two_factor_enabled reste
    // vrai.
    preparerRemplacement: async (utilisateurId: string): Promise<void> => {
      await base
        .update(twoFactor)
        .set({ verified: false })
        .where(eq(twoFactor.userId, utilisateurId));
    },

    // Propriétaire ou Comptable dans au moins une organisation : seules les
    // adhésions de l'utilisateur sont lues.
    aRoleExigeant: async (utilisateurId: string, roles: readonly string[]): Promise<boolean> => {
      const [ligne] = await base
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, utilisateurId), inArray(member.role, [...roles])))
        .limit(1);
      return ligne !== undefined;
    },

    // user.two_factor_enabled, pour la page de la double authentification.
    secondFacteurActif: async (utilisateurId: string): Promise<boolean> => {
      const [ligne] = await base
        .select({ actif: user.twoFactorEnabled })
        .from(user)
        .where(eq(user.id, utilisateurId))
        .limit(1);
      return ligne?.actif === true;
    },

    // L'adresse du compte, pour une notification ; jamais reçue de la requête.
    adresseUtilisateur: async (utilisateurId: string): Promise<string | null> => {
      const [ligne] = await base
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, utilisateurId))
        .limit(1);
      return ligne?.email ?? null;
    },
  };
}

const requetes = creerRequetesDoubleAuth(db);
export const etatDoubleAuth = requetes.etatDoubleAuth;
export const secretChiffre = requetes.secretChiffre;
export const reserverTranche = requetes.reserverTranche;
export const preparerRemplacement = requetes.preparerRemplacement;
export const aRoleExigeant = requetes.aRoleExigeant;
export const adresseUtilisateur = requetes.adresseUtilisateur;
export const secondFacteurActif = requetes.secondFacteurActif;
