// Textes des pages d'inscription et de vérification de l'adresse (NF-01).
// Les messages liés à la sécurité reprennent mot pour mot DESIGN-SYSTEM.md
// (lien expiré, erreur inattendue). Aucun message ne dit si une adresse a un
// compte (T-07). Fiche : docs/features/inscription.md, section 5.1.
// Connexion, page de compte et déconnexion (1.2) : le message d'échec de la
// connexion vaut pour une adresse inconnue, un mauvais mot de passe et un
// compte non vérifié, sans les distinguer. Fiche : docs/features/connexion.md,
// sections 2.1 et 5. Mot de passe oublié (1.3) : la confirmation de la
// demande est la même pour toute adresse (T-07). Fiche :
// docs/features/mot-de-passe.md, section 7. Double authentification (1.4) :
// étape du code de la connexion, état sur la page de compte, activation et
// gestion. Fiche : docs/features/double-authentification.md, sections 4, 5
// et 11.

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
    // Mot pour mot DESIGN-SYSTEM.md, « Connexion échouée ».
    identifiantsIncorrects: "Email ou mot de passe incorrect",
    // Aide fixe de la page, affichée quel que soit le résultat (T-07).
    aideConfirmation: "Si vous venez de créer votre compte, confirmez d'abord votre adresse.",
    nouveauLien: "Recevoir un nouveau lien de confirmation",
    creerCompte: "Créer un compte",
    motDePasseOublie: "Mot de passe oublié ?",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour vous connecter.",
    // 1.4 : étape du code (UC-02, étape 3 et erreurs 3a, 3b).
    introductionCode:
      "Saisissez le code à six chiffres affiché par votre application d'authentification.",
    codeLibelle: "Code de vérification",
    secoursLibelle: "Code de secours",
    verifier: "Vérifier le code",
    verificationEnCours: "Vérification en cours",
    utiliserSecours: "Utiliser un code de secours",
    utiliserApplication: "Utiliser le code de l'application",
    codeIncorrect: "Code incorrect.",
    codeVide: "Saisissez le code.",
    connexionExpiree: "Votre connexion a expiré. Reprenez depuis le début.",
  },
  motDePasseOublie: {
    titre: "Mot de passe oublié",
    introduction:
      "Saisissez l'adresse email de votre compte : un lien pour choisir un nouveau mot de passe vous sera envoyé.",
    email: "Adresse email",
    envoyer: "Recevoir un lien",
    envoiEnCours: "Envoi en cours",
    confirmation:
      "Si un compte existe pour cette adresse, un email vient de partir. Le lien est valable 30 minutes.",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour recevoir un lien.",
  },
  reinitialisation: {
    titre: "Choisir un nouveau mot de passe",
    message: "Saisissez votre nouveau mot de passe, puis enregistrez-le.",
    motDePasse: "Nouveau mot de passe",
    regleMotDePasse: "12 caractères au moins.",
    enregistrer: "Enregistrer le mot de passe",
    enregistrementEnCours: "Enregistrement en cours",
    // Mot pour mot DESIGN-SYSTEM.md, « Page ouverte par un lien expiré ».
    lienInvalide: "Ce lien n'est plus valable",
    nouveauLien: "Demander un nouveau lien",
    modifie: "Mot de passe modifié",
    confirmation: "Votre mot de passe a été modifié. Toutes vos sessions ont été fermées.",
    seConnecter: "Se connecter",
    sansJavaScript:
      "Activez JavaScript dans votre navigateur pour choisir un nouveau mot de passe.",
  },
  compte: {
    titre: "Votre compte",
    connecte: "Vous êtes connecté.",
    // 1.4.
    doubleAuthTitre: "Double authentification",
    doubleAuthActive: "Activée",
    doubleAuthInactive: "Non activée",
    activer: "Activer la double authentification",
    gerer: "Gérer la double authentification",
    // 1.5.
    profilTitre: "Profil",
    profilAide: "Votre nom et votre mot de passe.",
    modifierProfil: "Modifier le profil",
    sessionsTitre: "Sessions",
    sessionsAide: "Les navigateurs connectés à votre compte.",
    voirSessions: "Voir les sessions",
  },
  // 2.1 (docs/features/organisations.md, section 9).
  organisations: {
    titre: "Vos organisations",
    aucune: "Vous n'êtes membre d'aucune organisation.",
    role: "Rôle :",
    ouvrir: "Ouvrir l'organisation",
    ouvertureEnCours: "Ouverture en cours",
    doubleAuthRequise: "Activez la double authentification pour ouvrir cette organisation.",
    creerTitre: "Créer une organisation",
    raisonSociale: "Raison sociale",
    aide: "Le nom de votre entreprise, tel qu'il apparaîtra sur vos documents. Vous compléterez la fiche ensuite.",
    erreurRaisonSociale:
      "Saisissez une raison sociale de 2 à 100 caractères, avec au moins une lettre ou un chiffre.",
    creer: "Créer l'organisation",
    creationEnCours: "Création en cours",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour gérer vos organisations.",
  },
  // 1.5 (docs/features/profil-sessions.md, sections 4, 5 et 9).
  profil: {
    titre: "Profil",
    email: "Adresse email",
    nomTitre: "Nom",
    nom: "Nom",
    enregistrerNom: "Enregistrer le nom",
    nomEnregistre: "Nom enregistré.",
    motDePasseTitre: "Mot de passe",
    motDePasseAide:
      "Changer votre mot de passe ferme vos autres sessions ; ce navigateur reste connecté.",
    motDePasseActuel: "Mot de passe actuel",
    nouveauMotDePasse: "Nouveau mot de passe",
    changer: "Changer le mot de passe",
    motDePasseChange: "Mot de passe modifié. Vos autres sessions ont été fermées.",
    motDePasseIncorrect: "Mot de passe actuel incorrect.",
    envoiEnCours: "Envoi en cours",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour modifier votre profil.",
  },
  sessions: {
    titre: "Sessions",
    introduction:
      "Chaque session est un navigateur connecté à votre compte. Fermez celles que vous ne reconnaissez pas.",
    courante: "Cette session",
    fermer: "Fermer",
    fermerAutres: "Fermer les autres sessions",
    adresseIp: "Adresse IP",
    adresseInconnue: "inconnue",
    ouverteLe: "Ouverte le",
    expireLe: "Expire le",
    aucuneAutre: "Aucune autre session n'est ouverte.",
    envoiEnCours: "Envoi en cours",
    navigateurInconnu: "Navigateur inconnu",
    systemeInconnu: "système inconnu",
    sur: "sur",
    sansJavaScript: "Activez JavaScript dans votre navigateur pour fermer une session.",
  },
  doubleAuth: {
    titre: "Double authentification",
    introduction:
      "Chaque connexion demandera, après votre mot de passe, un code affiché par une application d'authentification sur votre téléphone.",
    obligatoire: "Obligatoire pour les Propriétaires et les Comptables.",
    motDePasse: "Mot de passe",
    continuer: "Continuer",
    qr: "Code QR à scanner avec votre application d'authentification",
    etapeQr: "Scannez ce code QR avec votre application d'authentification.",
    cle: "Ou saisissez cette clé dans l'application :",
    code: "Code affiché par l'application",
    confirmer: "Activer la double authentification",
    confirmerRemplacement: "Confirmer la nouvelle application",
    codesTitre: "Codes de secours",
    codesAide:
      "Chaque code ne sert qu'une fois, si vous n'avez plus votre téléphone. Gardez-les en lieu sûr : ils ne seront plus affichés.",
    copier: "Copier les codes",
    copies: "Codes copiés.",
    conserve: "J'ai conservé mes codes",
    terminer: "Terminer",
    activee: "La double authentification est activée.",
    codesRestants: "Codes de secours restants :",
    gestionCode: "Code de l'application ou code de secours",
    nouveauxCodes: "Créer de nouveaux codes",
    remplacer: "Remplacer l'application",
    desactiver: "Désactiver la double authentification",
    nouveauxCodesTitre: "Créer de nouveaux codes de secours",
    remplacerTitre: "Remplacer l'application d'authentification",
    desactiverTitre: "Désactiver la double authentification",
    desactiverAvertissement:
      "Votre compte ne sera plus protégé que par votre mot de passe, et vos autres sessions seront fermées.",
    remplacerAide:
      "Utilisez un code de secours si vous n'avez plus l'ancienne application. Les anciens codes de secours ne serviront plus.",
    annuler: "Annuler",
    envoiEnCours: "Envoi en cours",
    desactivee: "La double authentification est désactivée.",
    motDePasseIncorrect: "Mot de passe incorrect.",
    codeIncorrect: "Code incorrect.",
    codeVide: "Saisissez le code.",
    obligatoireRefus:
      "La double authentification ne peut pas être désactivée : votre rôle dans une organisation l'impose.",
    sansJavaScript:
      "Activez JavaScript dans votre navigateur pour gérer la double authentification.",
  },
  deconnexion: {
    bouton: "Se déconnecter",
    enCours: "Déconnexion en cours",
  },
  erreurs: {
    nom: "Saisissez votre nom.",
    email: "Saisissez une adresse email valable.",
    motDePasse: "Saisissez votre mot de passe.",
    motDePasseTropCourt: "Le mot de passe doit compter 12 caractères au moins.",
    motDePasseTropLong: "Le mot de passe doit compter 128 caractères au plus.",
    motDePasseCompromis:
      "Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre.",
  },
} as const;
