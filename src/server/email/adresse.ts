import "server-only";

import { z } from "zod";

// L'adresse du destinataire : une seule adresse partie-locale@domaine, plus
// étroite que z.email(). Aucun caractère qui puisse ajouter un en-tête ou un
// destinataire (retour à la ligne, virgule, chevrons), ni commentaire
// RFC 5322 (parenthèses) : l'adresse validée ici est exactement celle de
// l'enveloppe. Fiche : docs/features/envoi-emails.md, section 3.1.

const LONGUEUR_MAX = 254;
const LONGUEUR_MAX_LOCALE = 64;

// Partie locale : caractères « atext » de la RFC 5322 et le point. Ni espace,
// ni guillemet, ni chevron, ni virgule, ni point-virgule, ni parenthèse, ni
// caractère de contrôle ou non ASCII.
const LOCALE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+$/u;
// Étiquette du domaine, en minuscules : sans tiret au bord, 63 au plus.
const ETIQUETTE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

// Seuls les espaces de bord sont retirés : un retour à la ligne en fin de
// valeur reste une faute, jamais une valeur tolérée.
function retirerEspacesDeBord(valeur: string): string {
  return valeur.replace(/^ +| +$/gu, "");
}

// Renvoie l'adresse normalisée (domaine en minuscules), ou null.
function normaliser(brute: string): string | null {
  const valeur = retirerEspacesDeBord(brute);
  if (valeur.length === 0 || valeur.length > LONGUEUR_MAX) return null;
  const morceaux = valeur.split("@");
  if (morceaux.length !== 2) return null;
  const [locale, domaineBrut] = morceaux as [string, string];
  if (locale.length === 0 || locale.length > LONGUEUR_MAX_LOCALE || !LOCALE.test(locale)) {
    return null;
  }
  const domaine = domaineBrut.toLowerCase();
  const etiquettes = domaine.split(".");
  if (etiquettes.length < 2 || !etiquettes.every((etiquette) => ETIQUETTE.test(etiquette))) {
    return null;
  }
  return `${locale}@${domaine}`;
}

export const schemaAdresse = z.string().transform((valeur, ctx): string => {
  const adresse = normaliser(valeur);
  if (adresse === null) {
    ctx.addIssue({ code: "custom", message: "adresse invalide" });
    return z.NEVER;
  }
  return adresse;
});

const DOMAINES_GMAIL = new Set(["gmail.com", "googlemail.com"]);

// Forme comptée par la limite « destinataire » (décision 10) : minuscules,
// sous-adresse « +... » retirée, points retirés chez Gmail. Sert au compteur
// seulement ; l'email part à l'adresse saisie.
export function adressePourCompteur(adresse: string): string {
  const valeur = retirerEspacesDeBord(adresse).toLowerCase();
  const arobase = valeur.lastIndexOf("@");
  const domaine = valeur.slice(arobase + 1);
  let locale = valeur.slice(0, arobase);
  const plus = locale.indexOf("+");
  if (plus >= 0) locale = locale.slice(0, plus);
  if (DOMAINES_GMAIL.has(domaine)) locale = locale.replaceAll(".", "");
  return `${locale}@${domaine}`;
}
