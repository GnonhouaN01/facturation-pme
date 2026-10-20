// Formatage des dates au format jour/mois/année (NF-02). Fiche :
// docs/features/socle-interface.md, section 11.3.

import { TEXTES_COMMUNS } from "@/textes/commun";

// Fuseau fixé : la Côte d'Ivoire est à UTC+0 toute l'année, sans heure
// d'été. Le serveur, la CI et le navigateur d'un membre en déplacement
// donnent ainsi le même jour pour un même instant.
const FORMAT_JOUR = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// Un instant (horodatage), affiché au jour d'Abidjan : « 05/10/2026 ».
// Assemblé depuis les parties, pour ne pas dépendre du séparateur de la
// langue.
export function formaterDate(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Date invalide.");
  }
  const parties = new Map(FORMAT_JOUR.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parties.get("day")}/${parties.get("month")}/${parties.get("year")}`;
}

// 1.5 : l'heure, sur 24 heures, minutes sur deux chiffres, au fuseau
// d'Abidjan (docs/features/profil-sessions.md, section 7).
const FORMAT_JOUR_HEURE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Un instant, au jour et à l'heure d'Abidjan : « 20/10/2026 à 14:05 ».
// Assemblé depuis les parties, comme formaterDate.
export function formaterDateHeure(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Date invalide.");
  }
  const parties = new Map(FORMAT_JOUR_HEURE.formatToParts(instant).map((p) => [p.type, p.value]));
  const jour = `${parties.get("day")}/${parties.get("month")}/${parties.get("year")}`;
  return `${jour} ${TEXTES_COMMUNS.liaisonHeure} ${parties.get("hour")}:${parties.get("minute")}`;
}

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

function joursDuMois(annee: number, mois: number): number {
  if (mois === 2) return estBissextile(annee) ? 29 : 28;
  return [4, 6, 9, 11].includes(mois) ? 30 : 31;
}

// Une date de calendrier AAAA-MM-JJ (colonne date : échéance, date de
// paiement) : « 05/10/2026 ». Découpée telle quelle, sans conversion en
// instant ni fuseau. Le message ne reprend pas la valeur.
export function formaterJour(jour: string): string {
  const morceaux = JOUR.exec(jour);
  if (!morceaux) {
    throw new RangeError("Date invalide : le format AAAA-MM-JJ est attendu.");
  }
  const [, a = "", m = "", j = ""] = morceaux;
  const annee = Number(a);
  const mois = Number(m);
  const quantieme = Number(j);
  if (mois < 1 || mois > 12 || quantieme < 1 || quantieme > joursDuMois(annee, mois)) {
    throw new RangeError("Date invalide : ce jour n'existe pas au calendrier.");
  }
  return `${j}/${m}/${a}`;
}
