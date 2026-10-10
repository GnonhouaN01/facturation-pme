import "server-only";

import { headers } from "next/headers";
import type { z } from "zod";

import type { ActionJournal } from "../journal/actions";

import { executerChaine, type DeclarationAction, type SchemaEntree } from "./action";
import type { Resultat } from "./refus";

// Adaptateur Next.js : la fonction exportée d'un fichier "use server". Lit les
// en-têtes de la requête, appelle la chaîne, relance les erreurs de contrôle
// de Next.js, et porte une marque (symbole privé) lue par l'inventaire.
// Fiche : docs/features/chaine-controles.md, sections 3.2 et 7.

export type ActionExposee<E extends SchemaEntree, T> = (entree: z.input<E>) => Promise<Resultat<T>>;

type DeclarationQuelconque = DeclarationAction<SchemaEntree, ActionJournal | null, unknown>;

// Hors du registre global (Symbol et non Symbol.for) : seul ce module peut
// poser la marque.
const MARQUE = Symbol("action exposée");

export function exposer<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
): ActionExposee<E, T> {
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
