// Longueurs des champs de compte (1.1), sans Zod : les formulaires du
// navigateur les importent d'ici. Zod chargé dans le navigateur essaie
// new Function pour se compiler, ce que la politique de sécurité du contenu
// bloque et signale (violation « eval »). Les schémas du serveur
// (compte.ts) reprennent ces valeurs. Fiche : docs/features/inscription.md,
// section 5.2.

export const LONGUEUR_MIN_MOT_DE_PASSE = 12;
export const LONGUEUR_MAX_MOT_DE_PASSE = 128;
export const LONGUEUR_MAX_NOM = 100;
