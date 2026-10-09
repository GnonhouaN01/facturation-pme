import "server-only";

import type { z } from "zod";

import type { Droit, Role } from "../autorisation/matrice";
import type { TransactionOrganisation } from "../db/client";
import type { ActionJournal } from "../journal/actions";
import type { EntreeJournal } from "../journal/audit";

import type { Resultat } from "./refus";

// Déclaration d'une action et chaîne de contrôles. Fiche :
// docs/features/chaine-controles.md, sections 3.2, 4 et 5.

// Schéma d'entrée : z.strictObject obligatoire (S-50). Zod 4 donne la même
// forme à $strict et à $strip : ce type n'écarte pas z.object, le refus se
// fait à l'exécution.
export type SchemaEntree = z.ZodObject<z.core.$ZodLooseShape, z.core.$strict>;

export type Trace = {
  ressourceId: string;
  details?: Record<string, unknown>;
};

export type Contexte<J extends ActionJournal | null> = {
  utilisateurId: string;
  organisationId: string;
  role: Role;
  perimetre: "organisation" | "portefeuille";
  tx: TransactionOrganisation;
  journaliser: J extends ActionJournal ? (trace: Trace) => Promise<void> : never;
  introuvable: () => never;
};

export type DeclarationAction<E extends SchemaEntree, J extends ActionJournal | null, T> = {
  nom: string;
  droit: Droit;
  entree: E;
  journal: J;
  nouvelleAuthentification: boolean;
  executer: (ctx: Contexte<J>, entree: z.output<E>) => Promise<T>;
};

export type RequeteChaine = { entetes: Headers };

export type SessionLue = {
  utilisateurId: string;
  organisationActiveId: string | null;
};

export type AdhesionLue = {
  membreId: string;
  role: string;
};

export type DependancesChaine = {
  origineAttendue: string;
  lireSession: (entetes: Headers) => Promise<SessionLue | null>;
  executerDansOrganisation: <T>(
    organisationId: string,
    travail: (tx: TransactionOrganisation) => Promise<T>,
  ) => Promise<T>;
  lireAdhesion: (tx: TransactionOrganisation, utilisateurId: string) => Promise<AdhesionLue | null>;
  journaliser: (tx: TransactionOrganisation, entree: EntreeJournal) => Promise<void>;
};

// Contexte d'une lecture par une page : sans trace (section 3.2, décision 9).
export type ContexteLecture = Omit<Contexte<null>, "journaliser">;

// Une lecture n'a pas d'entrée à valider : jamais invalide.
export type ResultatLecture<T> = Exclude<Resultat<T>, { raison: "invalide" }>;

export type Chaine = {
  executerChaine: <E extends SchemaEntree, J extends ActionJournal | null, T>(
    declaration: DeclarationAction<E, J, T>,
    requete: RequeteChaine,
    entreeBrute: unknown,
  ) => Promise<Resultat<T>>;
  etablirContexte: <T>(
    requete: RequeteChaine,
    droit: Droit,
    lire: (ctx: ContexteLecture) => Promise<T>,
  ) => Promise<ResultatLecture<T>>;
};

// Phase rouge : non implémenté.
export function declarerAction<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
): DeclarationAction<E, J, T> {
  void declaration;
  throw new Error("non implémenté");
}

// Phase rouge : non implémenté.
export function creerChaine(dependances: DependancesChaine): Chaine {
  void dependances;
  throw new Error("non implémenté");
}

// Chaîne liée aux vraies dépendances. Phase rouge : non implémenté.
export async function executerChaine<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
  requete: RequeteChaine,
  entreeBrute: unknown,
): Promise<Resultat<T>> {
  void declaration;
  void requete;
  void entreeBrute;
  throw new Error("non implémenté");
}

// Noyau des lectures par les pages, lié aux vraies dépendances. Phase rouge :
// non implémenté.
export async function etablirContexte<T>(
  requete: RequeteChaine,
  droit: Droit,
  lire: (ctx: ContexteLecture) => Promise<T>,
): Promise<ResultatLecture<T>> {
  void requete;
  void droit;
  void lire;
  throw new Error("non implémenté");
}
