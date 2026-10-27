// Raison sociale d'une organisation (2.1), sans Zod : le formulaire du
// navigateur l'importe d'ici (regles-compte.ts, même raison). Le schéma du
// serveur (organisation.ts) applique les mêmes règles. Fiche :
// docs/features/organisations.md, section 4.

export const LONGUEUR_MIN_RAISON_SOCIALE = 2;
export const LONGUEUR_MAX_RAISON_SOCIALE = 100;
// Saisie brute bornée avant toute normalisation (T-42).
export const LONGUEUR_MAX_SAISIE_RAISON_SOCIALE = 400;

// Caractères de contrôle (tabulation et retour à la ligne compris), de format
// (marques de direction, espace sans chasse) et séparateurs de ligne ou de
// paragraphe : refusés, jamais retirés en silence.
const INTERDITS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const ESPACES = /\p{Zs}+/gu;
const LETTRE_OU_CHIFFRE = /[\p{L}\p{N}]/u;

// Forme enregistrée : NFC, espaces de bord retirés, suites d'espaces réduites
// à une seule.
export function normaliserRaisonSociale(saisie: string): string {
  return saisie.normalize("NFC").replaceAll(ESPACES, " ").trim();
}

// Vrai si la saisie, une fois normalisée, peut être enregistrée.
export function raisonSocialeValide(saisie: string): boolean {
  if (saisie.length > LONGUEUR_MAX_SAISIE_RAISON_SOCIALE || INTERDITS.test(saisie)) return false;
  const normalisee = normaliserRaisonSociale(saisie);
  const longueur = [...normalisee].length;
  return (
    longueur >= LONGUEUR_MIN_RAISON_SOCIALE &&
    longueur <= LONGUEUR_MAX_RAISON_SOCIALE &&
    LETTRE_OU_CHIFFRE.test(normalisee)
  );
}
