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
  },
} as const;
