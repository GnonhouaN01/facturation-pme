import "server-only";

import type { z } from "zod";

// Phase rouge de la 0.7 (PR 1) : interface fixée par les tests, sans
// implémentation. MODELES_EMAIL est vide : les tests le parcourent au
// chargement. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

export type ModeleEmail = "essai.verification_envoi";

export type DefinitionModele = {
  parametres: z.ZodObject;
  construire: (
    parametres: Record<string, unknown>,
    contexte: { origine: string },
  ) => { sujet: string; corps: string };
};

export const MODELES_EMAIL = {} as Readonly<Record<ModeleEmail, DefinitionModele>>;

export const LONGUEUR_JETON = 43;
export const LONGUEUR_MAX_CORPS = 10_000;

function nonImplemente(): never {
  throw new Error("non implémenté");
}

export const briques = {
  identifiant: (): z.ZodType => nonImplemente(),
  enumeree: (valeurs: readonly string[]): z.ZodType => {
    void valeurs;
    return nonImplemente();
  },
  entier: (): z.ZodType => nonImplemente(),
  booleen: (): z.ZodType => nonImplemente(),
  jeton: (): z.ZodType => nonImplemente(),
  texteAffichable: (max: number): z.ZodType => {
    void max;
    return nonImplemente();
  },
};

export function ligneEnTete(texte: string, max = 200): string {
  void texte;
  void max;
  return nonImplemente();
}

export function lienPublic(origine: string, type: string, jeton: string): string {
  void origine;
  void type;
  void jeton;
  return nonImplemente();
}
