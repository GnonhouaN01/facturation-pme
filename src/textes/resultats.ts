// Libellés des codes de résultat de la chaîne de contrôles (NF-01), pour les
// formulaires. Ni délai, ni compte, ni cause du refus (S-02). Fiche :
// docs/features/socle-interface.md, section 11.1.

export const TEXTES_RESULTATS = {
  connexion_requise: "Votre session a expiré. Connectez-vous à nouveau.",
  refuse: "Cette action n'est pas disponible.",
  trop_de_requetes: "Trop de tentatives. Patientez un instant, puis réessayez.",
  // 1.6 : action sensible ; le formulaire de confirmation suit (2.2).
  nouvelle_authentification_requise: "Confirmez votre identité pour continuer.",
  invalide: "Certains champs sont à corriger.",
  erreur: "Une erreur est survenue.",
} as const;
