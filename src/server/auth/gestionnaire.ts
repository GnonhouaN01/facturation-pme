import "server-only";

import { verifierDebit } from "../debit/debit";
import { adressePourCompteur } from "../email/adresse";
import { configurationEmail, env } from "../env";

import { auth } from "./config";
import { creerTraitementAuth, jetonDeSession } from "./points-entree";

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
// (constaté à l'implémentation). Fiche : docs/features/connexion.md,
// sections 3 et 4.2.
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
});
