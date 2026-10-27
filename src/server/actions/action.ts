import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { COMPTES_OUVERTS_EN_PRODUCTION } from "../auth/points-entree";
import { lireSession } from "../auth/session";
import {
  DROITS,
  perimetre,
  peut,
  ROLES,
  ROLES_DOUBLE_AUTH,
  type Droit,
  type Role,
} from "../autorisation/matrice";
import { executerDansOrganisation, type TransactionOrganisation } from "../db/client";
import { consommerPreuve } from "../db/nouvelle-authentification";
import { lireAdhesion } from "../db/requetes/adhesions";
import { verifierDebit } from "../debit/debit";
import { LIMITES, VALEUR_APPLICATION, type NomLimite } from "../debit/limites";
import { adressePourCompteur } from "../email/adresse";
import {
  envoyerEmail,
  validerDemande,
  type DemandeEmail,
  type ResultatEnvoi,
} from "../email/envoi";
import { MODELES_EMAIL, type ModeleEmail } from "../email/modeles";
import { configurationEmail, env } from "../env";
import { ACTIONS_JOURNAL, type ActionJournal } from "../journal/actions";
import { journaliser, type EntreeJournal } from "../journal/audit";

import { verifierOrigine } from "./origine";
import {
  connexionRequise,
  nouvelleAuthentificationRequise,
  refus,
  RefusUniforme,
  traduireErreur,
  tropDeRequetes,
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

// Les modèles d'email qu'une action peut envoyer. Fiche :
// docs/features/envoi-emails.md, section 5.3.
export type ModelesAction = readonly ModeleEmail[];

// Demande d'email d'un service : un modèle de sa déclaration. Le destinataire
// vient d'une ressource lue en base par le service, jamais de l'entrée.
export type DemandeEmailAction<M extends ModelesAction> = {
  modele: M[number];
  destinataire: string;
  parametres: Record<string, unknown>;
};

// ctx.preparerEmail n'existe que si la déclaration a au moins un modèle
// (never sinon, comme journaliser). Synchrone : la demande est validée tout
// de suite (une demande invalide annule la transaction), puis gardée
// jusqu'après la validation.
type PreparerEmail<M extends ModelesAction> = [M[number]] extends [never]
  ? never
  : (demande: DemandeEmailAction<M>) => void;

export type Contexte<J extends ActionJournal | null, M extends ModelesAction = readonly []> = {
  utilisateurId: string;
  organisationId: string;
  role: Role;
  perimetre: "organisation" | "portefeuille";
  tx: TransactionOrganisation;
  journaliser: J extends ActionJournal ? (trace: Trace) => Promise<void> : never;
  introuvable: () => never;
  preparerEmail: PreparerEmail<M>;
};

export type DeclarationAction<
  E extends SchemaEntree,
  J extends ActionJournal | null,
  T,
  M extends ModelesAction = ModelesAction,
> = {
  nom: string;
  droit: Droit;
  entree: E;
  journal: J;
  nouvelleAuthentification: boolean;
  // Limite de débit de l'étape 4, ou null : champ obligatoire, sans défaut.
  // Fiche : docs/features/limitation-debit.md, section 10.
  debit: NomLimite | null;
  // Modèles d'email que l'action peut envoyer, ou [] : champ obligatoire,
  // sans défaut. Fiche : docs/features/envoi-emails.md, section 5.3.
  emails: M;
  // Écrite en méthode : une déclaration sans modèle d'email (ctx sans
  // preparerEmail) reste convertible en DeclarationQuelconque. Le contexte
  // reste calculé depuis la déclaration elle-même.
  executer(ctx: Contexte<J, M>, entree: z.output<E>): Promise<T>;
};

export type RequeteChaine = { entetes: Headers };

export type SessionLue = {
  utilisateurId: string;
  // L'identifiant de la session de la requête, jamais son jeton : il marque
  // « Cette session » dans la liste des sessions (1.5,
  // docs/features/profil-sessions.md, section 3.1).
  sessionId: string;
  organisationActiveId: string | null;
  // user.two_factor_enabled, relu avec la session à chaque requête (étape 7).
  doubleAuthentification: boolean;
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
  // Écrite en méthode : ses paramètres restent bivariants, et une fonction
  // de test limitée à « membre.action » (0.5) reste acceptée depuis l'ajout
  // des limites d'envoi (0.7).
  verifierDebit(nom: NomLimite, valeur: string): Promise<boolean>;
  // Porte d'envoi, appelée après la validation de la transaction.
  envoyerEmail: (demande: DemandeEmail) => Promise<ResultatEnvoi>;
  // Étape 8 (1.6) : supprime, dans la transaction de l'action, la preuve de
  // nouvelle authentification valable de cette session pour cet
  // utilisateur ; vrai si elle existait. Fiche :
  // docs/features/nouvelle-authentification.md, section 4.
  consommerNouvelleAuthentification: (
    tx: TransactionOrganisation,
    utilisateurId: string,
    sessionId: string,
  ) => Promise<boolean>;
};

// Contexte d'une lecture par une page : sans trace (section 3.2, décision 9).
export type ContexteLecture = Omit<Contexte<null>, "journaliser" | "preparerEmail">;

// Une lecture n'a pas d'entrée à valider : jamais invalide. Elle ne demande
// jamais de nouvelle authentification non plus (étape 8 réservée aux
// actions) ; traduireLecture traite ce refus inatteignable comme une erreur.
export type ResultatLecture<T> = Exclude<Resultat<T>, { raison: "invalide" }>;

export type Chaine = {
  executerChaine: <
    E extends SchemaEntree,
    J extends ActionJournal | null,
    T,
    M extends ModelesAction,
  >(
    declaration: DeclarationAction<E, J, T, M>,
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

// Un service a demandé un modèle absent de sa déclaration : l'action est
// annulée. Message fixe.
class ModeleNonDeclare extends Error {
  constructor() {
    super("Modèle d'email absent de la déclaration.");
    this.name = "ModeleNonDeclare";
  }
}

// Entrée invalide après la consommation d'une preuve de nouvelle
// authentification : levée pour annuler la transaction, qui rend la preuve ;
// la chaîne la traduit en « invalide ». Message fixe.
class EntreeInvalideApresPreuve extends Error {
  constructor(readonly champs: string[]) {
    super("Entrée invalide.");
    this.name = "EntreeInvalideApresPreuve";
  }
}

class DeclarationInvalide extends Error {
  constructor(raison: string) {
    super(`Déclaration d'action invalide : ${raison}.`);
    this.name = "DeclarationInvalide";
  }
}

// Marque des déclarations renvoyées par declarerAction. Le symbole, hors du
// registre global et non énumérable, signale la marque sans être recopié par
// une décomposition ; il reste lisible par Object.getOwnPropertySymbols, donc
// recopiable à la main. La preuve est l'appartenance à DECLARATIONS, que seul
// ce module remplit.
const MARQUE = Symbol("déclaration d'action");
const DECLARATIONS = new WeakSet<object>();

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
export function declarerAction<
  E extends SchemaEntree,
  J extends ActionJournal | null,
  T,
  M extends ModelesAction,
>(declaration: DeclarationAction<E, J, T, M>): DeclarationAction<E, J, T, M> {
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
  // debit : un nom de LIMITES ou null, jamais absent (décision 3).
  const { debit } = declaration;
  if (debit !== null && (typeof debit !== "string" || !Object.hasOwn(LIMITES, debit))) {
    throw new DeclarationInvalide(`limite de débit inconnue ou absente (${nom})`);
  }
  // L'étape 4 compte l'utilisateur de la session : une limite qui compte
  // autre chose (envoi d'emails) n'y a pas sa place.
  if (debit !== null && LIMITES[debit].par !== "utilisateur") {
    throw new DeclarationInvalide(`limite de débit hors de l'étape 4 (${nom})`);
  }
  // emails : une liste de modèles connus, sans doublon, ou [] ; jamais
  // absent (docs/features/envoi-emails.md, section 5.3).
  const { emails } = declaration as { emails: unknown };
  if (
    !Array.isArray(emails) ||
    !emails.every((modele) => typeof modele === "string" && Object.hasOwn(MODELES_EMAIL, modele)) ||
    new Set(emails).size !== emails.length
  ) {
    throw new DeclarationInvalide(`modèles d'email inconnus ou absents (${nom})`);
  }
  if (typeof executer !== "function") throw new DeclarationInvalide(`executer absent (${nom})`);
  const marquee = { ...declaration, emails: Object.freeze([...emails]) as unknown as M };
  Object.defineProperty(marquee, MARQUE, { value: true });
  DECLARATIONS.add(marquee);
  return Object.freeze(marquee);
}

export type DeclarationQuelconque = DeclarationAction<
  SchemaEntree,
  ActionJournal | null,
  unknown,
  ModelesAction
>;

// Vrai pour une déclaration renvoyée par declarerAction, faux pour toute
// autre valeur, dont un objet écrit à la main ou une copie. Fiche : section 7,
// « Déclarations marquées ».
export function estDeclaration(valeur: unknown): valeur is DeclarationQuelconque {
  return typeof valeur === "object" && valeur !== null && DECLARATIONS.has(valeur);
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

type ContexteBase = Omit<Contexte<null>, "journaliser" | "preparerEmail"> & {
  session: SessionLue;
};

// Nom de classe d'une erreur, s'il a la forme d'un identifiant ; jamais son
// message, qui peut citer une adresse (S-54).
const CLASSE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u;
function classeErreur(erreur: unknown): string {
  if (!(erreur instanceof Error)) return typeof erreur;
  return CLASSE.test(erreur.name) ? erreur.name : "inconnue";
}

export function creerChaine(dependances: DependancesChaine): Chaine {
  // Étapes 2 à 6 de la section 5, puis travail dans la transaction. Un refus
  // à l'étape 6 lève RefusUniforme : la transaction est annulée. debit : la
  // limite de l'étape 4, null pour une lecture (décision 5).
  async function dansContexte<R>(
    requete: RequeteChaine,
    droit: Droit,
    debit: NomLimite | null,
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

    // 4. Limitation de débit, avant la transaction : la tentative est comptée
    // par une instruction propre, acquise même si l'action est annulée ensuite.
    // La valeur comptée est l'utilisateur de la session, jamais l'entrée. Une
    // erreur du compteur remonte : refus par erreur (fermé par défaut).
    // Fiche : docs/features/limitation-debit.md, sections 2.1, 6 et 10.
    if (debit !== null && !(await dependances.verifierDebit(debit, session.utilisateurId))) {
      return tropDeRequetes();
    }

    // 5. Transaction de l'organisation active ; tout ce qui suit s'y déroule.
    return dependances.executerDansOrganisation(organisationId, async (tx) => {
      // 6. Adhésion FOR SHARE, rôle parmi les quatre, droit de la matrice.
      const adhesion = await dependances.lireAdhesion(tx, session.utilisateurId);
      if (adhesion === null || !estRole(adhesion.role) || !peut(adhesion.role, droit)) {
        throw new RefusUniforme();
      }

      // 7. Double authentification exigée du Propriétaire et du Comptable
      // (S-12, S-13, T-02) : rôle et état relus à chaque requête ; refus
      // dans la transaction, qui est annulée, avant toute lecture de l'entrée.
      // Seule la valeur true compte. Fiche :
      // docs/features/double-authentification.md, section 9.
      if (ROLES_DOUBLE_AUTH.includes(adhesion.role) && session.doubleAuthentification !== true) {
        throw new RefusUniforme();
      }

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

  // Après la validation de la transaction, hors de toute transaction (règle
  // 15) : pour chaque demande, les quatre limites dans l'ordre, arrêt au
  // premier refus, puis la porte d'envoi. Un échec ne remonte jamais :
  // l'action est faite, l'email compte comme non envoyé (décision 2, option
  // A). Fiche : docs/features/envoi-emails.md, sections 5.2, 5.3 et 6.2.
  async function envoyerDemandes(
    nomAction: string,
    organisationId: string,
    demandes: readonly DemandeEmail[],
  ): Promise<{ envoyes: number; nonEnvoyes: number }> {
    let envoyes = 0;
    let nonEnvoyes = 0;
    for (const demande of demandes) {
      try {
        const destinataire = adressePourCompteur(demande.destinataire);
        const limites: readonly (readonly [NomLimite, string])[] = [
          ["email.destinataire", destinataire],
          ["email.destinataire_jour", destinataire],
          ["email.organisation", organisationId],
          ["email.application", VALEUR_APPLICATION],
        ];
        let permis = true;
        for (const [nom, valeur] of limites) {
          if (!(await dependances.verifierDebit(nom, valeur))) {
            permis = false;
            break;
          }
        }
        if (!permis) {
          nonEnvoyes += 1;
          continue;
        }
        const resultat = await dependances.envoyerEmail(demande);
        if (resultat.envoye) envoyes += 1;
        else nonEnvoyes += 1;
      } catch (erreur) {
        // Compteur indisponible ou porte qui lève : fermé par défaut, rien ne
        // part. Journal technique : ni adresse, ni message.
        nonEnvoyes += 1;
        console.error(
          "[chaine-controles]",
          JSON.stringify({
            action: nomAction,
            etape: "envoi_email",
            classe: classeErreur(erreur),
            incident: randomUUID(),
          }),
        );
      }
    }
    return { envoyes, nonEnvoyes };
  }

  async function executerChaine<
    E extends SchemaEntree,
    J extends ActionJournal | null,
    T,
    M extends ModelesAction,
  >(
    declaration: DeclarationAction<E, J, T, M>,
    requete: RequeteChaine,
    entreeBrute: unknown,
  ): Promise<Resultat<T>> {
    // Demandes d'email du service, gardées jusqu'après la validation.
    const demandes: DemandeEmail[] = [];
    let organisationVerifiee: string | undefined;
    try {
      // 1. Origine.
      if (!verifierOrigine(requete.entetes, dependances.origineAttendue)) return refus();

      const resultat = await dansContexte(
        requete,
        declaration.droit,
        declaration.debit,
        async (base) => {
          // 8. Nouvelle authentification (S-14, 1.6) : la preuve de cette
          // session, consommée dans la transaction ; rendue si l'action est
          // annulée. Fiche : docs/features/nouvelle-authentification.md,
          // section 4.
          if (
            declaration.nouvelleAuthentification &&
            !(await dependances.consommerNouvelleAuthentification(
              base.tx,
              base.utilisateurId,
              base.session.sessionId,
            ))
          ) {
            return nouvelleAuthentificationRequise();
          }

          // 9. Validation de l'entrée, par un membre autorisé seulement. Une
          // preuve vient d'être consommée : la transaction est annulée, et la
          // preuve rendue.
          const lue = declaration.entree.safeParse(entreeBrute);
          if (!lue.success) {
            const champs = champsInvalides(lue.error);
            if (declaration.nouvelleAuthentification) throw new EntreeInvalideApresPreuve(champs);
            return { ok: false, raison: "invalide", champs } as const;
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
          // Emails : la demande est validée tout de suite, gardée pour après
          // la validation. Absent quand la déclaration n'a aucun modèle.
          const modeles: readonly string[] = declaration.emails;
          const preparerEmail =
            modeles.length === 0
              ? undefined
              : (demande: unknown) => {
                  const valide = validerDemande(demande);
                  if (!modeles.includes(valide.modele)) throw new ModeleNonDeclare();
                  demandes.push(valide);
                };
          organisationVerifiee = contexte.organisationId;
          const ctx = Object.freeze({
            ...contexte,
            ...(journaliser === undefined ? {} : { journaliser }),
            ...(preparerEmail === undefined ? {} : { preparerEmail }),
          }) as unknown as Contexte<J, M>;
          const donnees = await declaration.executer(ctx, lue.data);

          // 11. Trace déclarée : obligatoire, sinon l'action est annulée.
          if (action !== null && !tracee) throw new TraceManquante();

          return { ok: true, donnees } as const;
        },
      );

      // 12. Transaction validée : les emails partent maintenant, jamais avant.
      if (!resultat.ok || declaration.emails.length === 0) return resultat;
      const emails = await envoyerDemandes(
        declaration.nom,
        organisationVerifiee as string,
        demandes,
      );
      return { ...resultat, emails };
    } catch (erreur) {
      if (erreur instanceof EntreeInvalideApresPreuve) {
        return { ok: false, raison: "invalide", champs: erreur.champs };
      }
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
      return await dansContexte(requete, droit, null, async ({ session, ...contexte }) => {
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

// Chaîne « portée compte » (2.1) : une action d'un utilisateur connecté qui
// n'a pas encore d'organisation active, ou qui en choisit une. Fiche :
// docs/features/organisations.md, section 3.

// nouvelle_organisation : la chaîne tire l'identifiant et ouvre la
// transaction de cette organisation, que le service crée. adhesion :
// transaction de entree.organisationId, adhésion relue FOR SHARE avant le
// service ; absente, même refus qu'une organisation inexistante (S-02).
export const CIBLES_COMPTE = ["nouvelle_organisation", "adhesion"] as const;
export type CibleCompte = (typeof CIBLES_COMPTE)[number];

export type ContexteActionCompte<J extends ActionJournal | null> = {
  utilisateurId: string;
  sessionId: string;
  // user.two_factor_enabled, relu avec la session : le service ne refuse
  // rien sur lui, il dit seulement à l'interface où aller ensuite.
  doubleAuthentification: boolean;
  organisationId: string;
  // null pour une nouvelle organisation ; le rôle relu sinon.
  role: Role | null;
  tx: TransactionOrganisation;
  journaliser: J extends ActionJournal ? (trace: Trace) => Promise<void> : never;
  introuvable: () => never;
};

export type DeclarationCompte<E extends SchemaEntree, J extends ActionJournal | null, T> = {
  nom: string;
  entree: E;
  cible: CibleCompte;
  journal: J;
  // Limite « par utilisateur », ou null : champ obligatoire, sans défaut.
  debit: NomLimite | null;
  executer(ctx: ContexteActionCompte<J>, entree: z.output<E>): Promise<T>;
};

export type DeclarationCompteQuelconque = DeclarationCompte<
  SchemaEntree,
  ActionJournal | null,
  unknown
>;

export type DependancesChaineCompte = Pick<
  DependancesChaine,
  | "origineAttendue"
  | "lireSession"
  | "executerDansOrganisation"
  | "lireAdhesion"
  | "journaliser"
  | "verifierDebit"
> & {
  // Faux en production tant que COMPTES_OUVERTS_EN_PRODUCTION est faux.
  comptesOuverts: boolean;
  // Identifiant d'une nouvelle organisation (randomUUID en production).
  nouvelIdentifiant: () => string;
};

export type ChaineCompte = {
  executerChaineCompte: <E extends SchemaEntree, J extends ActionJournal | null, T>(
    declaration: DeclarationCompte<E, J, T>,
    requete: RequeteChaine,
    entreeBrute: unknown,
  ) => Promise<Resultat<T>>;
};

const DECLARATIONS_COMPTE = new WeakSet<object>();

// Le champ organisationId d'un schéma, en z.uuid() : seule source de
// l'organisation d'une action « adhesion ».
function aIdentifiantOrganisation(schema: SchemaEntree): boolean {
  return schema.shape.organisationId instanceof z.ZodUUID;
}

// Le nom garde son type littéral : une action du registre de compte sans
// son cas de test ne compile pas (registre.integration.test.ts).
export function declarerActionCompte<
  const N extends string,
  E extends SchemaEntree,
  J extends ActionJournal | null,
  T,
>(declaration: DeclarationCompte<E, J, T> & { nom: N }): DeclarationCompte<E, J, T> & { nom: N } {
  const { nom, entree, cible, journal, executer } = declaration;
  if (typeof nom !== "string" || nom === "") throw new DeclarationInvalide("nom absent");
  if (!estStrict(entree)) throw new DeclarationInvalide(`schéma d'entrée non strict (${nom})`);
  if (!(CIBLES_COMPTE as readonly string[]).includes(cible)) {
    throw new DeclarationInvalide(`cible inconnue (${nom})`);
  }
  if (cible === "adhesion" && !aIdentifiantOrganisation(entree)) {
    throw new DeclarationInvalide(`organisationId absent du schéma (${nom})`);
  }
  if (journal !== null && !Object.hasOwn(ACTIONS_JOURNAL, journal)) {
    throw new DeclarationInvalide(`action du journal inconnue (${nom})`);
  }
  const { debit } = declaration;
  if (debit !== null && (typeof debit !== "string" || !Object.hasOwn(LIMITES, debit))) {
    throw new DeclarationInvalide(`limite de débit inconnue ou absente (${nom})`);
  }
  if (debit !== null && LIMITES[debit].par !== "utilisateur") {
    throw new DeclarationInvalide(`limite de débit hors de l'étape 4 (${nom})`);
  }
  if (typeof executer !== "function") throw new DeclarationInvalide(`executer absent (${nom})`);
  const marquee = { ...declaration };
  Object.defineProperty(marquee, MARQUE, { value: true });
  DECLARATIONS_COMPTE.add(marquee);
  return Object.freeze(marquee);
}

// Vrai pour une déclaration renvoyée par declarerActionCompte seulement.
export function estDeclarationCompte(valeur: unknown): valeur is DeclarationCompteQuelconque {
  return typeof valeur === "object" && valeur !== null && DECLARATIONS_COMPTE.has(valeur);
}

export function creerChaineCompte(dependances: DependancesChaineCompte): ChaineCompte {
  async function executerChaineCompte<E extends SchemaEntree, J extends ActionJournal | null, T>(
    declaration: DeclarationCompte<E, J, T>,
    requete: RequeteChaine,
    entreeBrute: unknown,
  ): Promise<Resultat<T>> {
    try {
      // 1. Origine.
      if (!verifierOrigine(requete.entetes, dependances.origineAttendue)) return refus();

      // 2. Session, relue en base.
      const session = await dependances.lireSession(requete.entetes);
      if (session === null) return connexionRequise();

      // 3. Comptes fermés en production (COMPTES_OUVERTS_EN_PRODUCTION).
      if (!dependances.comptesOuverts) return refus();

      // 4. Limitation de débit, pour l'utilisateur de la session, hors de
      // toute transaction (règle 15).
      if (
        declaration.debit !== null &&
        !(await dependances.verifierDebit(declaration.debit, session.utilisateurId))
      ) {
        return tropDeRequetes();
      }

      // 5. Validation de l'entrée : aucun rôle n'est à vérifier avant.
      const lue = declaration.entree.safeParse(entreeBrute);
      if (!lue.success)
        return { ok: false, raison: "invalide", champs: champsInvalides(lue.error) };

      // 6. L'organisation de la transaction : tirée ici, jamais par l'entrée,
      // ou celle de l'entrée validée.
      const organisationId =
        declaration.cible === "nouvelle_organisation"
          ? dependances.nouvelIdentifiant()
          : String((lue.data as { organisationId: unknown }).organisationId);

      return await dependances.executerDansOrganisation(organisationId, async (tx) => {
        // 7. Adhésion FOR SHARE, rôle parmi les quatre.
        let role: Role | null = null;
        if (declaration.cible === "adhesion") {
          const adhesion = await dependances.lireAdhesion(tx, session.utilisateurId);
          if (adhesion === null || !estRole(adhesion.role)) throw new RefusUniforme();
          role = adhesion.role;
        }

        // 8. Le service, dans la transaction ; trace liée à l'action
        // déclarée et à l'auteur de la session.
        let tracee = false;
        const action = declaration.journal;
        const journaliser =
          action === null
            ? undefined
            : async (trace: Trace) => {
                await dependances.journaliser(tx, {
                  action,
                  auteurId: session.utilisateurId,
                  ressourceId: trace.ressourceId,
                  ...(trace.details === undefined ? {} : { details: trace.details }),
                });
                tracee = true;
              };
        const ctx = Object.freeze({
          utilisateurId: session.utilisateurId,
          sessionId: session.sessionId,
          doubleAuthentification: session.doubleAuthentification === true,
          organisationId,
          role,
          tx,
          introuvable,
          ...(journaliser === undefined ? {} : { journaliser }),
        }) as unknown as ContexteActionCompte<J>;
        const donnees = await declaration.executer(ctx, lue.data);

        // 9. Trace déclarée : obligatoire, sinon l'action est annulée.
        if (action !== null && !tracee) throw new TraceManquante();
        return { ok: true, donnees } as const;
      });
    } catch (erreur) {
      return traduireErreur(erreur, declaration.nom);
    }
  }

  return { executerChaineCompte };
}

const chaine = creerChaine({
  origineAttendue: env.BETTER_AUTH_URL,
  lireSession,
  executerDansOrganisation,
  lireAdhesion,
  journaliser,
  verifierDebit,
  envoyerEmail,
  consommerNouvelleAuthentification: consommerPreuve,
});

// Chaîne liée aux vraies dépendances : seul chemin d'une action vers un
// service (DESIGN.md section 3.2).
export const executerChaine: Chaine["executerChaine"] = chaine.executerChaine;

// Noyau des lectures par les pages, lié aux vraies dépendances.
export const etablirContexte: Chaine["etablirContexte"] = chaine.etablirContexte;

// Chaîne « portée compte » liée aux vraies dépendances, construite au premier
// appel : la production se lit dans la configuration validée (VERCEL_ENV),
// comme la passerelle de /api/auth, et seulement quand une action s'exécute.
let chaineCompte: ChaineCompte | undefined;

export const executerChaineCompte: ChaineCompte["executerChaineCompte"] = (
  declaration,
  requete,
  entreeBrute,
) => {
  chaineCompte ??= creerChaineCompte({
    origineAttendue: env.BETTER_AUTH_URL,
    comptesOuverts: !configurationEmail.estProduction || COMPTES_OUVERTS_EN_PRODUCTION,
    nouvelIdentifiant: randomUUID,
    lireSession,
    executerDansOrganisation,
    lireAdhesion,
    journaliser,
    verifierDebit,
  });
  return chaineCompte.executerChaineCompte(declaration, requete, entreeBrute);
};
