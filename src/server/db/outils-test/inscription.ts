import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { inArray } from "drizzle-orm";

import { optionsAuth } from "../../auth/config";
import { creerEmailsCompte } from "../../auth/emails";
import { creerTraitementAuth } from "../../auth/points-entree";
import { creerStockageBetterAuth } from "../../debit/better-auth";
import { creerVerificateur } from "../../debit/debit";
import { LIMITES } from "../../debit/limites";
import { adressePourCompteur } from "../../email/adresse";
import { creerPorteEmail } from "../../email/envoi";
import { env } from "../../env";
import { creerTransportMemoire, type TransportMemoire } from "../../modules/email/memoire";
import { db } from "../client";
import { creerCompteur, type Compteur } from "../debit";
import { user } from "../schema/auth";
import { compteurDebit } from "../schema/technique";

// Banc d'inscription avec la vraie base : instance de Better Auth aux options
// de l'application, rappels d'envoi réels (planifiés, exécutés à la demande),
// porte d'envoi réelle sur le transport en mémoire (aucun réseau), compteur
// réel sous un secret aléatoire (clés que ne partage aucun autre test). Ne
// s'importe que depuis un fichier de test. Fiche :
// docs/features/inscription.md, « Tests à écrire ». Connexion et déconnexion
// (1.2) : limite par compte sur le même compteur, déconnexion vérifiée par la
// session relue avec cette instance, comme gestionnaire.ts. Fiche :
// docs/features/connexion.md, tests 15 à 17.

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

export function bancInscription(options: { adresses: number }): BancInscription {
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
    },
    emailVerification: {
      ...base.emailVerification,
      sendVerificationEmail: emails.emailVerification,
    },
  });

  return {
    traiter: creerTraitementAuth({
      traiter: (requete) => auth.handler(requete),
      origine: env.BETTER_AUTH_URL,
      estProduction: false,
      limiterCompte: (adresse) =>
        verificateur.verifierDebit("auth.connexion_compte", adressePourCompteur(adresse)),
      sessionEncoreLisible: async (entetes) =>
        (await auth.api.getSession({ headers: entetes })) !== null,
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
      await db.delete(user).where(inArray(user.email, adresses));
      const liste = [...cles];
      if (liste.length > 0) await db.delete(compteurDebit).where(inArray(compteurDebit.cle, liste));
    },
  };
}
