// Textes de la page publique « Données personnelles » (NF-01), information
// des personnes au sens de la loi n° 2013-450. Chaque affirmation vient du
// code, de la configuration ou des documents du dépôt (sources : fiche,
// section 2) ; ce qui n'est pas établi porte la marque A_COMPLETER, que le
// verrou d'ouverture refuse dès que les comptes sont ouverts en production
// (donnees-personnelles.test.ts). Fiche :
// docs/features/donnees-personnelles.md.

export const A_COMPLETER = "À COMPLÉTER";

function aCompleter(quoi: string): string {
  return `${A_COMPLETER} : ${quoi}.`;
}

export const ADRESSE_CONTACT = "facturation.pme.civ@gmail.com";
export const SITE_ARTCI = "https://www.autoritedeprotection.ci";

export type BlocDonnees =
  | { type: "paragraphe"; texte: string }
  | { type: "liste"; elements: readonly string[] }
  // Lien hors de l'application : adresse email ou site de l'ARTCI, jamais
  // une ressource chargée par la page.
  | { type: "lien"; libelle: string; adresse: string }
  | {
      type: "traitement";
      titre: string;
      lignes: readonly (readonly [terme: string, valeur: string])[];
    };

export type SectionDonnees = { titre: string; blocs: readonly BlocDonnees[] };

const BASE_LEGALE = "Base légale";
const DONNEES = "Données";
const FINALITE = "Pourquoi";

const lienContact: BlocDonnees = {
  type: "lien",
  libelle: ADRESSE_CONTACT,
  adresse: `mailto:${ADRESSE_CONTACT}`,
};

export const TEXTES_DONNEES_PERSONNELLES = {
  titre: "Données personnelles",
  introduction:
    "Cette page explique quelles données personnelles Facturation PME traite, pourquoi, combien de temps, à qui elles sont transmises et comment exercer vos droits, conformément à la loi n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel.",
  miseAJour: "Page mise à jour le 27/10/2026.",
  liens: {
    piedDePage: "Données personnelles",
    inscription: "Comment nous traitons vos données",
    connexion: "Comment nous traitons vos données",
  },
  sections: [
    {
      titre: "Responsable du traitement",
      blocs: [
        {
          type: "paragraphe",
          texte: "Ngolo Gnonhoua, Abidjan, Côte d'Ivoire. Pour toute question, écrivez à :",
        },
        lienContact,
      ],
    },
    {
      titre: "Deux rôles différents",
      blocs: [
        {
          type: "paragraphe",
          texte:
            "Pour votre compte utilisateur, Facturation PME est responsable du traitement : nous décidons des données collectées et de leur usage.",
        },
        {
          type: "paragraphe",
          texte:
            "Pour les données qu'une entreprise saisit sur ses propres clients (fiches clients, devis, factures), l'entreprise est responsable du traitement. Facturation PME agit alors comme sous-traitant : nous traitons ces données pour le compte de l'entreprise. Si vous êtes client d'une entreprise, adressez-vous à elle pour exercer vos droits.",
        },
      ],
    },
    {
      titre: "Les données traitées",
      blocs: [
        {
          type: "traitement",
          titre: "Votre compte",
          lignes: [
            [
              DONNEES,
              "Votre nom, votre adresse email, l'indication que l'adresse est confirmée ou non, et votre mot de passe, enregistré sous forme d'empreinte, jamais en clair.",
            ],
            [
              FINALITE,
              "Créer votre compte, vous connecter, et vous écrire au sujet de votre compte : confirmation de l'adresse, mot de passe oublié, alertes de sécurité.",
            ],
            [BASE_LEGALE, aCompleter("base légale du traitement des comptes")],
          ],
        },
        {
          type: "traitement",
          titre: "Double authentification, si vous l'activez",
          lignes: [
            [
              DONNEES,
              "La clé de votre application d'authentification, enregistrée chiffrée, et vos codes de secours, enregistrés sous forme d'empreinte. Pendant une connexion, une marque temporaire indique que le mot de passe a été donné et que le code est attendu.",
            ],
            [FINALITE, "Protéger votre compte par un second facteur."],
            [BASE_LEGALE, aCompleter("base légale de la double authentification")],
          ],
        },
        {
          type: "traitement",
          titre: "Sessions",
          lignes: [
            [
              DONNEES,
              "Pour chaque navigateur connecté à votre compte : l'adresse IP, le navigateur et le système tels que le navigateur les annonce, la date d'ouverture et la date d'expiration.",
            ],
            [
              FINALITE,
              "Vous garder connecté, et vous montrer les navigateurs connectés à votre compte pour que vous fermiez ceux que vous ne reconnaissez pas.",
            ],
            [BASE_LEGALE, aCompleter("base légale du traitement des sessions")],
          ],
        },
        {
          type: "traitement",
          titre: "Liens et confirmations à usage unique",
          lignes: [
            [
              DONNEES,
              "Le lien de réinitialisation du mot de passe, enregistré sous forme d'empreinte. Le lien de confirmation de l'adresse, qui n'est pas enregistré. La confirmation de votre mot de passe avant une action sensible.",
            ],
            [
              FINALITE,
              "Vérifier que c'est bien vous qui confirmez votre adresse, changez votre mot de passe ou faites une action sensible.",
            ],
            [BASE_LEGALE, aCompleter("base légale des liens et confirmations")],
          ],
        },
        {
          type: "traitement",
          titre: "Limites de tentatives",
          lignes: [
            [
              DONNEES,
              "Des compteurs de tentatives, liés à une empreinte de l'adresse IP, de l'adresse email ou du compte, jamais à la valeur en clair.",
            ],
            [FINALITE, "Freiner les essais de mots de passe et les abus."],
            [BASE_LEGALE, aCompleter("base légale des limites de tentatives")],
          ],
        },
        {
          type: "traitement",
          titre: "Journal d'audit",
          lignes: [
            [
              DONNEES,
              "Pour chaque action importante dans une entreprise : l'identifiant de son auteur, l'action, l'élément concerné et la date, sans aucun texte libre.",
            ],
            [
              FINALITE,
              "Garder la trace des actions importantes : membres, réglages de l'entreprise. Le journal n'est jamais modifié ni supprimé par l'application.",
            ],
            [BASE_LEGALE, aCompleter("base légale du journal d'audit")],
          ],
        },
        {
          type: "traitement",
          titre: "Données de facturation, à venir",
          lignes: [
            [
              DONNEES,
              "Les fiches clients, devis, factures et paiements que chaque entreprise saisira. Ces fonctions ne sont pas encore disponibles.",
            ],
            [
              FINALITE,
              "Permettre à l'entreprise de facturer ses clients. L'entreprise est responsable de ces données ; un document émis n'est jamais modifié.",
            ],
            [BASE_LEGALE, aCompleter("base légale des données de facturation")],
          ],
        },
        {
          type: "paragraphe",
          texte:
            "Les journaux techniques du serveur ne contiennent ni adresse email, ni mot de passe, ni lien ou jeton de connexion.",
        },
      ],
    },
    {
      titre: "Ce que nous ne faisons pas",
      blocs: [
        {
          type: "liste",
          elements: [
            "Aucune publicité et aucun profilage.",
            "Aucune mesure d'audience : le site ne charge aucun script ni aucune ressource d'un autre site, et ne pose aucun cookie tiers.",
            "Nous ne demandons ni date de naissance, ni pièce d'identité, ni coordonnées bancaires, et nous ne collectons pas votre position.",
          ],
        },
      ],
    },
    {
      titre: "Cookies",
      blocs: [
        {
          type: "paragraphe",
          texte:
            "Un visiteur qui ne se connecte pas ne reçoit aucun cookie. Le site pose deux cookies, nécessaires à la connexion, et aucun autre :",
        },
        {
          type: "traitement",
          titre: "__Secure-better-auth.session_token",
          lignes: [
            ["Rôle", "Vous garder connecté."],
            ["Durée", "7 jours au plus. Posé à la connexion, effacé à la déconnexion."],
          ],
        },
        {
          type: "traitement",
          titre: "__Secure-better-auth.two_factor",
          lignes: [
            [
              "Rôle",
              "Pendant la connexion d'un compte à double authentification, retenir que le mot de passe a été donné, en attendant le code.",
            ],
            ["Durée", "5 minutes. Effacé dès que le code est accepté."],
          ],
        },
        {
          type: "paragraphe",
          texte:
            "Ces cookies ne sont lisibles par aucun script de la page et ne circulent que par une connexion chiffrée.",
        },
      ],
    },
    {
      titre: "Durées de conservation",
      blocs: [
        {
          type: "liste",
          elements: [
            "Compte : tant qu'il existe. Un compte dont l'adresse n'a pas été confirmée est supprimé après 7 jours.",
            "Double authentification : tant qu'elle est active ; tout est supprimé quand vous la désactivez. Connexion en attente du code : 5 minutes.",
            "Sessions : 7 jours au plus, jamais prolongées. Une session est supprimée à la déconnexion ; changer votre mot de passe ferme vos autres sessions, et le réinitialiser les ferme toutes. Les sessions expirées sont effacées chaque jour.",
            "Liens et confirmations : 30 minutes pour la réinitialisation du mot de passe, effacé au premier usage ; 1 heure pour la confirmation de l'adresse ; 5 minutes pour la confirmation avant une action sensible. Ceux qui ont expiré sont effacés chaque jour.",
            "Compteurs de tentatives : 24 heures au plus, effacés chaque jour.",
            `Journal d'audit : ${aCompleter("durée de conservation du journal d'audit")}`,
            `Données de facturation : ${aCompleter("durée de conservation des données de facturation")}`,
            `Journaux techniques du serveur : ${aCompleter("durée de conservation des journaux de l'hébergeur")}`,
            `Compte supprimé : la suppression du compte n'est pas encore proposée dans l'application ; demandez-la par email (voir « Vos droits »). Délai d'effacement : ${aCompleter("délai d'effacement après une demande de suppression")}`,
          ],
        },
      ],
    },
    {
      titre: "Destinataires et prestataires techniques",
      blocs: [
        {
          type: "paragraphe",
          texte:
            "Vos données ne sont transmises qu'aux prestataires qui font fonctionner le service :",
        },
        {
          type: "liste",
          elements: [
            "Vercel, hébergement du site : le serveur fonctionne à Francfort, en Allemagne. Les pages du site sont aussi distribuées par le réseau mondial de Vercel.",
            "Neon, base de données : région Europe Central 1, à Francfort, en Allemagne.",
            `Google, envoi des emails par Gmail : reçoit l'adresse du destinataire et le texte du message. Une copie reste dans les messages envoyés du compte d'envoi, vidés chaque mois. Pays de traitement : ${aCompleter("pays où Google traite les emails")}`,
            "Have I Been Pwned, service de Cloudflare, vérification qu'un mot de passe n'a pas déjà été divulgué : reçoit seulement les 5 premiers caractères d'une empreinte du mot de passe, jamais le mot de passe ni votre adresse email.",
          ],
        },
      ],
    },
    {
      titre: "Transfert hors de la CEDEAO",
      blocs: [
        {
          type: "paragraphe",
          texte:
            "Ces prestataires sont situés hors de la CEDEAO. Vos données sont hébergées en Allemagne (Vercel, Neon). Les emails passent par Google, et la vérification des mots de passe par le réseau mondial de Cloudflare.",
        },
        {
          type: "paragraphe",
          texte: `Formalités ARTCI : ${A_COMPLETER} (déclaration préalable et demande d'autorisation de transfert, numéro de récépissé).`,
        },
      ],
    },
    {
      titre: "Sécurité",
      blocs: [
        {
          type: "liste",
          elements: [
            "Votre mot de passe est enregistré sous forme d'empreinte, jamais en clair. Un mot de passe déjà divulgué lors d'une fuite connue est refusé.",
            "Vous pouvez activer la double authentification : un code de votre téléphone, en plus du mot de passe.",
            "Les connexions sont chiffrées : entre votre navigateur et le site, et entre le site et la base de données.",
            "Chaque entreprise ne voit que ses propres données : la séparation est appliquée par la base de données elle-même.",
            "Les tentatives de connexion sont limitées.",
          ],
        },
      ],
    },
    {
      titre: "Vos droits",
      blocs: [
        {
          type: "paragraphe",
          texte:
            "Vous avez le droit d'accéder à vos données, de les faire rectifier, de vous opposer à leur traitement et d'en demander la suppression.",
        },
        {
          type: "paragraphe",
          texte:
            "Dans votre compte, vous pouvez déjà modifier votre nom, changer votre mot de passe, voir et fermer vos sessions, et activer ou désactiver la double authentification.",
        },
        {
          type: "paragraphe",
          texte:
            "Pour toute autre demande (copie de vos données, correction de votre adresse email, opposition, suppression du compte), écrivez à :",
        },
        lienContact,
        {
          type: "liste",
          elements: [
            `Preuve de votre identité : ${aCompleter("façon de prouver son identité")}`,
            `Délai de réponse : ${aCompleter("délai de réponse à une demande")}`,
          ],
        },
        {
          type: "paragraphe",
          texte:
            "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'ARTCI, autorité de protection des données de Côte d'Ivoire :",
        },
        { type: "lien", libelle: "www.autoritedeprotection.ci", adresse: SITE_ARTCI },
      ],
    },
  ] satisfies readonly SectionDonnees[],
} as const;
