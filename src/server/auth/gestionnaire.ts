import "server-only";

import { isPasswordCompromised } from "better-auth/plugins";

import * as requetesDoubleAuth from "../db/double-authentification";
import { enregistrerPreuve } from "../db/nouvelle-authentification";
import { supprimerJetonsReinitialisation } from "../db/reinitialisation";
import { revoquerAutresSessions, revoquerSessionDe } from "../db/sessions";
import { verifierDebit } from "../debit/debit";
import { adressePourCompteur } from "../email/adresse";
import { configurationEmail, env } from "../env";

import { empreinteCodeSecours } from "./codes-secours";
import { auth } from "./config";
import { creerDependancesDoubleAuth } from "./dependances-double-auth";
import { creerDependancesNouvelleAuthentification } from "./dependances-nouvelle-authentification";
import { creerDependancesProfil } from "./dependances-profil";
import { planifierEmailDoubleAuth, planifierEmailProfil } from "./emails";
import { creerTraitementAuth, jetonDeSession } from "./points-entree";
import { matriceQr } from "./qr";

// Le gestionnaire de /api/auth lié à l'application : Better Auth
// (auth.handler), l'origine de BETTER_AUTH_URL, et la production lue de
// VERCEL_ENV par la configuration validée (env-schema.ts), où les comptes
// restent fermés jusqu'à la 1.3 (décision 1). Seul import de
// src/app/api/auth/[...all]/route.ts. Fiche : docs/features/inscription.md,
// section 2. Connexion (1.2) : la limite par compte compte l'adresse
// normalisée comme un destinataire d'email, hors de toute transaction
// (règle 15) ; la déconnexion relit la session par l'adaptateur interne de
// Better Auth (findSession), et non par auth.api.getSession : celle-ci, ne
// trouvant plus la session, demande l'effacement du cookie, que l'extension
// nextCookies ajoute à notre réponse, même quand la déconnexion a échoué
// (constaté à l'implémentation). Une connexion réussie révoque l'ancienne
// session du cookie reçu par deleteSession (correctif de la 1.2). Fiche :
// docs/features/connexion.md, sections 3, 4.2 et 4.3. Mot de passe oublié
// (1.3) : la limite de la demande compte l'adresse comme celle de la
// connexion ; le jeton est lu par l'adaptateur interne (findVerificationValue,
// qui applique l'empreinte) sans être consommé ; le mot de passe compromis
// est vérifié par la fonction de l'extension Have I Been Pwned. Fiche :
// docs/features/mot-de-passe.md, sections 3.3 et 5. Double authentification
// (1.4) : dépendances liées par creerDependancesDoubleAuth, lectures par
// l'adaptateur interne, requêtes de db/double-authentification.ts et
// db/sessions.ts. Fiche : docs/features/double-authentification.md. Profil
// et sessions (1.5) : dépendances liées par creerDependancesProfil, sur la
// même lecture de session et la même vérification du mot de passe que la
// double authentification. Fiche : docs/features/profil-sessions.md.
// Nouvelle authentification (1.6) : dépendances liées par
// creerDependancesNouvelleAuthentification, mêmes lecture de session et
// vérification du mot de passe, preuve posée par db/nouvelle-authentification.ts.
// Fiche : docs/features/nouvelle-authentification.md.
const doubleAuth = creerDependancesDoubleAuth({
  contexte: () => auth.$context,
  verifierDebit,
  requetes: requetesDoubleAuth,
  revoquerAutresSessions,
  empreinteCodeSecours,
  matriceQr,
  emailDoubleAuth: planifierEmailDoubleAuth,
});

export const traiterRequeteAuth = creerTraitementAuth({
  traiter: (requete) => auth.handler(requete),
  origine: env.BETTER_AUTH_URL,
  estProduction: configurationEmail.estProduction,
  limiterCompte: (adresse) => verifierDebit("auth.connexion_compte", adressePourCompteur(adresse)),
  sessionEncoreLisible: async (entetes) => {
    const contexte = await auth.$context;
    const jeton = jetonDeSession(entetes.get("cookie"), contexte.authCookies.sessionToken.name);
    return jeton !== null && (await contexte.internalAdapter.findSession(jeton)) !== null;
  },
  revoquerSession: async (entetes) => {
    const contexte = await auth.$context;
    const jeton = jetonDeSession(entetes.get("cookie"), contexte.authCookies.sessionToken.name);
    if (jeton !== null) await contexte.internalAdapter.deleteSession(jeton);
  },
  limiterReinitialisation: (adresse) =>
    verifierDebit("auth.reinitialisation_compte", adressePourCompteur(adresse)),
  jetonReinitialisationValide: async (jeton) => {
    const contexte = await auth.$context;
    const ligne = await contexte.internalAdapter.findVerificationValue(`reset-password:${jeton}`);
    return ligne !== null && ligne.expiresAt > new Date();
  },
  motDePasseCompromis: isPasswordCompromised,
  doubleAuth,
  profil: creerDependancesProfil({
    contexte: () => auth.$context,
    doubleAuth,
    verifierDebit,
    motDePasseCompromis: isPasswordCompromised,
    requetes: {
      revoquerSessionDe,
      revoquerAutresSessions,
      supprimerJetonsReinitialisation,
      adresseUtilisateur: requetesDoubleAuth.adresseUtilisateur,
    },
    emailProfil: planifierEmailProfil,
  }),
  nouvelleAuthentification: creerDependancesNouvelleAuthentification({
    contexte: () => auth.$context,
    doubleAuth,
    verifierDebit,
    enregistrerPreuve,
  }),
});
