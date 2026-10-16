// Longueurs des champs de compte (1.1), sans Zod : les formulaires du
// navigateur les importent d'ici. Zod chargé dans le navigateur essaie
// new Function pour se compiler, ce que la politique de sécurité du contenu
// bloque et signale (violation « eval »). Les schémas du serveur
// (compte.ts) reprennent ces valeurs. Fiche : docs/features/inscription.md,
// section 5.2.

export const LONGUEUR_MIN_MOT_DE_PASSE = 12;
export const LONGUEUR_MAX_MOT_DE_PASSE = 128;
export const LONGUEUR_MAX_NOM = 100;

// Jeton de réinitialisation de Better Auth 1.7.7 (generateId(24)) : 24
// caractères [A-Za-z0-9], figé par jeton-reinitialisation-better-auth.test.ts.
// Lu par la page /lien/reinitialisation dans le fragment, et par le schéma du
// serveur. Fiche : docs/features/mot-de-passe.md, sections 2.1 et 3.4.
export const JETON_REINITIALISATION = /^[A-Za-z0-9]{24}$/u;
