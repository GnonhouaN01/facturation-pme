import "server-only";

import { compteur as compteurReel, type Compteur } from "../db/debit";
import { env } from "../env";

import { cleCompteur, deriverSecret } from "./cle";
import { LIMITES, type Limite, type NomLimite } from "./limites";

// La limitation de débit de Better Auth, branchée sur notre compteur
// (option B3 de docs/features/limitation-debit.md, section 8) : une seule
// table, des empreintes, une seule purge. Better Auth garde son point
// d'entrée et compte au début de chaque requête HTTP vers sa route, avant le
// point d'entrée, donc jamais dans une transaction (règle 15). Fiche :
// docs/features/inscription.md, section 3.

// Les chemins ouverts de /api/auth et leur limite. Les valeurs restent dans
// limites.ts (règle 15).
export const CHEMINS_LIMITES = {
  "/sign-up/email": "auth.inscription",
  "/send-verification-email": "auth.renvoi_verification",
  "/verify-email": "auth.verification",
  // 1.2 (docs/features/connexion.md, section 3).
  "/sign-in/email": "auth.connexion",
  "/sign-out": "auth.deconnexion",
  // 1.3 (docs/features/mot-de-passe.md, section 5).
  "/request-password-reset": "auth.reinitialisation_demande",
  "/reset-password": "auth.reinitialisation",
  // 1.4 : chemins internes appelés par les points de la double
  // authentification (docs/features/double-authentification.md, section 6).
  "/two-factor/verify-totp": "auth.double_auth_code",
  "/two-factor/verify-backup-code": "auth.double_auth_secours",
  "/two-factor/enable": "auth.double_auth_activation",
  "/two-factor/generate-backup-codes": "auth.double_auth_codes",
  "/two-factor/disable": "auth.double_auth_desactivation",
  // 1.5 : chemin interne du changement du mot de passe
  // (docs/features/profil-sessions.md, section 6).
  "/change-password": "auth.changement_mot_de_passe",
} as const satisfies Record<string, NomLimite>;

export type RegleBetterAuth = { window: number; max: number };

function regle(limite: Limite): RegleBetterAuth {
  return { window: limite.fenetreSecondes, max: limite.maximum };
}

// customRules de Better Auth, construites depuis LIMITES : elles remplacent,
// pour les chemins ouverts, ses règles spéciales par défaut.
export function reglesBetterAuth(
  limites: Readonly<Record<NomLimite, Limite>> = LIMITES,
): Record<string, RegleBetterAuth> {
  return Object.fromEntries(
    Object.entries(CHEMINS_LIMITES).map(([chemin, nom]) => [chemin, regle(limites[nom])]),
  );
}

export type StockageBetterAuth = {
  consume: (cle: string, regle: RegleBetterAuth) => Promise<{ allowed: boolean; retryAfter: null }>;
};

export function creerStockageBetterAuth(options: {
  limites: Readonly<Partial<Record<NomLimite, Limite>>>;
  compteur: Compteur;
  secret: Uint8Array;
}): StockageBetterAuth {
  const { limites, compteur, secret } = options;

  // La limite auth.* par adresse IP dont la règle est exactement celle reçue.
  // Deux limites auth.* n'ont jamais la même règle (limites.test.ts). La
  // limite par compte (adresse_email, 1.2) n'est jamais une règle de Better
  // Auth : elle est comptée par notre gestionnaire.
  function limiteDe(recue: RegleBetterAuth): [NomLimite, Limite] | null {
    for (const [nom, limite] of Object.entries(limites) as [NomLimite, Limite | undefined][]) {
      if (limite === undefined || !nom.startsWith("auth.") || limite.par !== "adresse_ip") continue;
      if (limite.fenetreSecondes === recue.window && limite.maximum === recue.max) {
        return [nom, limite];
      }
    }
    return null;
  }

  return {
    // retryAfter toujours nul : notre gestionnaire ne dit ni délai ni compte
    // (décision 2 de la 0.5).
    async consume(cle, recue) {
      const trouvee = limiteDe(recue);
      // Règle inconnue (une règle par défaut de Better Auth, après une mise à
      // jour par exemple) : refusée sans compter, plutôt que comptée sur une
      // fenêtre qu'aucune fiche n'a choisie.
      if (trouvee === null) return { allowed: false, retryAfter: null };
      const [nom, limite] = trouvee;
      // La clé de Better Auth (« adresse IP|chemin ») n'est jamais stockée :
      // seule son empreinte, sous le nom de la limite.
      const compte = await compteur.consommer(cleCompteur(nom, cle, secret), {
        maximum: limite.maximum,
        fenetreSecondes: limite.fenetreSecondes,
      });
      return { allowed: compte <= limite.maximum, retryAfter: null };
    },
  };
}

// Stockage lié aux vraies limites, au vrai compteur et à la clé dérivée de
// BETTER_AUTH_SECRET (comme verifierDebit).
export const stockageBetterAuth = creerStockageBetterAuth({
  limites: LIMITES,
  compteur: compteurReel,
  secret: deriverSecret(env.BETTER_AUTH_SECRET),
});
