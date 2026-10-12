import "server-only";

import type { ContexteLecture } from "../actions/action";

import { peut, type Droit, type Role } from "./matrice";

// Entrées de la navigation de l'application, filtrées par la matrice des
// droits côté serveur : une entrée refusée n'est jamais envoyée au
// navigateur. Masquer une entrée n'est pas un contrôle d'accès : chaque page
// se protège par lirePourPage. Fiche : docs/features/socle-interface.md,
// sections 2.4 et 2.6.

export type EntreeNavigation = {
  chemin: string;
  // Clé d'un libellé de TEXTES_NAVIGATION.entrees (src/textes/navigation.ts).
  cle: string;
  // Droit de la matrice, ou null pour une entrée ouverte à tout membre.
  droit: Droit | null;
};

// Ordre de la maquette (décision 13) : Tableau de bord, Clients, Catalogue,
// Devis, Factures, Paiements, Relances, Organisation. Une entrée n'est ajoutée
// qu'avec sa page, à sa place dans cet ordre.
export const ENTREES_NAVIGATION: readonly EntreeNavigation[] = Object.freeze([
  Object.freeze({ chemin: "/tableau-de-bord", cle: "tableauDeBord", droit: null }),
]);

// Les entrées sans droit, et celles que peut(role, droit) accorde, dans
// l'ordre de la liste. Un rôle hors des quatre n'a aucun droit (T-51).
export function entreesVisibles(
  role: string,
  entrees: readonly EntreeNavigation[] = ENTREES_NAVIGATION,
): EntreeNavigation[] {
  return entrees.filter((entree) => entree.droit === null || peut(role, entree.droit));
}

// La matrice n'a pas de droit « être membre » : le gabarit lit celui qui est
// accordé aux quatre rôles (décision 3).
export const DROIT_GABARIT: Droit = "organisation.membres.voir";

// Lecture du gabarit de l'application, passée à lirePourPage : le rôle du
// membre et ses entrées. Aucune requête : le rôle vient du contexte établi
// par la chaîne (adhésion relue en base).
export async function lireGabarit(
  ctx: ContexteLecture,
): Promise<{ role: Role; entrees: EntreeNavigation[] }> {
  return { role: ctx.role, entrees: entreesVisibles(ctx.role) };
}
