import "server-only";

import { randomUUID } from "node:crypto";

import { unstable_rethrow } from "next/navigation";

import { OrganisationActiveInvalide } from "../db/client";

// Modèle de résultat renvoyé au client, et traduction des erreurs. Des codes,
// jamais de texte ni de valeur reçue (S-02, S-54, S-85). Fiche :
// docs/features/chaine-controles.md, section 6.

export type Resultat<T> =
  | { ok: true; donnees: T }
  | { ok: false; raison: "connexion_requise" }
  | { ok: false; raison: "refuse" }
  | { ok: false; raison: "invalide"; champs: string[] }
  | { ok: false; raison: "erreur"; incident: string };

// Refus produit par la chaîne ou la traduction d'une erreur : jamais
// invalide, réservé à la validation de l'entrée (étape 9).
export type Refus = Exclude<Extract<Resultat<never>, { ok: false }>, { raison: "invalide" }>;

// Message fixe : ni la ressource, ni la raison du refus (S-02).
const MESSAGE_REFUS = "Refusé.";

// Le refus uniforme, levé par la chaîne et par ctx.introuvable() : il annule
// la transaction et donne « refuse », sans rien au journal technique.
export class RefusUniforme extends Error {
  constructor() {
    super(MESSAGE_REFUS);
    this.name = "RefusUniforme";
  }
}

export function refus(): Refus {
  return { ok: false, raison: "refuse" };
}

export function connexionRequise(): Refus {
  return { ok: false, raison: "connexion_requise" };
}

// Refus de la règle d'isolation, et clé étrangère vers une ressource
// invisible : traduits comme une ressource introuvable (section 6.2).
const CODES_REFUS = new Set(["42501", "23503"]);

// Code PostgreSQL de l'erreur, en suivant la chaîne des cause : Drizzle
// enveloppe l'erreur de pg. Seul un code de cinq caractères est retenu, pour
// qu'aucune autre valeur ne passe au journal technique.
function codePostgres(erreur: unknown): string | undefined {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < 10 && courante; profondeur += 1) {
    if (typeof courante === "object" && "code" in courante) {
      const { code } = courante as { code: unknown };
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    courante = typeof courante === "object" ? (courante as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

// Classe de l'erreur, jamais son message : un message PostgreSQL peut contenir
// des valeurs (S-54, T-35).
function classeDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : typeof erreur;
}

// Journal technique : console.error, provisoire jusqu'à la 8.1. Seulement des
// valeurs choisies ici : origine (nom de l'action ou droit), classe, code,
// incident. Ni message, ni cause, ni valeur de l'entrée.
function signaler(entree: { origine: string; classe: string; code?: string; incident?: string }) {
  console.error("[chaine-controles]", JSON.stringify(entree));
}

// Traduit une erreur levée pendant la chaîne en résultat (section 6.3).
// Relance telles quelles les erreurs de contrôle de Next.js (redirect,
// notFound...). origine : le nom de l'action, ou le droit d'une lecture.
export function traduireErreur(erreur: unknown, origine: string): Refus {
  unstable_rethrow(erreur);

  if (erreur instanceof RefusUniforme || erreur instanceof OrganisationActiveInvalide) {
    return refus();
  }

  const code = codePostgres(erreur);
  const classe = classeDe(erreur);
  if (code !== undefined && CODES_REFUS.has(code)) {
    signaler({ origine, classe, code });
    return refus();
  }

  const incident = randomUUID();
  signaler({ origine, classe, ...(code === undefined ? {} : { code }), incident });
  return { ok: false, raison: "erreur", incident };
}
