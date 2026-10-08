import "server-only";

// Matrice rôles x droits, transcription unique de docs/THREATS.md section 6.
// Fiche : docs/features/chaine-controles.md, section 8.
// Phase rouge : listes vides, fonctions non implémentées.

export type ValeurDroit = "oui" | "non" | "portefeuille" | "lecture_portefeuille";

export type Role = string;

export type DefinitionDroit = {
  groupe: string;
  libelle: string;
  valeurs: Readonly<Record<Role, ValeurDroit>>;
};

export type Droit = string;

export const ROLES: readonly Role[] = [];

export const DROITS: Readonly<Record<Droit, DefinitionDroit>> = {};

export function peut(role: Role, droit: Droit): boolean {
  void role;
  void droit;
  throw new Error("Non implémenté.");
}

export function perimetre(role: Role, droit: Droit): "organisation" | "portefeuille" {
  void role;
  void droit;
  throw new Error("Non implémenté.");
}
