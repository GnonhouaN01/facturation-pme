import "server-only";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { z } from "zod";

import {
  lireEtatDoubleAuth as lireEtat,
  type EtatDoubleAuthCompte,
} from "../auth/etat-double-auth";
import { lireSession } from "../auth/session";
import {
  lireProfilCompte,
  lireSessionsCompte,
  type Profil,
  type SessionAffichee,
} from "../auth/sessions-compte";
import type { Droit } from "../autorisation/matrice";
import type { ActionJournal } from "../journal/actions";

import {
  estDeclaration,
  etablirContexte,
  executerChaine,
  type ContexteLecture,
  type DeclarationAction,
  type DeclarationQuelconque,
  type ResultatLecture,
  type SchemaEntree,
} from "./action";
import { traduireErreur, type Resultat } from "./refus";

// Adaptateur Next.js : la fonction exportée d'un fichier "use server". Lit les
// en-têtes de la requête, appelle la chaîne, relance les erreurs de contrôle
// de Next.js, et porte une marque (symbole privé) lue par l'inventaire.
// Fiche : docs/features/chaine-controles.md, sections 3.2 et 7.

export type ActionExposee<E extends SchemaEntree, T> = (entree: z.input<E>) => Promise<Resultat<T>>;

// Hors du registre global (Symbol et non Symbol.for) : seul ce module peut
// poser la marque.
const MARQUE = Symbol("action exposée");

export function exposer<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
): ActionExposee<E, T> {
  // Une déclaration qui n'est pas passée par declarerAction (objet écrit à la
  // main, copie) est refusée au chargement du module : son schéma pourrait
  // être non strict (section 7, « Déclarations marquées »). Le transtypage
  // évite que la garde ne réduise le type de la déclaration (T perdu).
  if (!estDeclaration(declaration as unknown)) {
    throw new Error("Action exposée sans declarerAction : déclaration refusée.");
  }
  // Rien n'est lu ici : le module "use server" se charge hors de toute
  // requête. Les erreurs de contrôle de Next.js levées par la chaîne (qui les
  // relance) traversent cette fonction sans être interceptées.
  const action = async (entree: z.input<E>): Promise<Resultat<T>> => {
    const entetes = new Headers(await headers());
    return executerChaine(declaration, { entetes }, entree);
  };
  Object.defineProperty(action, MARQUE, { value: declaration });
  return action;
}

// Déclaration portée par une fonction renvoyée par exposer, undefined pour
// toute autre valeur.
export function declarationExposee(valeur: unknown): DeclarationQuelconque | undefined {
  if (typeof valeur !== "function" || !Object.hasOwn(valeur, MARQUE)) return undefined;
  return (valeur as unknown as Record<typeof MARQUE, DeclarationQuelconque>)[MARQUE];
}

// Lecture par une page (fonctionnalité 0.6) : même noyau que les actions,
// etablirContexte, sans contrôle d'origine. Chaque page.tsx de (app)/ l'appelle
// elle-même : le gabarit ne protège pas. Fiche :
// docs/features/socle-interface.md, sections 2.1, 2.3 et 4.2.
export async function lirePourPage<T>(
  droit: Droit,
  lire: (ctx: ContexteLecture) => Promise<T>,
): Promise<T> {
  const entetes = new Headers(await headers());
  return traduireLecture(await etablirContexte({ entetes }, droit, lire));
}

// Lecture par une page de la zone (compte) (1.2) : un utilisateur connecté,
// adresse vérifiée, sans organisation ni adhésion. Chaque page.tsx de
// (compte)/ l'appelle elle-même (le gabarit ne protège pas). Sans session :
// la page « introuvable », comme lirePourPage ; lecture en échec : la page
// « erreur », avec un incident, sans cause. lire ne reçoit que l'identifiant
// de l'utilisateur : aucune donnée d'une organisation n'est lisible par
// elle. Fiche : docs/features/connexion.md, section 5.1. 1.5 : aussi
// l'identifiant de la session de la requête, jamais son jeton
// (docs/features/profil-sessions.md, section 3.1).
export type ContexteCompte = { utilisateurId: string; sessionId: string };

export async function lireComptePourPage<T>(
  lire: (compte: ContexteCompte) => Promise<T>,
): Promise<T> {
  const entetes = new Headers(await headers());
  let session: Awaited<ReturnType<typeof lireSession>>;
  try {
    session = await lireSession(entetes);
  } catch (erreur) {
    return traduireLecture<T>(traduireErreur(erreur, "compte.lecture"));
  }
  if (session === null) notFound();
  return lire({ utilisateurId: session.utilisateurId, sessionId: session.sessionId });
}

// Pages de connexion et d'inscription (correctif de la 1.2) : un utilisateur
// connecté, adresse vérifiée, va sur /compte. La décision ne dépend que du
// cookie de session de la requête, jamais de l'existence d'un compte : sans
// session, avec une session invalide ou une lecture en échec (consignée sans
// cause), la page s'affiche comme avant. Fiche : docs/features/connexion.md,
// section 5.2.
export async function redirigerSiConnecte(): Promise<void> {
  const entetes = new Headers(await headers());
  let session: Awaited<ReturnType<typeof lireSession>>;
  try {
    session = await lireSession(entetes);
  } catch (erreur) {
    traduireErreur(erreur, "compte.redirection");
    return;
  }
  if (session !== null) redirect("/compte");
}

// Message fixe : ni l'incident, ni la cause, ni la raison (S-85, T-35).
const MESSAGE_ERREUR_PAGE = "Lecture de la page impossible.";

// Erreur d'une lecture par une page. Son digest est l'incident : Next.js garde
// un digest déjà posé, et la page « erreur » l'affiche. Aucune cause.
export class ErreurPage extends Error {
  readonly digest: string;

  constructor(incident: string) {
    super(MESSAGE_ERREUR_PAGE);
    this.name = "ErreurPage";
    this.digest = incident;
  }
}

// Traduction pure du résultat d'une lecture pour une page. refuse et
// connexion_requise donnent la même page « introuvable » (S-02, décision 1) ;
// trop_de_requetes, inatteignable en 0.6, est traité comme une erreur avec un
// nouvel incident (section 9).
export function traduireLecture<T>(resultat: ResultatLecture<T>): T {
  if (resultat.ok) return resultat.donnees;
  if (resultat.raison === "refuse" || resultat.raison === "connexion_requise") notFound();
  if (resultat.raison === "erreur") throw new ErreurPage(resultat.incident);
  throw new ErreurPage(randomUUID());
}

// Page de la double authentification (1.4) : son état, pour l'utilisateur que
// lireComptePourPage a lu dans la session, jamais pour un identifiant reçu.
// Fiche : docs/features/double-authentification.md, section 11.
export type { EtatDoubleAuthCompte };
export function lireEtatDoubleAuth(compte: ContexteCompte): Promise<EtatDoubleAuthCompte> {
  return lireEtat(compte.utilisateurId);
}

// Pages du profil et des sessions (1.5) : pour l'utilisateur et la session
// que lireComptePourPage a lus, jamais pour un identifiant reçu. Fiche :
// docs/features/profil-sessions.md, sections 3.1 et 9.
export type { Profil, SessionAffichee };
export function lireSessions(compte: ContexteCompte): Promise<SessionAffichee[]> {
  return lireSessionsCompte(compte);
}
export function lireProfil(compte: ContexteCompte): Promise<Profil> {
  return lireProfilCompte(compte);
}
