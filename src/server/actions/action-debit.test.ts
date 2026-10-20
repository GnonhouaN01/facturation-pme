import { randomUUID } from "node:crypto";
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import type { TransactionOrganisation } from "../db/client";
import type { NomLimite } from "../debit/limites";

import {
  creerChaine,
  declarerAction,
  type AdhesionLue,
  type DeclarationAction,
  type DependancesChaine,
  type SessionLue,
} from "./action";

// Étape 4 de la chaîne : la limitation de débit, sans base ni Next.js.
// Fiche : docs/features/limitation-debit.md, section 10.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const ORIGINE = "https://facturation.exemple.ci";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TROP = { ok: false, raison: "trop_de_requetes" } as const;
const CONNEXION = { ok: false, raison: "connexion_requise" } as const;
const REFUS = { ok: false, raison: "refuse" } as const;

const tx = { transactionFactice: true } as unknown as TransactionOrganisation;
const SCHEMA_VIDE = z.strictObject({});

type Etat = {
  session: SessionLue | null;
  adhesion: AdhesionLue | null;
  // Réponse de verifierDebit : vrai sous la limite, ou une erreur à lever.
  debit: boolean | Error;
};

let etat: Etat;
let etapes: string[];
let espionErreur: ReturnType<typeof vi.spyOn>;

function dependances() {
  const verifierDebit = vi.fn<DependancesChaine["verifierDebit"]>(async (nom, valeur) => {
    etapes.push(`debit:${nom}:${valeur}`);
    if (etat.debit instanceof Error) throw etat.debit;
    return etat.debit;
  });
  const executerDansOrganisation = vi.fn(
    async <T>(organisationId: string, travail: (t: TransactionOrganisation) => Promise<T>) => {
      etapes.push(`transaction:${organisationId}`);
      try {
        const resultat = await travail(tx);
        etapes.push("validation");
        return resultat;
      } catch (erreur) {
        etapes.push("annulation");
        throw erreur;
      }
    },
  );
  const deps: DependancesChaine = {
    origineAttendue: ORIGINE,
    lireSession: async () => {
      etapes.push("session");
      return etat.session;
    },
    executerDansOrganisation:
      executerDansOrganisation as DependancesChaine["executerDansOrganisation"],
    lireAdhesion: async () => {
      etapes.push("adhesion");
      return etat.adhesion;
    },
    journaliser: async () => {
      etapes.push("journal");
    },
    verifierDebit,
    envoyerEmail: async () => ({ envoye: false, raison: "non_autorise" }),
  };
  return { deps, verifierDebit, executerDansOrganisation };
}

function requete() {
  return { entetes: new Headers({ origin: ORIGINE }) };
}

function declaration(
  debit: NomLimite | null = "membre.action",
  surcharges: Partial<DeclarationAction<typeof SCHEMA_VIDE, null, string>> = {},
) {
  return declarerAction({
    nom: "demo.debit",
    droit: "organisation.membres.voir",
    entree: SCHEMA_VIDE,
    journal: null,
    nouvelleAuthentification: false,
    debit,
    emails: [],
    executer: vi.fn(async () => {
      etapes.push("service");
      return "fait";
    }),
    ...surcharges,
  });
}

beforeEach(() => {
  etapes = [];
  etat = {
    session: {
      utilisateurId: randomUUID(),
      organisationActiveId: randomUUID(),
      doubleAuthentification: true,
    },
    adhesion: { membreId: randomUUID(), role: "proprietaire" },
    debit: true,
  };
  espionErreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  espionErreur.mockRestore();
});

describe("étape 4 : place dans l'ordre des contrôles", () => {
  test("après la session et l'organisation active, avant la transaction", async () => {
    const { deps } = dependances();
    const session = etat.session as SessionLue;

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(etapes).toEqual([
      "session",
      `debit:membre.action:${session.utilisateurId}`,
      `transaction:${session.organisationActiveId}`,
      "adhesion",
      "service",
      "validation",
    ]);
  });

  test("sans session : connexion_requise, verifierDebit non appelée", async () => {
    etat.session = null;
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(CONNEXION);
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test.each([
    ["absente", null],
    ["invalide", "pas-un-uuid"],
  ])("organisation active %s : refuse, verifierDebit non appelée", async (_nom, valeur) => {
    etat.session = {
      utilisateurId: randomUUID(),
      organisationActiveId: valeur,
      doubleAuthentification: true,
    };
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test("origine refusée : verifierDebit non appelée", async () => {
    const { deps, verifierDebit } = dependances();

    await creerChaine(deps).executerChaine(
      declaration(),
      { entetes: new Headers({ origin: "https://attaquant.test" }) },
      {},
    );

    expect(verifierDebit).not.toHaveBeenCalled();
  });
});

describe("étape 4 : ce qui est compté", () => {
  test("le nom de la déclaration et l'utilisateur de la session, une seule fois", async () => {
    const { deps, verifierDebit } = dependances();

    await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(verifierDebit).toHaveBeenCalledTimes(1);
    expect(verifierDebit).toHaveBeenCalledWith("membre.action", etat.session?.utilisateurId);
  });

  test("une entrée qui désigne un autre utilisateur ne change pas la valeur comptée", async () => {
    const { deps, verifierDebit } = dependances();
    const autre = randomUUID();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {
      utilisateurId: autre,
      debit: "autre",
      cle: "membre.action:0",
    });

    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect(verifierDebit).toHaveBeenCalledWith("membre.action", etat.session?.utilisateurId);
    expect(inspect(verifierDebit.mock.calls)).not.toContain(autre);
  });

  test("debit: null : verifierDebit non appelée, l'action s'exécute", async () => {
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(null), requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test("une tentative refusée ensuite par le rôle a été comptée", async () => {
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      declaration("membre.action", { droit: "organisation.supprimer" }),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(verifierDebit).toHaveBeenCalledTimes(1);
  });
});

describe("étape 4 : limite atteinte", () => {
  test("trop_de_requetes, sans transaction, sans service, sans journal technique", async () => {
    etat.debit = false;
    const { deps, executerDansOrganisation } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(TROP);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
    expect(decl.executer).not.toHaveBeenCalled();
    expect(etapes).not.toContain("adhesion");
    expect(espionErreur).not.toHaveBeenCalled();
  });

  test("même réponse pour un rôle non autorisé : le rôle n'est pas lu", async () => {
    etat.debit = false;
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      declaration("membre.action", { droit: "organisation.supprimer" }),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual(TROP);
    expect(etapes).not.toContain("adhesion");
  });

  test("même réponse quelle que soit l'entrée, valide ou non", async () => {
    etat.debit = false;
    const { deps } = dependances();
    const chaine = creerChaine(deps);

    const valide = await chaine.executerChaine(declaration(), requete(), {});
    const invalide = await chaine.executerChaine(declaration(), requete(), { inconnu: 1 });

    expect(valide).toStrictEqual(TROP);
    expect(invalide).toStrictEqual(TROP);
  });
});

describe("étape 4 : compteur indisponible (fermé par défaut)", () => {
  test("erreur avec incident, aucune étape suivante", async () => {
    etat.debit = new Error("connexion perdue vers la base");
    const { deps, executerDansOrganisation } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual({
      ok: false,
      raison: "erreur",
      incident: expect.stringMatching(UUID),
    });
    expect(executerDansOrganisation).not.toHaveBeenCalled();
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test("le journal technique ne contient ni le message, ni l'utilisateur", async () => {
    etat.debit = new Error("connexion perdue vers la base");
    const { deps } = dependances();

    await creerChaine(deps).executerChaine(declaration(), requete(), {});

    const journal = inspect(espionErreur.mock.calls, { depth: Infinity });
    expect(espionErreur).toHaveBeenCalled();
    expect(journal).not.toContain("connexion perdue");
    expect(journal).not.toContain(etat.session?.utilisateurId);
  });
});

describe("etablirContexte : aucune limite sur les lectures en 0.5 (décision 5)", () => {
  test("verifierDebit n'est jamais appelée", async () => {
    etat.debit = false;
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      { entetes: new Headers() },
      "organisation.membres.voir",
      async () => "lu",
    );

    expect(resultat).toStrictEqual({ ok: true, donnees: "lu" });
    expect(verifierDebit).not.toHaveBeenCalled();
  });
});

describe("declarerAction : champ debit", () => {
  function declarer(debit: unknown) {
    return () =>
      declarerAction({
        nom: "demo.debit",
        droit: "organisation.membres.voir",
        entree: SCHEMA_VIDE,
        journal: null,
        nouvelleAuthentification: false,
        debit: debit as NomLimite | null,
        emails: [],
        executer: async () => "fait",
      });
  }

  test("un nom de LIMITES ou null : accepté", () => {
    expect(declarer("membre.action")).not.toThrow();
    expect(declarer(null)).not.toThrow();
  });

  test.each([
    ["nom inconnu", "inconnu"],
    ["propriété héritée", "constructor"],
    ["absent", undefined],
    ["nombre", 60],
  ])("%s : refusé à l'exécution", (_nom, debit) => {
    expect(declarer(debit)).toThrow();
  });

  test("absent : refusé pour une déclaration écrite sans le champ", () => {
    const sansDebit = {
      nom: "demo.sans_debit",
      droit: "organisation.membres.voir",
      entree: SCHEMA_VIDE,
      journal: null,
      nouvelleAuthentification: false,
      emails: [],
      executer: async () => "fait",
    } as unknown as Parameters<typeof declarerAction>[0];

    expect(() => declarerAction(sansDebit)).toThrow();
  });
});

// Vérifié par npm run typecheck : chaque @ts-expect-error doit couvrir une
// erreur réelle. Les fonctions ne sont jamais appelées.
describe("declarerAction : debit absent ou inconnu ne compile pas", () => {
  const executer = async () => "fait";

  test("les cas ci-dessous ne compilent pas", () => {
    const cas = [
      () =>
        // @ts-expect-error debit absent
        declarerAction({
          nom: "demo.sans_debit",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          emails: [],
          executer,
        }),
      () =>
        declarerAction({
          nom: "demo.debit_inconnu",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          // @ts-expect-error limite hors de LIMITES
          debit: "inconnu",
          emails: [],
          executer,
        }),
    ];

    expect(cas).toHaveLength(2);
  });
});
