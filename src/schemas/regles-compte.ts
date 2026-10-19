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

// Double authentification (1.4). Code de l'application : 6 chiffres ASCII.
// Codes de secours : 10 caractères d'un alphabet sans confusion à la lecture
// (ni i, l, o, 0, 1), présentés xxxxx-xxxxx ; la saisie admet espaces,
// tirets et majuscules, normalisés ici, côté navigateur comme côté serveur.
// Fiche : docs/features/double-authentification.md, sections 2.1 et 3.2.
export const CODE_TOTP = /^[0-9]{6}$/u;
export const ALPHABET_CODES_SECOURS = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_SECOURS = /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/u;
export const LONGUEUR_MAX_CODE_SAISI = 20;

// Forme canonique xxxxx-xxxxx d'un code de secours saisi, ou null.
export function normaliserCodeSecours(saisie: string): string | null {
  const brut = saisie.replaceAll(/[\s-]/gu, "").toLowerCase();
  if (brut.length !== 10) return null;
  for (const caractere of brut) {
    if (!ALPHABET_CODES_SECOURS.includes(caractere)) return null;
  }
  return `${brut.slice(0, 5)}-${brut.slice(5)}`;
}
