import "server-only";

// Les limites de débit : source unique. Une fonctionnalité qui en ajoute une
// le fait ici, dans sa PR. Le nom apparaît en clair dans la clé du compteur :
// il ne désigne personne. Fiche : docs/features/limitation-debit.md,
// section 1.

export type Limite = {
  maximum: number;
  fenetreSecondes: number;
  // Ce que la clé désigne : l'utilisateur de la session (étape 4 de la
  // chaîne) ; pour les emails (0.7), l'application entière, l'organisation de
  // la transaction ou l'adresse du destinataire, normalisée pour le compteur ;
  // pour les points d'entrée de Better Auth (1.1), l'adresse IP, lue par
  // Better Auth lui-même et jamais stockée en clair ; pour la connexion par
  // compte (1.2), l'adresse email saisie, normalisée comme un destinataire,
  // comptée pour toute adresse, avec ou sans compte (T-07).
  par:
    | "utilisateur"
    | "application"
    | "organisation"
    | "destinataire"
    | "adresse_ip"
    | "adresse_email";
};

export const LIMITES = {
  // Actions des membres, par la chaîne de contrôles (décision 4).
  "membre.action": { maximum: 60, fenetreSecondes: 60, par: "utilisateur" },
  // Envoi d'emails (S-55, T-40), vérifiées par la chaîne après la validation
  // de la transaction, dans cet ordre : destinataire, destinataire_jour,
  // organisation, application. Un seul compte Gmail sert tout : 2 × 200 reste
  // sous ses 500 par jour, même au bord de la fenêtre fixe. Valeurs de la
  // décision 5, à revoir aux jalons 6 et 8. Fiche :
  // docs/features/envoi-emails.md, section 5.2.
  "email.destinataire": { maximum: 3, fenetreSecondes: 60 * 60, par: "destinataire" },
  "email.destinataire_jour": { maximum: 10, fenetreSecondes: 24 * 60 * 60, par: "destinataire" },
  "email.organisation": { maximum: 40, fenetreSecondes: 24 * 60 * 60, par: "organisation" },
  "email.application": { maximum: 200, fenetreSecondes: 24 * 60 * 60, par: "application" },
  // Emails sans organisation (vérification, compte existant ; la
  // réinitialisation a son propre budget depuis la 1.3, plus bas) : jamais
  // plus de la moitié d'email.application. Vérifiée avant
  // elle, après les deux limites par destinataire. Fiche :
  // docs/features/inscription.md, section 3.2.
  "email.compte": { maximum: 100, fenetreSecondes: 24 * 60 * 60, par: "application" },
  // Points d'entrée de Better Auth, par adresse IP (S-11, T-41). Les règles
  // de Better Auth sont construites depuis ces valeurs (debit/better-auth.ts) ;
  // deux d'entre elles n'ont jamais la même fenêtre et le même maximum, le
  // stockage reconnaissant une limite à sa règle.
  "auth.inscription": { maximum: 5, fenetreSecondes: 60 * 60, par: "adresse_ip" },
  "auth.renvoi_verification": { maximum: 3, fenetreSecondes: 60 * 60, par: "adresse_ip" },
  "auth.verification": { maximum: 10, fenetreSecondes: 10 * 60, par: "adresse_ip" },
  // Tout autre chemin, ouvert plus tard par une fiche : valeur sûre.
  "auth.defaut": { maximum: 30, fenetreSecondes: 60, par: "adresse_ip" },
  // Connexion et déconnexion (1.2, S-11, T-01) : par adresse IP dans Better
  // Auth ; par compte dans notre gestionnaire, avant Better Auth. Toutes les
  // tentatives comptent. Un tiers peut bloquer un compte 15 minutes sans
  // apprendre s'il existe (RR-12). Fiche : docs/features/connexion.md,
  // section 3.
  "auth.connexion": { maximum: 10, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  "auth.connexion_compte": { maximum: 5, fenetreSecondes: 15 * 60, par: "adresse_email" },
  "auth.deconnexion": { maximum: 20, fenetreSecondes: 60, par: "adresse_ip" },
  // Mot de passe oublié (1.3, S-11, T-43) : demandes par adresse IP dans
  // Better Auth, et par adresse email dans notre gestionnaire, comptée pour
  // toute adresse (T-07) ; réinitialisations par adresse IP dans Better Auth.
  // Un tiers peut bloquer la demande d'une adresse une heure (RR-12). Fiche :
  // docs/features/mot-de-passe.md, section 5.
  "auth.reinitialisation_demande": { maximum: 4, fenetreSecondes: 60 * 60, par: "adresse_ip" },
  "auth.reinitialisation_compte": { maximum: 2, fenetreSecondes: 60 * 60, par: "adresse_email" },
  "auth.reinitialisation": { maximum: 6, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  // Emails de la réinitialisation (lien et notification), à part
  // d'email.compte : une vague d'inscriptions ne bloque pas « mot de passe
  // oublié », et inversement. email.compte + email.reinitialisation restent
  // sous email.application (RR-13, décision C). Fiche :
  // docs/features/mot-de-passe.md, section 6.4.
  "email.reinitialisation": { maximum: 50, fenetreSecondes: 24 * 60 * 60, par: "application" },
  // Double authentification (1.4, S-11, T-06) : par adresse IP dans Better
  // Auth, une règle par chemin interne ; par compte dans notre passerelle :
  // 20 codes de connexion par 24 heures (décision 3, RR-14) et 10 opérations
  // de gestion par heure, comptés pour l'utilisateur, avant tout contrôle de
  // code ou de mot de passe. Budget d'emails propre, sous email.application
  // avec email.compte et email.reinitialisation. Fiche :
  // docs/features/double-authentification.md, sections 6 et 10.
  "auth.double_auth_code": { maximum: 12, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  "auth.double_auth_secours": { maximum: 8, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  "auth.double_auth_activation": { maximum: 6, fenetreSecondes: 60 * 60, par: "adresse_ip" },
  "auth.double_auth_codes": { maximum: 3, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  "auth.double_auth_desactivation": { maximum: 4, fenetreSecondes: 15 * 60, par: "adresse_ip" },
  "auth.double_auth_compte": { maximum: 20, fenetreSecondes: 24 * 60 * 60, par: "utilisateur" },
  "auth.double_auth_gestion": { maximum: 10, fenetreSecondes: 60 * 60, par: "utilisateur" },
  "email.double_auth": { maximum: 40, fenetreSecondes: 24 * 60 * 60, par: "application" },
  // Profil et sessions (1.5, S-11, T-01) : par utilisateur dans notre
  // passerelle, les quatre points (révocations, mot de passe, nom), puis les
  // essais du mot de passe actuel, avant toute vérification ; par adresse IP
  // dans Better Auth, chemin interne /change-password. La notification part
  // sur email.reinitialisation. Fiche : docs/features/profil-sessions.md,
  // sections 6 et 8.
  "auth.profil_compte": { maximum: 30, fenetreSecondes: 60 * 60, par: "utilisateur" },
  "auth.mot_de_passe_compte": { maximum: 8, fenetreSecondes: 24 * 60 * 60, par: "utilisateur" },
  "auth.changement_mot_de_passe": { maximum: 4, fenetreSecondes: 10 * 60, par: "adresse_ip" },
  // Nouvelle authentification (1.6) : essais du mot de passe et du code par
  // une session, dans notre passerelle, avant toute vérification ; Better
  // Auth ne limite ni l'un ni l'autre avec une session. Fiche :
  // docs/features/nouvelle-authentification.md, section 5.
  "auth.nouvelle_authentification": {
    maximum: 10,
    fenetreSecondes: 24 * 60 * 60,
    par: "utilisateur",
  },
  // Création d'une organisation (2.1, UC-06 abus, T-41) : par utilisateur,
  // à l'étape 4 de la chaîne « portée compte ». Aucun plafond total. Fiche :
  // docs/features/organisations.md, section 7.
  "organisation.creation": { maximum: 3, fenetreSecondes: 24 * 60 * 60, par: "utilisateur" },
} as const satisfies Record<string, Limite>;

// Valeur comptée par les limites « par application » : un seul compte Gmail
// sert toute l'application.
export const VALEUR_APPLICATION = "gmail";

export type NomLimite = keyof typeof LIMITES;

// La plus longue fenêtre d'un ensemble de limites : au-delà, une ligne du
// compteur ne peut plus servir (purge, section 7).
export function fenetreMaxSecondes(limites: Readonly<Record<string, Limite>>): number {
  const fenetres = Object.values(limites).map((limite) => limite.fenetreSecondes);
  // Sans limite, Math.max renverrait -Infinity : la purge viderait tout.
  if (fenetres.length === 0) throw new Error("Aucune limite de débit déclarée.");
  return Math.max(...fenetres);
}
