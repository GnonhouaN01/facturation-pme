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
    "compte.existant": {
      sujet: "Tentative d'inscription avec votre adresse",
      corps:
        "Quelqu'un a tenté de créer un compte sur Facturation PME avec votre adresse email, qui a déjà un compte. Si c'est vous, connectez-vous depuis la page de connexion de Facturation PME avec votre mot de passe. Si vous n'avez pas encore confirmé votre adresse, demandez un nouveau lien de confirmation depuis cette même page. Sinon, ignorez cet email : votre compte n'a pas été modifié.",
    },
  },
} as const;
