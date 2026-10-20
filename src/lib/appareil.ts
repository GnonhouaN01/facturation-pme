// Description de l'appareil d'une session (1.5) : le navigateur et le
// système reconnus dans le texte déclaré par le navigateur (User-Agent),
// chacun pris dans une liste fermée. Le texte déclaré est choisi par qui
// ouvre la session, donc peut-être par un attaquant : il n'est jamais rendu
// ni affiché (T-34). La description aide à reconnaître une session, elle ne
// prouve rien. Fiche : docs/features/profil-sessions.md, section 3.4.

import { TEXTES_COMPTE } from "@/textes/compte";

const TEXTES = TEXTES_COMPTE.sessions;

// Ordre de recherche : Edge et Opera portent aussi « Chrome », Samsung
// Internet aussi, et Chrome porte aussi « Safari ».
const RECHERCHE_NAVIGATEURS = [
  ["Edge", /\bEdg(?:e|A|iOS)?\//u],
  ["Opera", /\b(?:OPR|Opera)\//u],
  ["Samsung Internet", /\bSamsungBrowser\//u],
  ["Firefox", /\b(?:Firefox|FxiOS)\//u],
  ["Chrome", /\b(?:Chrome|CriOS)\//u],
  ["Safari", /\bVersion\/[\d.]+.*\bSafari\//u],
] as const;

// Ordre de recherche : Android porte aussi « Linux », iOS « Mac OS X »,
// ChromeOS « X11 ».
const RECHERCHE_SYSTEMES = [
  ["Windows", /\bWindows NT\b/u],
  ["Android", /\bAndroid\b/u],
  ["iOS", /\b(?:iPhone|iPad|iPod)\b/u],
  ["macOS", /\bMacintosh\b/u],
  ["ChromeOS", /\bCrOS\b/u],
  ["Linux", /\bLinux\b/u],
] as const;

export const NAVIGATEURS = [
  ...RECHERCHE_NAVIGATEURS.map(([nom]) => nom),
  TEXTES.navigateurInconnu,
] as const;
export const SYSTEMES = [...RECHERCHE_SYSTEMES.map(([nom]) => nom), TEXTES.systemeInconnu] as const;

// Au-delà, le texte n'est pas examiné : un navigateur réel déclare moins de
// 512 caractères.
const LONGUEUR_MAX = 1024;

function trouver<N extends string>(
  texte: string,
  recherche: readonly (readonly [N, RegExp])[],
  inconnu: string,
): string {
  for (const [nom, motif] of recherche) if (motif.test(texte)) return nom;
  return inconnu;
}

// « Chrome sur Android » ; « Navigateur inconnu sur système inconnu » pour
// un texte absent, vide, trop long ou non reconnu.
export function decrireAppareil(userAgent: string | null | undefined): string {
  const texte = typeof userAgent === "string" && userAgent.length <= LONGUEUR_MAX ? userAgent : "";
  const navigateur = trouver(texte, RECHERCHE_NAVIGATEURS, TEXTES.navigateurInconnu);
  const systeme = trouver(texte, RECHERCHE_SYSTEMES, TEXTES.systemeInconnu);
  return `${navigateur} ${TEXTES.sur} ${systeme}`;
}
