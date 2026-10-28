// Règles des paramètres de l'organisation (2.2), sans Zod : le formulaire du
// navigateur les importe d'ici, le schéma du serveur (parametres.ts) les
// applique, et le schéma de la base (src/server/db/schema/parametres.ts) en
// tire ses contraintes CHECK. Les longueurs se comptent en caractères
// Unicode (points de code), comme char_length de PostgreSQL. Fiche :
// docs/features/parametres-organisation.md, sections 3 à 6.

export type RegleTexte = {
  // Longueur maximale du texte normalisé, en points de code.
  max: number;
  // Nombre maximal de lignes ; 1 : aucun retour à la ligne.
  lignes: number;
  // Caractères admis, au-delà des interdits communs (null : tout le reste).
  motif: RegExp | null;
};

// Numéro de contribuable et registre du commerce : format exact non établi
// dans le dépôt (À CONFIRMER), borne technique seulement.
const IDENTIFIANT = /^[\p{L}\p{N} ./-]+$/u;

export const REGLES_TEXTE = {
  adresse: { max: 300, lignes: 5, motif: null },
  ncc: { max: 30, lignes: 1, motif: IDENTIFIANT },
  rccm: { max: 50, lignes: 1, motif: IDENTIFIANT },
  regimeImposition: { max: 100, lignes: 1, motif: null },
  mentionsLegales: { max: 1000, lignes: 15, motif: null },
  mobileMoney: { max: 200, lignes: 3, motif: null },
  bancaire: { max: 500, lignes: 6, motif: null },
  libelleTaux: { max: 50, lignes: 1, motif: null },
} as const satisfies Record<string, RegleTexte>;

export type ChampTexte = keyof typeof REGLES_TEXTE;

// Délais par défaut, en jours entiers (UC-06 étape 2 : 30).
export const DELAI_MIN = 1;
export const DELAI_MAX = 365;
export const DELAI_DEFAUT = 30;

// Taux de TVA, en centièmes de pour cent (1800 = 18 %), de 0 à 100 %.
export const TAUX_MAX_CENTIEMES = 10_000;
export const TAUX_MAX_PAR_ORGANISATION = 20;

// Logo : PNG ou JPEG, 200 Ko au plus (docs/STACK.md), 2048 pixels de côté au
// plus (borne technique pour le PDF, section 5 de la fiche).
export const TYPES_LOGO = ["image/png", "image/jpeg"] as const;
export type TypeLogo = (typeof TYPES_LOGO)[number];
export const TAILLE_MAX_LOGO = 204_800;
export const COTE_MAX_LOGO = 2048;
// Longueur base64 de TAILLE_MAX_LOGO octets.
export const LONGUEUR_MAX_LOGO_BASE64 = Math.ceil(TAILLE_MAX_LOGO / 3) * 4;

// Saisie brute bornée avant toute normalisation (T-42).
export function longueurMaxSaisie(regle: RegleTexte): number {
  return regle.max * 4;
}

// Caractères de contrôle (sauf le retour à la ligne, traité à part), de
// format (marques de direction) et séparateurs de ligne ou de paragraphe :
// refusés, jamais retirés en silence.
const INTERDITS = /[\p{Cf}\p{Zl}\p{Zp}]|[^\P{Cc}\n]/u;
const ESPACES = /\p{Zs}+/gu;

// Forme enregistrée : NFC, \r\n ramené à \n, dans chaque ligne les suites
// d'espaces réduites à une et les espaces de bord retirés, lignes vides de
// début et de fin retirées. null : champ non renseigné.
export function normaliserTexte(saisie: string): string | null {
  const lignes = saisie
    .normalize("NFC")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((ligne) => ligne.replaceAll(ESPACES, " ").trim());
  while (lignes.length > 0 && lignes[0] === "") lignes.shift();
  while (lignes.length > 0 && lignes.at(-1) === "") lignes.pop();
  const texte = lignes.join("\n");
  return texte === "" ? null : texte;
}

// Vrai si la saisie, une fois normalisée, peut être enregistrée. Un champ
// vide est toujours valide (non renseigné).
export function texteValide(saisie: string, regle: RegleTexte): boolean {
  if (saisie.length > longueurMaxSaisie(regle)) return false;
  const brute = saisie.replaceAll("\r\n", "\n");
  if (INTERDITS.test(brute)) return false;
  if (regle.lignes === 1 && brute.includes("\n")) return false;
  const texte = normaliserTexte(brute);
  if (texte === null) return true;
  if ([...texte].length > regle.max) return false;
  if (texte.split("\n").length > regle.lignes) return false;
  return regle.motif === null || regle.motif.test(texte);
}

export function delaiValide(valeur: number): boolean {
  return Number.isSafeInteger(valeur) && valeur >= DELAI_MIN && valeur <= DELAI_MAX;
}

// Saisie d'un délai : chiffres ASCII seulement, sans signe ni décimale.
export function lireDelai(saisie: string): number | null {
  const texte = saisie.trim();
  if (!/^[0-9]{1,3}$/u.test(texte)) return null;
  const valeur = Number(texte);
  return delaiValide(valeur) ? valeur : null;
}

// Taux saisi en pour cent, virgule ou point, deux décimales au plus, converti
// en centièmes par lecture des chiffres, sans nombre à virgule (règle 8) :
// « 9,5 » donne 950. null si la saisie n'est pas un taux de 0 à 100 %.
export function tauxEnCentiemes(saisie: string): number | null {
  const lu = /^([0-9]{1,3})(?:[.,]([0-9]{1,2}))?$/u.exec(saisie.trim());
  if (lu === null) return null;
  const entiers = Number(lu[1]);
  const decimales = Number((lu[2] ?? "").padEnd(2, "0"));
  const centiemes = entiers * 100 + decimales;
  return centiemes <= TAUX_MAX_CENTIEMES ? centiemes : null;
}

// « 18 % », « 9,5 % », « 18,25 % » : espace insécable avant le signe.
export function formaterTaux(centiemes: number): string {
  const entiers = Math.trunc(centiemes / 100);
  const decimales = String(centiemes % 100)
    .padStart(2, "0")
    .replace(/0+$/u, "");
  return `${entiers}${decimales === "" ? "" : `,${decimales}`} %`;
}
