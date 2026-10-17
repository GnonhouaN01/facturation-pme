import "server-only";

import { isPasswordCompromised } from "better-auth/plugins";

import { verifierDebit } from "../debit/debit";
import { adressePourCompteur } from "../email/adresse";
import { env } from "../env";

import { auth } from "./config";
import { creerTraitementAuth, jetonDeSession } from "./points-entree";

// Le gestionnaire de /api/auth lié à l'application : Better Auth
// (auth.handler) et l'origine de BETTER_AUTH_URL ; les comptes sont ouverts
// en production comme ailleurs (PR 2 de la 1.3,
// docs/features/mot-de-passe.md, section 11). Seul import de
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
// docs/features/mot-de-passe.md, sections 3.3 et 5.
export const traiterRequeteAuth = creerTraitementAuth({
  traiter: (requete) => auth.handler(requete),
  origine: env.BETTER_AUTH_URL,
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
});
