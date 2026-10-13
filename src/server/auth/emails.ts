import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { verifierDebit } from "../debit/debit";
import { VALEUR_APPLICATION, type NomLimite } from "../debit/limites";
import { adressePourCompteur } from "../email/adresse";
import { envoyerEmail, type DemandeEmail, type ResultatEnvoi } from "../email/envoi";
import type { ModeleEmail } from "../email/modeles";

// Les rappels d'envoi de Better Auth (vérification de l'adresse, compte
// existant). Chacun planifie l'envoi après la réponse et rend la main
// aussitôt : la durée de la réponse ne dépend pas de l'envoi, et une erreur
// d'envoi ne remonte jamais à Better Auth, qui la relancerait et dirait ainsi
// si l'adresse a un compte (T-07). Dans la tâche planifiée : les limites,
// puis la porte d'envoi, hors de toute transaction (règle 15). Seul fichier
// de auth/ qui importe envoyerEmail (règle T). Fiche :
// docs/features/inscription.md, section 4.

export type DependancesEmailsCompte = {
  // after() de Next.js en production : la tâche s'exécute après la réponse.
  planifier: (tache: () => Promise<void>) => void;
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  envoyerEmail: (demande: DemandeEmail) => Promise<ResultatEnvoi>;
};

// Ce que Better Auth passe aux rappels : seuls l'adresse et le jeton servent.
// L'adresse url de Better Auth (jeton dans la requête, callbackURL reçue) est
// ignorée : la porte construit le lien depuis le jeton seul.
type DonneesVerification = { user: { email: string }; url: string; token: string };
type DonneesCompteExistant = { user: { email: string } };

export type EmailsCompte = {
  emailVerification: (donnees: DonneesVerification, requete?: unknown) => Promise<void>;
  emailCompteExistant: (donnees: DonneesCompteExistant, requete?: unknown) => Promise<void>;
};

// Journal technique : le modèle, une raison fermée, un identifiant
// d'incident. Jamais l'adresse, le jeton, ni le message d'une erreur.
function consigner(modele: ModeleEmail, raison: "limite" | "erreur"): void {
  try {
    console.error("[email]", JSON.stringify({ modele, raison, incident: randomUUID() }));
  } catch {
    // Console défaillante : rien de plus à faire sans risquer de lever.
  }
}

export function creerEmailsCompte(dependances: DependancesEmailsCompte): EmailsCompte {
  async function envoyer(
    modele: ModeleEmail,
    destinataire: string,
    parametres: Record<string, unknown>,
  ): Promise<void> {
    try {
      const compteur = adressePourCompteur(destinataire);
      const limites: readonly (readonly [NomLimite, string])[] = [
        ["email.destinataire", compteur],
        ["email.destinataire_jour", compteur],
        ["email.compte", VALEUR_APPLICATION],
        ["email.application", VALEUR_APPLICATION],
      ];
      for (const [nom, valeur] of limites) {
        if (!(await dependances.verifierDebit(nom, valeur))) {
          consigner(modele, "limite");
          return;
        }
      }
      // La porte consigne elle-même un échec du transport (code et statut).
      await dependances.envoyerEmail({ modele, destinataire, parametres });
    } catch {
      consigner(modele, "erreur");
    }
  }

  function planifier(
    modele: ModeleEmail,
    destinataire: string,
    parametres: Record<string, unknown>,
  ): void {
    try {
      dependances.planifier(() => envoyer(modele, destinataire, parametres));
    } catch {
      consigner(modele, "erreur");
    }
  }

  return {
    emailVerification: async (donnees) => {
      planifier("compte.verification", donnees.user.email, { jeton: donnees.token });
    },
    emailCompteExistant: async (donnees) => {
      planifier("compte.existant", donnees.user.email, {});
    },
  };
}

const emails = creerEmailsCompte({
  planifier: (tache) => after(tache),
  verifierDebit,
  envoyerEmail,
});

export const planifierEmailVerification = emails.emailVerification;
export const planifierEmailCompteExistant = emails.emailCompteExistant;
