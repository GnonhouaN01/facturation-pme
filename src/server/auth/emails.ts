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
// docs/features/inscription.md, section 4. Mot de passe oublié (1.3) : le
// lien de réinitialisation et la notification, sur le budget
// email.reinitialisation ; la notification sans limite par destinataire
// (décision par défaut 8). Fiche : docs/features/mot-de-passe.md,
// sections 6.1 et 6.4.

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
  // 1.3 : sendResetPassword (url ignorée, comme pour la vérification), et la
  // notification planifiée par le rappel d'après réinitialisation.
  emailReinitialisation: (donnees: DonneesVerification, requete?: unknown) => Promise<void>;
  emailMotDePasseModifie: (donnees: DonneesCompteExistant, requete?: unknown) => Promise<void>;
};

// Les limites de chaque modèle de compte, dans l'ordre : destinataire, puis
// budget du modèle, puis l'application. « destinataire » est remplacé par
// l'adresse normalisée pour le compteur.
type Comptage = readonly (readonly [NomLimite, "destinataire" | "application"])[];

const PAR_DESTINATAIRE = [
  ["email.destinataire", "destinataire"],
  ["email.destinataire_jour", "destinataire"],
] as const;

const LIMITES_MODELE: Readonly<Partial<Record<ModeleEmail, Comptage>>> = {
  "compte.verification": [
    ...PAR_DESTINATAIRE,
    ["email.compte", "application"],
    ["email.application", "application"],
  ],
  "compte.existant": [
    ...PAR_DESTINATAIRE,
    ["email.compte", "application"],
    ["email.application", "application"],
  ],
  "compte.reinitialisation": [
    ...PAR_DESTINATAIRE,
    ["email.reinitialisation", "application"],
    ["email.application", "application"],
  ],
  // Ne suit que la consommation d'un jeton, lui-même envoyé sous les limites
  // par destinataire : borné par elles, et jamais réduit au silence par trois
  // emails dans l'heure.
  "compte.mot_de_passe_modifie": [
    ["email.reinitialisation", "application"],
    ["email.application", "application"],
  ],
};

// Journal technique : le modèle, une raison fermée, le nom de la limite
// atteinte (liste fermée, il ne désigne personne : surveillance de RR-13,
// docs/features/mot-de-passe.md, section 12.3), un identifiant d'incident.
// Jamais l'adresse, le jeton, ni le message d'une erreur.
function consigner(modele: ModeleEmail, raison: "limite" | "erreur", limite?: NomLimite): void {
  try {
    const ligne =
      limite === undefined
        ? { modele, raison, incident: randomUUID() }
        : { modele, raison, limite, incident: randomUUID() };
    console.error("[email]", JSON.stringify(ligne));
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
      // Un modèle sans limites déclarées n'est jamais envoyé.
      const limites = LIMITES_MODELE[modele];
      if (limites === undefined) throw new Error("modèle sans limites");
      for (const [nom, sorte] of limites) {
        const valeur = sorte === "destinataire" ? compteur : VALEUR_APPLICATION;
        if (!(await dependances.verifierDebit(nom, valeur))) {
          consigner(modele, "limite", nom);
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
    emailReinitialisation: async (donnees) => {
      planifier("compte.reinitialisation", donnees.user.email, { jeton: donnees.token });
    },
    emailMotDePasseModifie: async (donnees) => {
      planifier("compte.mot_de_passe_modifie", donnees.user.email, {});
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
export const planifierEmailReinitialisation = emails.emailReinitialisation;
export const planifierEmailMotDePasseModifie = emails.emailMotDePasseModifie;
