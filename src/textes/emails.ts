// Textes des emails (NF-01), en texte brut. Le sujet et le nom de
// l'expéditeur sont fixes : aucun contenu saisi n'y entre (décision 7).
// Chaque corps se termine par neRepondezPas : la boîte du compte d'envoi
// n'est pas lue. Fiche : docs/features/envoi-emails.md, sections 3.2 et 3.3.

export const TEXTES_EMAILS = {
  expediteur: "Facturation PME",
  neRepondezPas:
    "Merci de ne pas répondre à cet email : cette adresse n'est pas lue. Pour toute question, contactez directement l'entreprise concernée.",
  modeles: {
    "essai.verification_envoi": {
      sujet: "Vérification de l'envoi des emails",
      corps:
        "Ceci est un email d'essai de Facturation PME. Il vérifie que l'envoi fonctionne ; aucune action n'est attendue de votre part.",
    },
    "compte.verification": {
      sujet: "Confirmez votre adresse email",
      corps:
        "Vous venez de créer un compte sur Facturation PME. Pour confirmer votre adresse email, ouvrez ce lien, puis cliquez sur « Confirmer mon adresse » :",
      validite:
        "Ce lien est valable une heure. Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email : aucun compte ne sera activé.",
    },
    // 1.3 (décision A) : liens vers la connexion et « mot de passe oublié »,
    // pages fixes écrites dans le modèle (docs/features/mot-de-passe.md,
    // sections 6.2 et 6.3). Vaut pour un compte vérifié ou non.
    "compte.existant": {
      sujet: "Tentative d'inscription avec votre adresse",
      corps:
        "Quelqu'un a tenté de créer un compte sur Facturation PME avec votre adresse email, qui a déjà un compte.",
      connexion: "Si c'est vous, connectez-vous depuis cette page :",
      oubli: "Si vous avez oublié votre mot de passe, choisissez-en un nouveau depuis cette page :",
      fin: "Si vous n'avez pas encore confirmé votre adresse, demandez un nouveau lien de confirmation depuis la page de connexion. Sinon, ignorez cet email : votre compte n'a pas été modifié.",
    },
    "compte.reinitialisation": {
      sujet: "Réinitialisation de votre mot de passe",
      corps:
        "Une demande de réinitialisation du mot de passe a été faite pour votre compte Facturation PME. Pour choisir un nouveau mot de passe, ouvrez ce lien, puis enregistrez votre nouveau mot de passe :",
      validite:
        "Ce lien est valable 30 minutes et ne sert qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
    },
    // Ni date, ni adresse IP, ni appareil (aucune donnée sensible, règle 17).
    "compte.mot_de_passe_modifie": {
      sujet: "Votre mot de passe a été modifié",
      corps:
        "Le mot de passe de votre compte Facturation PME vient d'être modifié, et toutes vos sessions ont été fermées. Si vous êtes à l'origine de ce changement, aucune action n'est attendue.",
      oubli: "Sinon, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    // 1.4 (docs/features/double-authentification.md, section 10).
    "compte.double_auth_activee": {
      sujet: "Double authentification activée",
      corps:
        "La double authentification vient d'être activée sur votre compte Facturation PME, et vos autres sessions ont été fermées. Chaque connexion demandera désormais le code de votre application d'authentification.",
      oubli:
        "Si vous n'êtes pas à l'origine de ce changement, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    "compte.double_auth_desactivee": {
      sujet: "Double authentification désactivée",
      corps:
        "La double authentification vient d'être désactivée sur votre compte Facturation PME, et vos autres sessions ont été fermées. Votre compte n'est plus protégé que par votre mot de passe.",
      oubli:
        "Si vous n'êtes pas à l'origine de ce changement, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    "compte.double_auth_remplacee": {
      sujet: "Application d'authentification remplacée",
      corps:
        "L'application d'authentification de votre compte Facturation PME vient d'être remplacée, et vos autres sessions ont été fermées. L'ancienne application et les anciens codes de secours ne servent plus.",
      oubli:
        "Si vous n'êtes pas à l'origine de ce changement, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    "compte.codes_secours_regeneres": {
      sujet: "Nouveaux codes de secours",
      corps:
        "De nouveaux codes de secours viennent d'être créés pour votre compte Facturation PME. Les anciens codes ne servent plus.",
      oubli:
        "Si vous n'êtes pas à l'origine de ce changement, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    "compte.code_secours_utilise": {
      sujet: "Code de secours utilisé",
      corps:
        "Un code de secours vient de servir à vous connecter à Facturation PME ; il ne servira plus. Si vous avez perdu votre téléphone, remplacez l'application d'authentification depuis la page de votre compte.",
      oubli:
        "Si ce n'est pas vous, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
    "compte.double_auth_tentatives": {
      sujet: "Codes de vérification refusés",
      corps:
        "De nombreux codes de vérification ont été saisis après le mot de passe de votre compte Facturation PME.",
      oubli:
        "Si ce n'est pas vous, quelqu'un connaît votre mot de passe : changez-le sans attendre depuis cette page :",
      suspension: "La connexion à votre compte reste suspendue 24 heures au plus.",
    },
    // 1.5 (docs/features/profil-sessions.md, section 8) : changement depuis
    // une session ; ni date, ni adresse IP, ni appareil.
    "compte.mot_de_passe_change": {
      sujet: "Votre mot de passe a été modifié",
      corps:
        "Le mot de passe de votre compte Facturation PME vient d'être modifié depuis une session ouverte, et vos autres sessions ont été fermées. Si vous êtes à l'origine de ce changement, aucune action n'est attendue.",
      oubli: "Sinon, choisissez sans attendre un nouveau mot de passe depuis cette page :",
    },
  },
} as const;
