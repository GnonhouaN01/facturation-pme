import {
  COTE_MAX_LOGO,
  LONGUEUR_MAX_LOGO_BASE64,
  TAILLE_MAX_LOGO,
  type TypeLogo,
} from "@/schemas/regles-parametres";

// Contrôle du logo téléversé (S-53, T-60) sur ses octets, jamais sur le nom
// du fichier ni sur le type annoncé : signature PNG ou JPEG, structure
// minimale, taille et dimensions bornées. Fonctions pures, utilisées par le
// schéma du serveur et par le formulaire. Fiche :
// docs/features/parametres-organisation.md, section 5.

export type LogoAnalyse = { type: TypeLogo; largeur: number; hauteur: number };

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Bloc IEND : longueur nulle, nom, somme de contrôle fixe.
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const IHDR = [0x49, 0x48, 0x44, 0x52];

// Base64 standard, remplissage exact, aucun espace ni retour à la ligne.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function commencePar(octets: Uint8Array, motif: readonly number[], decalage = 0): boolean {
  return motif.every((valeur, i) => octets[decalage + i] === valeur);
}

function entier32(octets: Uint8Array, decalage: number): number {
  return (
    ((octets[decalage] ?? 0) * 2 ** 24 +
      ((octets[decalage + 1] ?? 0) << 16) +
      ((octets[decalage + 2] ?? 0) << 8) +
      (octets[decalage + 3] ?? 0)) >>>
    0
  );
}

function entier16(octets: Uint8Array, decalage: number): number {
  return ((octets[decalage] ?? 0) << 8) | (octets[decalage + 1] ?? 0);
}

function dimensionsAdmises(largeur: number, hauteur: number): boolean {
  return largeur >= 1 && hauteur >= 1 && largeur <= COTE_MAX_LOGO && hauteur <= COTE_MAX_LOGO;
}

// PNG : signature, bloc IHDR de 13 octets en tête, bloc IEND en fin.
function analyserPng(octets: Uint8Array): LogoAnalyse | null {
  if (octets.length < SIGNATURE_PNG.length + 25 + IEND.length) return null;
  if (entier32(octets, 8) !== 13 || !commencePar(octets, IHDR, 12)) return null;
  if (!commencePar(octets, IEND, octets.length - IEND.length)) return null;
  const largeur = entier32(octets, 16);
  const hauteur = entier32(octets, 20);
  return dimensionsAdmises(largeur, hauteur) ? { type: "image/png", largeur, hauteur } : null;
}

// Marqueurs SOFn porteurs des dimensions (C4, C8 et CC sont d'autres
// segments).
function estSof(marqueur: number): boolean {
  return marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur);
}

// JPEG : début FF D8, fin FF D9, segments parcourus jusqu'au premier SOFn.
function analyserJpeg(octets: Uint8Array): LogoAnalyse | null {
  const n = octets.length;
  if (n < 4 || octets[n - 2] !== 0xff || octets[n - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= n) {
    if (octets[i] !== 0xff) return null;
    const marqueur = octets[i + 1] ?? 0;
    // Début des données d'image ou fin : aucun SOFn rencontré avant.
    if (marqueur === 0xda || marqueur === 0xd9) return null;
    const longueur = entier16(octets, i + 2);
    if (longueur < 2 || i + 2 + longueur > n) return null;
    if (estSof(marqueur)) {
      if (longueur < 7) return null;
      const hauteur = entier16(octets, i + 5);
      const largeur = entier16(octets, i + 7);
      return dimensionsAdmises(largeur, hauteur) ? { type: "image/jpeg", largeur, hauteur } : null;
    }
    i += 2 + longueur;
  }
  return null;
}

// null pour tout fichier qui n'est pas un PNG ou un JPEG admis.
export function analyserLogo(octets: Uint8Array): LogoAnalyse | null {
  if (octets.length < 1 || octets.length > TAILLE_MAX_LOGO) return null;
  if (commencePar(octets, SIGNATURE_PNG)) return analyserPng(octets);
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return analyserJpeg(octets);
  return null;
}

// Décodage strict ; null si la chaîne n'est pas du base64 standard non vide,
// ou dépasse la longueur d'un logo admis.
export function decoderBase64(texte: string): Uint8Array | null {
  if (texte === "" || texte.length > LONGUEUR_MAX_LOGO_BASE64 || !BASE64.test(texte)) return null;
  const binaire = atob(texte);
  return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
}

// Encodage pour l'envoi par le navigateur (FileReader évité : un seul
// chemin, testable).
export function encoderBase64(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}
