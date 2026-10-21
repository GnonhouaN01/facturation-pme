import "server-only";

import { randomUUID } from "node:crypto";

import { unstable_rethrow } from "next/navigation";

import { OrganisationActiveInvalide } from "../db/client";
import { codePostgres } from "../erreurs/code-postgres";

// Modèle de résultat renvoyé au client, et traduction des erreurs. Des codes,
// jamais de texte ni de valeur reçue (S-02, S-54, S-85). Fiche :
// docs/features/chaine-controles.md, section 6.

export type Resultat<T> =
  // emails : présent seulement pour une action qui déclare des modèles
  // d'email ; ce qui est parti après la validation, et ce qui n'est pas parti
  // (limite, porte en échec). Fiche : docs/features/envoi-emails.md,
  // section 6.2.
  | { ok: true; donnees: T; emails?: { envoyes: number; nonEnvoyes: number } }
  | { ok: false; raison: "connexion_requise" }
  | { ok: false; raison: "refuse" }
  | { ok: false; raison: "trop_de_requetes" }
  // Action sensible sans preuve de nouvelle authentification de la session
  // (étape 8, 1.6) : l'interface demande le mot de passe et le code, puis
  // renvoie l'action. Atteint seulement après le contrôle du droit, avant
  // la lecture de l'entrée. Fiche : docs/features/nouvelle-authentification.md,
  // section 4.
  | { ok: false; raison: "nouvelle_authentification_requise" }
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

// Limite de débit atteinte (étape 4) : ni délai, ni compte, ni nom de la
// limite. Fiche : docs/features/limitation-debit.md, section 10.
export function tropDeRequetes(): Refus {
  return { ok: false, raison: "trop_de_requetes" };
}

export function connexionRequise(): Refus {
  return { ok: false, raison: "connexion_requise" };
}

export function nouvelleAuthentificationRequise(): Refus {
  return { ok: false, raison: "nouvelle_authentification_requise" };
}

// Refus de la règle d'isolation, et clé étrangère vers une ressource
// invisible : traduits comme une ressource introuvable (section 6.2).
const CODES_REFUS = new Set(["42501", "23503"]);

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
