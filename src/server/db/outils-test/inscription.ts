import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { isPasswordCompromised } from "better-auth/plugins";
import { inArray } from "drizzle-orm";

import { empreinteCodeSecours } from "../../auth/codes-secours";
import { optionsAuth } from "../../auth/config";
import { creerDependancesDoubleAuth } from "../../auth/dependances-double-auth";
import { creerDependancesProfil } from "../../auth/dependances-profil";
import { creerEmailsCompte } from "../../auth/emails";
import { creerTraitementAuth, jetonDeSession } from "../../auth/points-entree";
import { matriceQr } from "../../auth/qr";
import { creerApresReinitialisation } from "../../auth/reinitialisation";
import { creerStockageBetterAuth } from "../../debit/better-auth";
import { creerVerificateur } from "../../debit/debit";
import { LIMITES } from "../../debit/limites";
import { adressePourCompteur } from "../../email/adresse";
import { creerPorteEmail } from "../../email/envoi";
import { env } from "../../env";
import { creerTransportMemoire, type TransportMemoire } from "../../modules/email/memoire";
import { db } from "../client";
import { creerCompteur, type Compteur } from "../debit";
import * as requetesDoubleAuth from "../double-authentification";
import { marquerAdresseVerifiee, supprimerJetonsReinitialisation } from "../reinitialisation";
import { revoquerAutresSessions, revoquerSessionDe } from "../sessions";
import { user, verification } from "../schema/auth";
import { compteurDebit } from "../schema/technique";

// Banc d'inscription avec la vraie base : instance de Better Auth aux options
// de l'application, rappels d'envoi réels (planifiés, exécutés à la demande),
// porte d'envoi réelle sur le transport en mémoire (aucun réseau), compteur
// réel sous un secret aléatoire (clés que ne partage aucun autre test). Ne
// s'importe que depuis un fichier de test. Fiche :
// docs/features/inscription.md, « Tests à écrire ». Connexion et déconnexion
// (1.2) : limite par compte sur le même compteur, déconnexion vérifiée par la
// session relue avec cette instance, comme gestionnaire.ts. Fiche :
// docs/features/connexion.md, tests 15 à 17. Mot de passe oublié (1.3) :
// rappels de la réinitialisation et de la notification, rappel d'après
// réinitialisation sur la vraie base, contrôles avant la consommation du
// jeton, comme gestionnaire.ts. Fiche : docs/features/mot-de-passe.md,
// tests 18 à 21.

export type BancInscription = {
  // Le gestionnaire des points d'entrée, lié à cette instance.
  traiter: (requete: Request) => Promise<Response>;
  transport: TransportMemoire;
  // La session lue par cette instance de Better Auth (getSession), null si
  // absente ; et l'utilisateur dont l'adresse n'est pas vérifiée compte comme
  // absent, comme lireSession.
  lireSession: (entetes: Headers) => Promise<{ utilisateurId: string; jeton: string } | null>;
  // Exécute les envois planifiés par les rappels (after() en production).
  envoyer: () => Promise<void>;
  // Adresse de test neuve, autorisée par la porte (hors production).
  adresse: () => string;
  // Supprime les comptes créés et les lignes du compteur de ce banc.
  nettoyer: () => Promise<void>;
};

export type OptionsBanc = {
  adresses: number;
  // Le fichier de test avance l'horloge de JavaScript (vi.setSystemTime),
  // comme double-authentification.integration.test.ts pour changer de
  // tranche de code. Better Auth supprime alors, à chaque recherche d'une
  // ligne de verification (findVerificationValue), toutes les lignes dont
  // l'échéance précède cette horloge avancée, celles des autres fichiers
  // lancés en parallèle comprises, encore valables à l'horloge réelle
  // (constaté : reinitialisation.integration.test.ts, « supprimerJetons-
  // Reinitialisation », dont les lignes expirent en 60 s, alors que
  // l'horloge avancée atteint +10 min). Ce nettoyage au passage est coupé
  // pour cette instance (disableCleanup) : ses lignes expirées sont purgées
  // par la tâche quotidienne, et par nettoyer().
  horlogeSimulee?: boolean;
};

export function bancInscription(options: OptionsBanc): BancInscription {
  const adresses = Array.from(
    { length: options.adresses },
    () => `test-${randomUUID()}@exemple.test`,
  );
  let suivante = 0;

  // Compteur réel qui retient ses clés, pour le nettoyage.
  const cles = new Set<string>();
  const reel = creerCompteur(db);
  const compteur: Compteur = {
    consommer: (cle, regle) => {
      cles.add(cle);
      return reel.consommer(cle, regle);
    },
    purger: reel.purger,
  };
  const secret = new Uint8Array(randomBytes(32));

  const transport = creerTransportMemoire();
  const porte = creerPorteEmail({
    transport,
    expediteur: "ne-pas-repondre@facturation.invalid",
    estProduction: false,
    destinatairesAutorises: adresses,
    origine: env.BETTER_AUTH_URL,
  });
  const verificateur = creerVerificateur({ limites: LIMITES, compteur, secret });

  const taches: (() => Promise<void>)[] = [];
  const emails = creerEmailsCompte({
    planifier: (tache) => {
      taches.push(tache);
    },
    verifierDebit: verificateur.verifierDebit,
    envoyerEmail: porte.envoyerEmail,
  });

  const base = optionsAuth as BetterAuthOptions;
  const auth = betterAuth({
    ...base,
    rateLimit: {
      ...base.rateLimit,
      customStorage: creerStockageBetterAuth({ limites: LIMITES, compteur, secret }),
    },
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      onExistingUserSignUp: emails.emailCompteExistant,
      sendResetPassword: emails.emailReinitialisation,
      onPasswordReset: creerApresReinitialisation({
        planifierNotification: emails.emailMotDePasseModifie,
        supprimerJetons: supprimerJetonsReinitialisation,
        marquerVerifiee: marquerAdresseVerifiee,
      }),
    },
    emailVerification: {
      ...base.emailVerification,
      sendVerificationEmail: emails.emailVerification,
    },
    ...(options.horlogeSimulee
      ? { verification: { ...base.verification, disableCleanup: true } }
      : {}),
  });

  // 1.4, comme gestionnaire.ts : même fabrique, sur cette instance, ce
  // compteur et ces emails (docs/features/double-authentification.md,
  // tests 19 à 25).
  const doubleAuth = creerDependancesDoubleAuth({
    contexte: () => auth.$context,
    verifierDebit: verificateur.verifierDebit,
    requetes: requetesDoubleAuth,
    revoquerAutresSessions,
    empreinteCodeSecours,
    matriceQr,
    emailDoubleAuth: emails.emailDoubleAuth,
  });

  return {
    traiter: creerTraitementAuth({
      traiter: (requete) => auth.handler(requete),
      origine: env.BETTER_AUTH_URL,
      estProduction: false,
      limiterCompte: (adresse) =>
        verificateur.verifierDebit("auth.connexion_compte", adressePourCompteur(adresse)),
      // Comme gestionnaire.ts : relecture par l'adaptateur, sans cookie écrit.
      sessionEncoreLisible: async (entetes) => {
        const contexte = await auth.$context;
        const jeton = jetonDeSession(entetes.get("cookie"), contexte.authCookies.sessionToken.name);
        return jeton !== null && (await contexte.internalAdapter.findSession(jeton)) !== null;
      },
      // Correctif de la 1.2, comme gestionnaire.ts.
      revoquerSession: async (entetes) => {
        const contexte = await auth.$context;
        const jeton = jetonDeSession(entetes.get("cookie"), contexte.authCookies.sessionToken.name);
        if (jeton !== null) await contexte.internalAdapter.deleteSession(jeton);
      },
      // 1.3, comme gestionnaire.ts.
      limiterReinitialisation: (adresse) =>
        verificateur.verifierDebit("auth.reinitialisation_compte", adressePourCompteur(adresse)),
      jetonReinitialisationValide: async (jeton) => {
        const contexte = await auth.$context;
        const ligne = await contexte.internalAdapter.findVerificationValue(
          `reset-password:${jeton}`,
        );
        return ligne !== null && ligne.expiresAt > new Date();
      },
      motDePasseCompromis: isPasswordCompromised,
      doubleAuth,
      // 1.5, comme gestionnaire.ts (docs/features/profil-sessions.md,
      // tests 12 à 14).
      profil: creerDependancesProfil({
        contexte: () => auth.$context,
        doubleAuth,
        verifierDebit: verificateur.verifierDebit,
        motDePasseCompromis: isPasswordCompromised,
        requetes: {
          revoquerSessionDe,
          revoquerAutresSessions,
          supprimerJetonsReinitialisation,
          adresseUtilisateur: requetesDoubleAuth.adresseUtilisateur,
        },
        emailProfil: emails.emailProfil,
      }),
    }),
    transport,
    lireSession: async (entetes) => {
      const lue = await auth.api.getSession({ headers: entetes });
      if (!lue || lue.user.emailVerified !== true) return null;
      return { utilisateurId: lue.user.id, jeton: lue.session.token };
    },
    envoyer: async () => {
      for (const tache of taches.splice(0)) await tache();
    },
    adresse: () => {
      const adresse = adresses[suivante++];
      if (adresse === undefined) throw new Error("banc d'inscription : plus d'adresse disponible");
      return adresse;
    },
    nettoyer: async () => {
      // 1.3 : les jetons de réinitialisation des comptes du banc (valeur :
      // l'identifiant de l'utilisateur, sans clé étrangère).
      const ids = (
        await db.select({ id: user.id }).from(user).where(inArray(user.email, adresses))
      ).map((ligne) => ligne.id);
      if (ids.length > 0) await db.delete(verification).where(inArray(verification.value, ids));
      // 1.4 : lignes d'anti-rejeu (identifiant double-auth-tranche:<id>).
      if (ids.length > 0) {
        await db.delete(verification).where(
          inArray(
            verification.identifier,
            ids.map((id) => `double-auth-tranche:${id}`),
          ),
        );
      }
      await db.delete(user).where(inArray(user.email, adresses));
      const liste = [...cles];
      if (liste.length > 0) await db.delete(compteurDebit).where(inArray(compteurDebit.cle, liste));
    },
  };
}
