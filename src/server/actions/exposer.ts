import "server-only";

import type { z } from "zod";

import type { ActionJournal } from "../journal/actions";

import type { DeclarationAction, SchemaEntree } from "./action";
import type { Resultat } from "./refus";

// Adaptateur Next.js : la fonction exportée d'un fichier "use server". Lit les
// en-têtes de la requête, appelle la chaîne, relance les erreurs de contrôle
// de Next.js, et porte une marque (symbole privé) lue par l'inventaire.
// Fiche : docs/features/chaine-controles.md, sections 3.2 et 7.

export type ActionExposee<E extends SchemaEntree, T> = (entree: z.input<E>) => Promise<Resultat<T>>;

// Phase rouge : non implémenté.
export function exposer<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
): ActionExposee<E, T> {
  void declaration;
  throw new Error("non implémenté");
}

// Déclaration portée par une fonction renvoyée par exposer, undefined pour
// toute autre valeur. Phase rouge : non implémenté.
export function declarationExposee(
  valeur: unknown,
): DeclarationAction<SchemaEntree, ActionJournal | null, unknown> | undefined {
  void valeur;
  throw new Error("non implémenté");
}
