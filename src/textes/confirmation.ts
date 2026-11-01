// Textes de la fenêtre de confirmation d'une action sensible (NF-01, S-14) :
// mot de passe, et code de l'application ou de secours. Livrée par la 2.2,
// reprise par la 2.4. Fiche : docs/features/parametres-organisation.md,
// section 7.

export const TEXTES_CONFIRMATION = {
  titre: "Confirmez votre identité",
  introduction:
    "Pour valider, saisissez votre mot de passe et un code de votre application d'authentification.",
  introductionSansCode: "Pour valider, saisissez votre mot de passe.",
  motDePasse: "Mot de passe",
  code: "Code de l'application",
  secours: "Code de secours",
  utiliserSecours: "Utiliser un code de secours",
  utiliserApplication: "Utiliser l'application",
  annuler: "Annuler",
  verification: "Vérification…",
  motDePasseVide: "Saisissez votre mot de passe.",
  motDePasseIncorrect: "Mot de passe incorrect.",
  codeVide: "Saisissez un code.",
  codeIncorrect: "Code incorrect.",
} as const;
