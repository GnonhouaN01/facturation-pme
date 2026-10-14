// Textes des pages d'inscription et de vérification de l'adresse (NF-01).
// Les messages liés à la sécurité reprennent mot pour mot DESIGN-SYSTEM.md
// (lien expiré, erreur inattendue). Aucun message ne dit si une adresse a un
// compte (T-07). Fiche : docs/features/inscription.md, section 5.1.
// Connexion, page de compte et déconnexion (1.2) : le message d'échec de la
// connexion vaut pour une adresse inconnue, un mauvais mot de passe et un
// compte non vérifié, sans les distinguer. Fiche : docs/features/connexion.md,
// sections 2.1 et 5.

export const TEXTES_COMPTE = {
  inscription: {
    titre: "Créer un compte",
    introduction:
      "Après l'inscription, un email vous permet de confirmer votre adresse avant tout accès.",
    nom: "Nom",
    email: "Adresse email",
    motDePasse: "Mot de passe",
    regleMotDePasse: "12 caractères au moins.",
    envoyer: "Créer mon compte",
    envoiEnCours: "Création en cours",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour créer un compte.",
  },
  envoyee: {
    titre: "Vérifiez votre boîte de réception",
    message:
      "Si l'adresse saisie est valable, un email vient de partir. Ouvrez le lien qu'il contient pour confirmer votre adresse. Le lien est valable une heure.",
  },
  renvoi: {
    titre: "Recevoir un nouveau lien",
    email: "Adresse email",
    envoyer: "Renvoyer le lien",
    envoiEnCours: "Envoi en cours",
    confirmation:
      "Si un compte attend la vérification de cette adresse, un nouveau lien vient de partir.",
  },
  verification: {
    titre: "Confirmer votre adresse",
    message: "Cliquez sur le bouton pour confirmer votre adresse email et ouvrir votre session.",
    confirmer: "Confirmer mon adresse",
    confirmationEnCours: "Confirmation en cours",
    // Mot pour mot DESIGN-SYSTEM.md, « Page ouverte par un lien expiré ».
    lienInvalide: "Ce lien n'est plus valable",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour confirmer votre adresse.",
  },
  verifiee: {
    titre: "Adresse vérifiée",
    message: "Votre adresse email est confirmée et votre session est ouverte.",
    lienCompte: "Accéder à mon compte",
  },
  connexion: {
    titre: "Se connecter",
    email: "Adresse email",
    motDePasse: "Mot de passe",
    envoyer: "Se connecter",
    envoiEnCours: "Connexion en cours",
    identifiantsIncorrects:
      "Adresse email ou mot de passe incorrect. Si vous venez de créer votre compte, confirmez d'abord votre adresse.",
    nouveauLien: "Recevoir un nouveau lien de confirmation",
    creerCompte: "Créer un compte",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour vous connecter.",
  },
  compte: {
    titre: "Votre compte",
    connecte: "Vous êtes connecté.",
  },
  deconnexion: {
    bouton: "Se déconnecter",
    enCours: "Déconnexion en cours",
  },
  erreurs: {
    nom: "Saisissez votre nom.",
    email: "Saisissez une adresse email valable.",
    motDePasseTropCourt: "Le mot de passe doit compter 12 caractères au moins.",
    motDePasseTropLong: "Le mot de passe doit compter 128 caractères au plus.",
    motDePasseCompromis:
      "Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre.",
  },
} as const;
