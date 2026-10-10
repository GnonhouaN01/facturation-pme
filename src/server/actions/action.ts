import "server-only";

import { z } from "zod";

import { lireSession } from "../auth/session";
import { DROITS, perimetre, peut, ROLES, type Droit, type Role } from "../autorisation/matrice";
import { executerDansOrganisation, type TransactionOrganisation } from "../db/client";
import { lireAdhesion } from "../db/requetes/adhesions";
import { env } from "../env";
import { ACTIONS_JOURNAL, type ActionJournal } from "../journal/actions";
import { journaliser, type EntreeJournal } from "../journal/audit";

import { verifierOrigine } from "./origine";
import {
  connexionRequise,
  refus,
  RefusUniforme,
  traduireErreur,
  type Refus,
  type Resultat,
} from "./refus";

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

// Une trace était déclarée, le service ne l'a pas écrite : l'action est
// annulée (T-20). Message fixe.
export class TraceManquante extends Error {
  constructor() {
    super("Trace déclarée non écrite.");
    this.name = "TraceManquante";
  }
}

class DeclarationInvalide extends Error {
  constructor(raison: string) {
    super(`Déclaration d'action invalide : ${raison}.`);
    this.name = "DeclarationInvalide";
  }
}

// Un z.strictObject a pour catchall z.never() ; z.object n'en a pas,
// z.looseObject et .catchall() en ont un autre.
function estStrict(schema: unknown): boolean {
  if (!(schema instanceof z.ZodObject)) return false;
  const def = schema.def as { catchall?: z.ZodType };
  return def.catchall instanceof z.ZodNever;
}

// Vérifie la déclaration au chargement du module qui la fait : ce que le type
// ne peut pas garantir (schéma strict, S-50), et ce qu'un appelant qui
// contourne le type fournirait. Renvoie une copie figée.
export function declarerAction<E extends SchemaEntree, J extends ActionJournal | null, T>(
  declaration: DeclarationAction<E, J, T>,
): DeclarationAction<E, J, T> {
  const { nom, droit, entree, journal, nouvelleAuthentification, executer } = declaration;
  if (typeof nom !== "string" || nom === "") throw new DeclarationInvalide("nom absent");
  if (!Object.hasOwn(DROITS, droit)) throw new DeclarationInvalide(`droit inconnu (${nom})`);
  if (!estStrict(entree)) throw new DeclarationInvalide(`schéma d'entrée non strict (${nom})`);
  if (journal !== null && !Object.hasOwn(ACTIONS_JOURNAL, journal)) {
    throw new DeclarationInvalide(`action du journal inconnue (${nom})`);
  }
  if (typeof nouvelleAuthentification !== "boolean") {
    throw new DeclarationInvalide(`nouvelleAuthentification absent (${nom})`);
  }
  if (typeof executer !== "function") throw new DeclarationInvalide(`executer absent (${nom})`);
  return Object.freeze({ ...declaration });
}

const identifiantOrganisation = z.uuid();

function estRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

function introuvable(): never {
  throw new RefusUniforme();
}

// Chemins des champs en erreur, jamais la valeur reçue ni le message de Zod
// (section 6.1).
function champsInvalides(erreur: z.ZodError): string[] {
  const chemins = erreur.issues.map((issue) => issue.path.map(String).join("."));
  return [...new Set(chemins)];
}

type ContexteBase = Omit<Contexte<null>, "journaliser"> & { session: SessionLue };

export function creerChaine(dependances: DependancesChaine): Chaine {
  // Étapes 2 à 6 de la section 5, puis travail dans la transaction. Un refus
  // à l'étape 6 lève RefusUniforme : la transaction est annulée.
  async function dansContexte<R>(
    requete: RequeteChaine,
    droit: Droit,
    travail: (base: ContexteBase) => Promise<R>,
  ): Promise<R | Refus> {
    // 2. Session, relue en base.
    const session = await dependances.lireSession(requete.entetes);
    if (session === null) return connexionRequise();

    // 3. Organisation active présente et au format UUID, avant toute requête.
    const organisationId = session.organisationActiveId;
    if (organisationId === null || !identifiantOrganisation.safeParse(organisationId).success) {
      return refus();
    }

    // 4. Point d'accroche 0.5 : limitation de débit.

    // 5. Transaction de l'organisation active ; tout ce qui suit s'y déroule.
    return dependances.executerDansOrganisation(organisationId, async (tx) => {
      // 6. Adhésion FOR SHARE, rôle parmi les quatre, droit de la matrice.
      const adhesion = await dependances.lireAdhesion(tx, session.utilisateurId);
      if (adhesion === null || !estRole(adhesion.role) || !peut(adhesion.role, droit)) {
        throw new RefusUniforme();
      }

      // 7. Point d'accroche 1.4 : double authentification par rôle.

      return travail({
        session,
        utilisateurId: session.utilisateurId,
        organisationId,
        role: adhesion.role,
        perimetre: perimetre(adhesion.role, droit),
        tx,
        introuvable,
      });
    });
  }

  async function executerChaine<E extends SchemaEntree, J extends ActionJournal | null, T>(
    declaration: DeclarationAction<E, J, T>,
    requete: RequeteChaine,
    entreeBrute: unknown,
  ): Promise<Resultat<T>> {
    try {
      // 1. Origine.
      if (!verifierOrigine(requete.entetes, dependances.origineAttendue)) return refus();

      return await dansContexte(requete, declaration.droit, async (base) => {
        // 8. Nouvelle authentification : fermée tant que la 1.6 n'est pas
        // livrée (décision 10).
        if (declaration.nouvelleAuthentification) throw new RefusUniforme();

        // 9. Validation de l'entrée, par un membre autorisé seulement.
        const lue = declaration.entree.safeParse(entreeBrute);
        if (!lue.success) {
          return { ok: false, raison: "invalide", champs: champsInvalides(lue.error) } as const;
        }

        // 10. Le service, dans la transaction. L'action et l'auteur de la
        // trace sont ceux de la déclaration et de la session, jamais du
        // service.
        let tracee = false;
        const { session, ...contexte } = base;
        const action = declaration.journal;
        const journaliser =
          action === null
            ? undefined
            : async (trace: Trace) => {
                await dependances.journaliser(contexte.tx, {
                  action,
                  auteurId: session.utilisateurId,
                  ressourceId: trace.ressourceId,
                  ...(trace.details === undefined ? {} : { details: trace.details }),
                });
                tracee = true;
              };
        const ctx = Object.freeze(
          journaliser === undefined ? contexte : { ...contexte, journaliser },
        ) as Contexte<J>;
        const donnees = await declaration.executer(ctx, lue.data);

        // 11. Trace déclarée : obligatoire, sinon l'action est annulée.
        if (action !== null && !tracee) throw new TraceManquante();

        return { ok: true, donnees } as const;
      });
    } catch (erreur) {
      return traduireErreur(erreur, declaration.nom);
    }
  }

  // Noyau des lectures par les pages (section 3.2, décision 9) : étapes 2 à 6,
  // sans contrôle d'origine (une page s'ouvre aussi par un lien d'un autre
  // site), sans entrée ni trace. Le journal technique porte le droit.
  async function etablirContexte<T>(
    requete: RequeteChaine,
    droit: Droit,
    lire: (ctx: ContexteLecture) => Promise<T>,
  ): Promise<ResultatLecture<T>> {
    try {
      return await dansContexte(requete, droit, async ({ session, ...contexte }) => {
        void session;
        const donnees = await lire(Object.freeze(contexte));
        return { ok: true, donnees } as const;
      });
    } catch (erreur) {
      return traduireErreur(erreur, droit);
    }
  }

  return { executerChaine, etablirContexte };
}

const chaine = creerChaine({
  origineAttendue: env.BETTER_AUTH_URL,
  lireSession,
  executerDansOrganisation,
  lireAdhesion,
  journaliser,
});

// Chaîne liée aux vraies dépendances : seul chemin d'une action vers un
// service (DESIGN.md section 3.2).
export const executerChaine: Chaine["executerChaine"] = chaine.executerChaine;

// Noyau des lectures par les pages, lié aux vraies dépendances.
export const etablirContexte: Chaine["etablirContexte"] = chaine.etablirContexte;
