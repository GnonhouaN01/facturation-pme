import { randomUUID } from "node:crypto";
import { inspect } from "node:util";

import { notFound, redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import type { TransactionOrganisation } from "../db/client";
import { OrganisationActiveInvalide } from "../db/client";
import type { ActionJournal } from "../journal/actions";
import { EntreeJournalInvalide } from "../journal/audit";

import {
  creerChaine,
  declarerAction,
  type AdhesionLue,
  type Contexte,
  type ContexteLecture,
  type DeclarationAction,
  type DependancesChaine,
  type SchemaEntree,
  type SessionLue,
} from "./action";

// La chaîne, sans base ni Next.js : dépendances factices et espionnes. Les
// déclarations sont construites dans chaque test, avec des services espions
// neufs. Fiche : docs/features/chaine-controles.md, sections 4 à 6.

// client.ts et la configuration de Better Auth lisent env au chargement :
// valeurs factices, aucune connexion n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const ORIGINE = "https://facturation.exemple.ci";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REFUS = { ok: false, raison: "refuse" } as const;
const CONNEXION = { ok: false, raison: "connexion_requise" } as const;
const ERREUR = { ok: false, raison: "erreur", incident: expect.stringMatching(UUID) };

const tx = { transactionFactice: true } as unknown as TransactionOrganisation;

const SCHEMA_VIDE = z.strictObject({});

// Ce que les dépendances factices renvoient, réglable par test.
type Etat = {
  session: SessionLue | null;
  adhesion: AdhesionLue | null;
  // 1.6 : une preuve de nouvelle authentification de la session à consommer.
  preuve: boolean;
};

let etat: Etat;
let etapes: string[];

// Second facteur actif par défaut : un Propriétaire réel l'a (étape 7).
function sessionValide(): SessionLue {
  return {
    utilisateurId: randomUUID(),
    sessionId: "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    organisationActiveId: randomUUID(),
    doubleAuthentification: true,
  };
}

function dependances() {
  const lireSession = vi.fn<DependancesChaine["lireSession"]>(async () => {
    etapes.push("session");
    return etat.session;
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
  const lireAdhesion = vi.fn<DependancesChaine["lireAdhesion"]>(async () => {
    etapes.push("adhesion");
    return etat.adhesion;
  });
  const journaliser = vi.fn(async () => {
    etapes.push("journal");
  });
  const consommerNouvelleAuthentification = vi.fn<
    DependancesChaine["consommerNouvelleAuthentification"]
  >(async () => {
    etapes.push("preuve");
    return etat.preuve;
  });
  const deps: DependancesChaine = {
    origineAttendue: ORIGINE,
    lireSession,
    executerDansOrganisation:
      executerDansOrganisation as DependancesChaine["executerDansOrganisation"],
    lireAdhesion,
    journaliser,
    verifierDebit: vi.fn(async () => true),
    envoyerEmail: async () => ({ envoye: false, raison: "non_autorise" }),
    consommerNouvelleAuthentification,
  };
  return {
    deps,
    lireSession,
    executerDansOrganisation,
    lireAdhesion,
    journaliser,
    consommerNouvelleAuthentification,
  };
}

function requete(entetes: Record<string, string> = { origin: ORIGINE }) {
  return { entetes: new Headers(entetes) };
}

// Déclaration de démonstration : par défaut, lecture permise aux quatre
// rôles, sans trace, service espion qui renvoie "fait".
function declaration<
  E extends SchemaEntree = typeof SCHEMA_VIDE,
  J extends ActionJournal | null = null,
  T = string,
>(surcharges: Partial<DeclarationAction<E, J, T>> = {}): DeclarationAction<E, J, T> {
  return declarerAction({
    nom: "demo.test",
    droit: "organisation.membres.voir",
    entree: SCHEMA_VIDE as unknown as E,
    journal: null as J,
    nouvelleAuthentification: false,
    debit: null,
    emails: [],
    executer: vi.fn(async () => {
      etapes.push("service");
      return "fait" as T;
    }),
    ...surcharges,
  } as DeclarationAction<E, J, T>);
}

let espionErreur: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  etapes = [];
  etat = {
    session: sessionValide(),
    adhesion: { membreId: randomUUID(), role: "proprietaire" },
    preuve: false,
  };
  espionErreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  espionErreur.mockRestore();
});

// Tout ce qui a été écrit au journal technique, objets d'erreur et cause
// compris : inspect montre le message et la cause d'une Error, que
// JSON.stringify omet.
function journalTechnique(): string {
  return inspect(espionErreur.mock.calls, { depth: Infinity });
}

describe("ordre des contrôles (section 5)", () => {
  test("succès : session, transaction de l'organisation active, adhésion, service, validation", async () => {
    const { deps } = dependances();
    const organisationId = etat.session?.organisationActiveId;

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(etapes).toEqual([
      "session",
      `transaction:${organisationId}`,
      "adhesion",
      "service",
      "validation",
    ]);
  });

  test("l'adhésion est lue dans la transaction, pour l'utilisateur de la session", async () => {
    const { deps, lireAdhesion } = dependances();

    await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(lireAdhesion).toHaveBeenCalledTimes(1);
    expect(lireAdhesion).toHaveBeenCalledWith(tx, etat.session?.utilisateurId);
  });

  test("la session est lue avec les en-têtes de la requête", async () => {
    const { deps, lireSession } = dependances();
    const req = requete({ origin: ORIGINE, cookie: "jeton=valeur" });

    await creerChaine(deps).executerChaine(declaration(), req, {});

    expect(lireSession).toHaveBeenCalledWith(req.entetes);
  });
});

describe("étape 1 : origine refusée", () => {
  test.each([
    ["absente", {}],
    ["autre site", { origin: "https://attaquant.test" }],
    ["null", { origin: "null" }],
    ["Sec-Fetch-Site cross-site", { origin: ORIGINE, "sec-fetch-site": "cross-site" }],
  ])("%s : refuse, sans lecture de session", async (_nom, entetes) => {
    const { deps, lireSession, executerDansOrganisation } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(entetes), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(lireSession).not.toHaveBeenCalled();
    expect(executerDansOrganisation).not.toHaveBeenCalled();
    expect(espionErreur).not.toHaveBeenCalled();
  });
});

describe("étape 2 : session", () => {
  test("absente : connexion_requise, sans transaction ouverte", async () => {
    etat.session = null;
    const { deps, executerDansOrganisation } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(CONNEXION);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
  });

  test("lecture en échec (base injoignable) : erreur avec incident, sans transaction", async () => {
    const { deps, lireSession, executerDansOrganisation } = dependances();
    lireSession.mockRejectedValueOnce(new Error("connexion perdue"));

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(ERREUR);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
  });
});

describe("étape 3 : organisation active", () => {
  test.each([
    ["absente", null],
    ["vide", ""],
    ["pas un UUID", "organisation-a"],
    ["injection", "00000000-0000-4000-8000-000000000000' OR '1'='1"],
    ["UUID entouré d'espaces", ` ${randomUUID()} `],
  ])("%s : refuse, sans transaction ouverte", async (_nom, organisationActiveId) => {
    etat.session = { ...sessionValide(), organisationActiveId };
    const { deps, executerDansOrganisation } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
  });
});

describe("étape 6 : adhésion et rôle", () => {
  test("adhésion absente : refuse, service non appelé", async () => {
    etat.adhesion = null;
    const { deps } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test.each([
    "owner",
    "admin",
    "member",
    "",
    "comptable,proprietaire",
    "proprietaire,comptable",
    "Proprietaire",
    " proprietaire",
    "__proto__",
    "constructor",
  ])("rôle %j : refuse, même pour un droit des quatre rôles", async (role) => {
    etat.adhesion = { membreId: randomUUID(), role };
    const { deps } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test.each(["comptable", "commercial", "lecteur"])(
    "%s sur un droit du Propriétaire seul : refuse, service non appelé",
    async (role) => {
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps } = dependances();
      const decl = declaration({ droit: "organisation.supprimer" });

      const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

      expect(resultat).toStrictEqual(REFUS);
      expect(decl.executer).not.toHaveBeenCalled();
    },
  );

  test("rôle refusé avec une entrée invalide : refuse, pas invalide (rôle avant validation)", async () => {
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps } = dependances();
    const decl = declaration({
      droit: "organisation.supprimer",
      entree: z.strictObject({ nom: z.string() }),
    });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), { nom: 42, autre: 1 });

    expect(resultat).toStrictEqual(REFUS);
  });

  test("refus du rôle : aucune étape suivante, rien au journal technique", async () => {
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps, journaliser } = dependances();

    await creerChaine(deps).executerChaine(
      declaration({ droit: "organisation.supprimer" }),
      requete(),
      {},
    );

    expect(etapes).not.toContain("service");
    expect(journaliser).not.toHaveBeenCalled();
    expect(espionErreur).not.toHaveBeenCalled();
  });
});

// T-02, S-12, S-13 : un Propriétaire ou un Comptable sans second facteur
// n'accède à aucune donnée, quelle que soit l'action ou la page ; le
// Commercial et le Lecteur ne sont pas concernés. Après l'étape 6, avant la
// nouvelle authentification et la validation de l'entrée. Fiche :
// docs/features/double-authentification.md, section 9, test 28.
describe("étape 7 : double authentification par rôle", () => {
  const ROLES = ["proprietaire", "comptable", "commercial", "lecteur"] as const;
  const EXIGEANTS: readonly string[] = ["proprietaire", "comptable"];

  function sansSecondFacteur() {
    etat.session = { ...sessionValide(), doubleAuthentification: false };
  }

  describe.each(ROLES)("%s", (role) => {
    const exigeant = EXIGEANTS.includes(role);

    test(`sans second facteur, action : ${exigeant ? "refuse, transaction annulée, service non appelé" : "acceptée"}`, async () => {
      sansSecondFacteur();
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps, journaliser } = dependances();
      const decl = declaration();

      const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

      if (exigeant) {
        expect(resultat).toStrictEqual(REFUS);
        expect(decl.executer).not.toHaveBeenCalled();
        expect(etapes.at(-1)).toBe("annulation");
        expect(journaliser).not.toHaveBeenCalled();
        expect(espionErreur).not.toHaveBeenCalled();
      } else {
        expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
      }
    });

    test(`sans second facteur, entrée invalide : ${exigeant ? "refuse, pas invalide" : "invalide"}`, async () => {
      sansSecondFacteur();
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps } = dependances();
      const decl = declaration({ entree: z.strictObject({ nom: z.string() }) });

      const resultat = await creerChaine(deps).executerChaine(decl, requete(), { nom: 42 });

      if (exigeant) expect(resultat).toStrictEqual(REFUS);
      else expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    });

    test(`sans second facteur, lecture d'une page : ${exigeant ? "refuse, lecture non faite" : "faite"}`, async () => {
      sansSecondFacteur();
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps } = dependances();
      const lire = vi.fn(async () => "lu");

      const resultat = await creerChaine(deps).etablirContexte(
        requete(),
        "organisation.membres.voir",
        lire,
      );

      if (exigeant) {
        expect(resultat).toStrictEqual(REFUS);
        expect(lire).not.toHaveBeenCalled();
        expect(etapes.at(-1)).toBe("annulation");
      } else {
        expect(resultat).toStrictEqual({ ok: true, donnees: "lu" });
      }
    });

    test("avec second facteur : action et lecture acceptées", async () => {
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps } = dependances();
      const chaine = creerChaine(deps);

      expect(await chaine.executerChaine(declaration(), requete(), {})).toStrictEqual({
        ok: true,
        donnees: "fait",
      });
      expect(
        await chaine.etablirContexte(requete(), "organisation.membres.voir", async () => "lu"),
      ).toStrictEqual({ ok: true, donnees: "lu" });
    });
  });

  test("l'état du second facteur vient de la session, jamais de l'entrée", async () => {
    sansSecondFacteur();
    const { deps } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {
      doubleAuthentification: true,
    });

    expect(resultat).toStrictEqual(REFUS);
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test("après l'étape 6 : un droit refusé par la matrice reste refusé à l'adhésion", async () => {
    sansSecondFacteur();
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps, lireAdhesion } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      declaration({ droit: "organisation.supprimer" }),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(lireAdhesion).toHaveBeenCalledTimes(1);
  });

  test("valeur autre que true (session mal formée) : refusée comme false", async () => {
    etat.session = {
      ...sessionValide(),
      doubleAuthentification: "true" as unknown as boolean,
    };
    const { deps } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(decl.executer).not.toHaveBeenCalled();
  });
});

// Modifié en 1.6 (remplace « fermée en 0.4 ») : une action sensible exige
// une preuve de nouvelle authentification de la session, consommée dans la
// transaction de l'action, après le droit (étapes 6 et 7) et avant l'entrée
// (étape 9). Fiche : docs/features/nouvelle-authentification.md, section 4,
// test 1.
describe("étape 8 : nouvelle authentification (1.6)", () => {
  const NOUVELLE_AUTH = { ok: false, raison: "nouvelle_authentification_requise" } as const;
  const SCHEMA_VALEUR = z.strictObject({ valeur: z.string() });

  test.each(["proprietaire", "comptable", "commercial", "lecteur"])(
    "%s sans preuve : nouvelle_authentification_requise, service non appelé",
    async (role) => {
      etat.adhesion = { membreId: randomUUID(), role };
      const { deps, consommerNouvelleAuthentification } = dependances();
      const decl = declaration({ nouvelleAuthentification: true });

      const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

      expect(resultat).toStrictEqual(NOUVELLE_AUTH);
      expect(decl.executer).not.toHaveBeenCalled();
      expect(consommerNouvelleAuthentification).toHaveBeenCalledTimes(1);
      expect(consommerNouvelleAuthentification).toHaveBeenCalledWith(
        tx,
        etat.session?.utilisateurId,
        etat.session?.sessionId,
      );
    },
  );

  test("avec preuve : service appelé, preuve consommée après l'adhésion, avant le service", async () => {
    etat.preuve = true;
    const { deps } = dependances();
    const decl = declaration({ nouvelleAuthentification: true });
    const organisationId = etat.session?.organisationActiveId;

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(etapes).toEqual([
      "session",
      `transaction:${organisationId}`,
      "adhesion",
      "preuve",
      "service",
      "validation",
    ]);
  });

  test.each([
    ["non-membre", () => (etat.adhesion = null)],
    [
      "droit refusé par la matrice",
      () => (etat.adhesion = { membreId: randomUUID(), role: "lecteur" }),
    ],
    [
      "Propriétaire sans second facteur",
      () => (etat.session = { ...sessionValide(), doubleAuthentification: false }),
    ],
  ])("%s : refuse, preuve ni lue ni consommée", async (_nom, preparer) => {
    etat.preuve = true;
    preparer();
    const { deps, consommerNouvelleAuthentification } = dependances();
    const decl = declaration({ nouvelleAuthentification: true, droit: "organisation.supprimer" });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(consommerNouvelleAuthentification).not.toHaveBeenCalled();
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test("entrée invalide sans preuve : nouvelle_authentification_requise, pas invalide", async () => {
    const { deps } = dependances();
    const decl = declaration({ nouvelleAuthentification: true, entree: SCHEMA_VALEUR });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), { inattendu: 1 });

    expect(resultat).toStrictEqual(NOUVELLE_AUTH);
  });

  test("entrée invalide avec preuve : invalide, transaction annulée (la preuve reste)", async () => {
    etat.preuve = true;
    const { deps } = dependances();
    const decl = declaration({ nouvelleAuthentification: true, entree: SCHEMA_VALEUR });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), { valeur: 3 });

    expect(resultat).toStrictEqual({ ok: false, raison: "invalide", champs: ["valeur"] });
    expect(etapes).toContain("annulation");
    expect(etapes).not.toContain("validation");
  });

  test("service qui refuse avec preuve : refuse, transaction annulée (la preuve reste)", async () => {
    etat.preuve = true;
    const { deps } = dependances();
    const decl = declaration({
      nouvelleAuthentification: true,
      executer: async (ctx) => ctx.introuvable(),
    });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    // Témoin : le refus vient bien du service, après la preuve.
    expect(etapes).toEqual(expect.arrayContaining(["preuve", "annulation"]));
  });

  test("lecture de la preuve en panne : erreur avec incident, service non appelé", async () => {
    const { deps, consommerNouvelleAuthentification } = dependances();
    consommerNouvelleAuthentification.mockRejectedValueOnce(new Error("panne"));
    const decl = declaration({ nouvelleAuthentification: true });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(ERREUR);
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test("nouvelleAuthentification: false, et lectures des pages : aucune preuve lue", async () => {
    etat.preuve = true;
    const { deps, consommerNouvelleAuthentification } = dependances();
    const chaine = creerChaine(deps);

    expect(await chaine.executerChaine(declaration(), requete(), {})).toStrictEqual({
      ok: true,
      donnees: "fait",
    });
    const lue = await chaine.etablirContexte(requete(), "organisation.membres.voir", async () => 1);
    expect(lue).toStrictEqual({ ok: true, donnees: 1 });
    expect(consommerNouvelleAuthentification).not.toHaveBeenCalled();
  });
});

describe("étape 9 : validation de l'entrée", () => {
  const schemaLignes = z.strictObject({
    lignes: z.array(z.strictObject({ quantite: z.int() })),
  });

  test("champ invalide : invalide, chemin seul, ni la valeur ni le message de Zod", async () => {
    const { deps } = dependances();
    const decl = declaration({ entree: schemaLignes });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {
      lignes: [{ quantite: "VALEUR-RECUE-SECRETE" }],
    });

    expect(resultat).toStrictEqual({
      ok: false,
      raison: "invalide",
      champs: ["lignes.0.quantite"],
    });
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test.each([
    ["organisationId", { organisationId: randomUUID() }],
    ["role", { role: "proprietaire" }],
    ["auteurId", { auteurId: randomUUID() }],
  ])("entrée contenant %s : invalide, valeur absente du résultat", async (_cle, ajout) => {
    const { deps } = dependances();
    const decl = declaration({ entree: schemaLignes });
    const valeur = Object.values(ajout)[0] as string;

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {
      lignes: [],
      ...ajout,
    });

    expect(resultat.ok).toBe(false);
    expect(resultat).toMatchObject({ raison: "invalide" });
    expect(JSON.stringify(resultat)).not.toContain(valeur);
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["texte", "texte"],
    ["nombre", 42],
    ["tableau", []],
  ])("entrée %s : invalide", async (_nom, brute) => {
    const { deps } = dependances();
    const decl = declaration();

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), brute);

    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect(decl.executer).not.toHaveBeenCalled();
  });

  test("le service reçoit l'entrée validée par le schéma", async () => {
    const { deps } = dependances();
    const executer = vi.fn(async (_ctx: unknown, entree: { quantite: number }) => entree.quantite);
    const decl = declaration({
      entree: z.strictObject({ quantite: z.coerce.number().int() }),
      executer,
    } as never);

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), { quantite: "7" });

    expect(resultat).toStrictEqual({ ok: true, donnees: 7 });
    expect(executer).toHaveBeenCalledWith(expect.anything(), { quantite: 7 });
  });
});

describe("étape 10 : le contexte reçu par le service", () => {
  test("utilisateur et organisation de la session, rôle de l'adhésion, transaction de la chaîne", async () => {
    const { deps } = dependances();
    let recu: Contexte<null> | undefined;
    const decl = declaration({
      executer: async (ctx) => {
        recu = ctx;
        return "fait";
      },
    });

    await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(recu).toMatchObject({
      utilisateurId: etat.session?.utilisateurId,
      organisationId: etat.session?.organisationActiveId,
      role: "proprietaire",
      perimetre: "organisation",
    });
    expect(recu?.tx).toBe(tx);
  });

  test.each([
    ["commercial", "clients.voir", "portefeuille"],
    ["commercial", "factures.emises.voir", "portefeuille"],
    ["commercial", "catalogue.voir", "organisation"],
    ["lecteur", "clients.voir", "organisation"],
    ["comptable", "clients.voir", "organisation"],
  ] as const)("%s sur %s : perimetre %s", async (role, droit, attendu) => {
    etat.adhesion = { membreId: randomUUID(), role };
    const { deps } = dependances();
    let perimetre: string | undefined;
    const decl = declaration({
      droit,
      executer: async (ctx) => {
        perimetre = ctx.perimetre;
        return "fait";
      },
    });

    await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(perimetre).toBe(attendu);
  });

  test("ctx.introuvable() : refuse, transaction annulée, rien au journal technique", async () => {
    const { deps } = dependances();
    const decl = declaration({
      executer: async (ctx) => ctx.introuvable(),
    });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(REFUS);
    expect(etapes.at(-1)).toBe("annulation");
    expect(espionErreur).not.toHaveBeenCalled();
  });
});

describe("étape 11 : trace déclarée (T-20)", () => {
  const JOURNAL = "organisation.parametres_modifies" as const;

  test("ctx.journaliser : action de la déclaration, auteur de la session, transaction de la chaîne", async () => {
    const { deps, journaliser } = dependances();
    const ressourceId = randomUUID();
    const decl = declaration({
      journal: JOURNAL,
      executer: async (ctx) => {
        await ctx.journaliser({ ressourceId });
        return "fait";
      },
    });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(journaliser).toHaveBeenCalledTimes(1);
    expect(journaliser).toHaveBeenCalledWith(tx, {
      action: JOURNAL,
      auteurId: etat.session?.utilisateurId,
      ressourceId,
    });
  });

  test("le service ne peut imposer ni l'action ni l'auteur de la trace", async () => {
    const { deps, journaliser } = dependances();
    const ressourceId = randomUUID();
    const decl = declaration({
      journal: JOURNAL,
      executer: async (ctx) => {
        await ctx.journaliser({
          ressourceId,
          action: "membre.retire",
          auteurId: randomUUID(),
        } as never);
        return "fait";
      },
    });

    await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(journaliser).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: JOURNAL, auteurId: etat.session?.utilisateurId }),
    );
  });

  test("trace déclarée mais non écrite : erreur avec incident, transaction annulée", async () => {
    const { deps } = dependances();
    const decl = declaration({ journal: JOURNAL });

    const resultat = await creerChaine(deps).executerChaine(decl, requete(), {});

    expect(resultat).toStrictEqual(ERREUR);
    expect(etapes).toContain("service");
    expect(etapes.at(-1)).toBe("annulation");
  });

  test("sans trace déclarée : la chaîne n'exige rien", async () => {
    const { deps, journaliser } = dependances();

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(journaliser).not.toHaveBeenCalled();
  });
});

// Erreur PostgreSQL telle que pg la lève, éventuellement enveloppée par
// Drizzle dans une erreur dont elle est la cause.
function erreurPostgres(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function enveloppee(cause: Error): Error {
  return new Error("Failed query: insert into ...", { cause });
}

describe("traduction des erreurs (section 6.3)", () => {
  async function executerQuiLeve(erreur: unknown, entree: unknown = {}) {
    const { deps } = dependances();
    const decl = declaration({
      nom: "demo.qui_leve",
      entree: z.strictObject({ valeur: z.string().optional() }),
      executer: async () => {
        throw erreur;
      },
    });
    const resultat = await creerChaine(deps).executerChaine(decl, requete(), entree);
    return resultat;
  }

  test("OrganisationActiveInvalide levée par executerDansOrganisation : refuse", async () => {
    const { deps, executerDansOrganisation } = dependances();
    executerDansOrganisation.mockRejectedValueOnce(new OrganisationActiveInvalide());

    const resultat = await creerChaine(deps).executerChaine(declaration(), requete(), {});

    expect(resultat).toStrictEqual(REFUS);
  });

  test.each([
    ["42501", false],
    ["42501", true],
    ["23503", false],
    ["23503", true],
  ])(
    "PostgreSQL %s (enveloppée : %s) : refuse, journal technique avec le code, sans le message",
    async (code, envelopper) => {
      const pg = erreurPostgres(
        code,
        'Key (email)=(secret@exemple.ci) is not present in table "user"',
      );

      const resultat = await executerQuiLeve(envelopper ? enveloppee(pg) : pg);

      expect(resultat).toStrictEqual(REFUS);
      const journal = journalTechnique();
      expect(journal).toContain("demo.qui_leve");
      expect(journal).toContain(code);
      expect(journal).not.toContain("secret@exemple.ci");
      expect(journal).not.toContain("Failed query");
    },
  );

  test("EntreeJournalInvalide : erreur avec incident, journal technique avec la classe", async () => {
    const resultat = await executerQuiLeve(new EntreeJournalInvalide());

    expect(resultat).toStrictEqual(ERREUR);
    const journal = journalTechnique();
    expect(journal).toContain("demo.qui_leve");
    expect(journal).toContain("EntreeJournalInvalide");
    expect(journal).toContain((resultat as { incident: string }).incident);
  });

  test("PostgreSQL 23505 enveloppée : erreur avec incident, code au journal, ni message ni cause", async () => {
    const pg = erreurPostgres("23505", "Key (email)=(secret@exemple.ci) already exists.");

    const resultat = await executerQuiLeve(enveloppee(pg));

    expect(resultat).toStrictEqual(ERREUR);
    const journal = journalTechnique();
    expect(journal).toContain("23505");
    expect(journal).not.toContain("secret@exemple.ci");
    expect(journal).not.toContain("Failed query");
  });

  test("erreur inattendue : erreur avec incident ; ni message, ni cause, ni valeur de l'entrée au journal technique", async () => {
    const erreur = new TypeError("MESSAGE-SECRET", { cause: new Error("CAUSE-SECRETE") });

    const resultat = await executerQuiLeve(erreur, { valeur: "VALEUR-ENTREE-SECRETE" });

    expect(resultat).toStrictEqual(ERREUR);
    const journal = journalTechnique();
    expect(journal).toContain("demo.qui_leve");
    expect(journal).toContain("TypeError");
    expect(journal).toContain((resultat as { incident: string }).incident);
    expect(journal).not.toContain("MESSAGE-SECRET");
    expect(journal).not.toContain("CAUSE-SECRETE");
    expect(journal).not.toContain("VALEUR-ENTREE-SECRETE");
    // Le client ne reçoit rien de plus que l'incident.
    expect(JSON.stringify(resultat)).not.toContain("SECRET");
  });

  test("valeur levée qui n'est pas une Error : erreur, valeur absente du journal technique", async () => {
    const resultat = await executerQuiLeve("CHAINE-LEVEE-SECRETE");

    expect(resultat).toStrictEqual(ERREUR);
    expect(journalTechnique()).not.toContain("CHAINE-LEVEE-SECRETE");
  });

  test("deux erreurs : deux incidents distincts", async () => {
    const premier = await executerQuiLeve(new Error("a"));
    const second = await executerQuiLeve(new Error("b"));

    expect(premier).toStrictEqual(ERREUR);
    expect(second).toStrictEqual(ERREUR);
    expect((premier as { incident: string }).incident).not.toBe(
      (second as { incident: string }).incident,
    );
  });

  test("la transaction est annulée sur toute erreur du service", async () => {
    await executerQuiLeve(new Error("échec"));

    expect(etapes.at(-1)).toBe("annulation");
  });
});

describe("erreurs de contrôle de Next.js : relancées telles quelles", () => {
  function leveeDe(f: () => never): unknown {
    try {
      f();
    } catch (erreur) {
      return erreur;
    }
    throw new Error("aucune erreur levée");
  }

  test.each([
    ["redirect()", () => leveeDe(() => redirect("/connexion"))],
    ["notFound()", () => leveeDe(() => notFound())],
  ])("%s levé dans le service traverse la chaîne", async (_nom, fabriquer) => {
    const erreur = fabriquer();
    const { deps } = dependances();
    const decl = declaration({
      executer: async () => {
        throw erreur;
      },
    });

    await expect(creerChaine(deps).executerChaine(decl, requete(), {})).rejects.toBe(erreur);
    expect(espionErreur).not.toHaveBeenCalled();
  });
});

// Vérifié par npm run typecheck : chaque @ts-expect-error doit couvrir une
// erreur réelle, sinon la compilation échoue. Les fonctions ne sont jamais
// appelées.
describe("declarerAction : déclarations incomplètes refusées à la compilation", () => {
  const executer = async () => "fait";

  test("les cas ci-dessous ne compilent pas", () => {
    const cas = [
      () =>
        declarerAction({
          nom: "demo.droit_inconnu",
          // @ts-expect-error droit hors de la matrice
          droit: "inconnu",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer,
        }),
      () =>
        // @ts-expect-error entree absente
        declarerAction({
          nom: "demo.sans_entree",
          droit: "organisation.membres.voir",
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer,
        }),
      () =>
        // @ts-expect-error journal absent
        declarerAction({
          nom: "demo.sans_journal",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer,
        }),
      () =>
        declarerAction({
          nom: "demo.journal_inconnu",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          // @ts-expect-error action hors de la liste du journal
          journal: "facture.emise",
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer,
        }),
      () =>
        // @ts-expect-error nouvelleAuthentification absent
        declarerAction({
          nom: "demo.sans_nouvelle_authentification",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          debit: null,
          emails: [],
          executer,
        }),
      () =>
        declarerAction({
          nom: "demo.journaliser_sans_journal",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer: async (ctx) => {
            // @ts-expect-error ctx.journaliser n'existe que si journal est déclaré
            await ctx.journaliser({ ressourceId: randomUUID() });
            return "fait";
          },
        }),
    ];

    expect(cas).toHaveLength(6);
  });
});

// Zod 4 donne le même type à z.object et à z.strictObject ($strip et $strict
// ont la même forme) : la compilation ne peut pas refuser un schéma non
// strict. declarerAction le refuse donc à l'exécution (S-50).
describe("declarerAction : schéma d'entrée non strict refusé à l'exécution", () => {
  function declarer(entree: SchemaEntree) {
    return () =>
      declarerAction({
        nom: "demo.entree",
        droit: "organisation.membres.voir",
        entree,
        journal: null,
        nouvelleAuthentification: false,
        debit: null,
        emails: [],
        executer: async () => "fait",
      });
  }

  // Chaque cas vérifie d'abord que la forme stricte du même schéma est
  // acceptée : le refus porte bien sur le schéma non strict, pas sur la
  // déclaration.
  test.each([
    ["z.object", () => z.object({ nom: z.string() })],
    ["z.looseObject", () => z.looseObject({ nom: z.string() })],
    ["z.object().catchall()", () => z.object({ nom: z.string() }).catchall(z.unknown())],
  ])("%s : refusé, alors que z.strictObject est accepté", (_nom, schema) => {
    expect(declarer(z.strictObject({ nom: z.string() }))).not.toThrow();
    expect(declarer(schema() as unknown as SchemaEntree)).toThrow();
  });
});

// Noyau des lectures par les pages : étapes 2 à 6 de la section 5, sans
// contrôle d'origine ni entrée ni trace. Section 3.2, décision 9.
describe("etablirContexte", () => {
  function lecture(resultat: unknown = "lu") {
    return vi.fn<(ctx: ContexteLecture) => Promise<unknown>>(async () => {
      etapes.push("lecture");
      return resultat;
    });
  }

  test("succès : session, transaction de l'organisation active, adhésion, lecture", async () => {
    const { deps } = dependances();
    const lire = lecture();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "organisation.membres.voir",
      lire,
    );

    expect(resultat).toStrictEqual({ ok: true, donnees: "lu" });
    expect(etapes.slice(0, 4)).toEqual([
      "session",
      `transaction:${etat.session?.organisationActiveId}`,
      "adhesion",
      "lecture",
    ]);
  });

  test("contexte : utilisateur et organisation de la session, rôle de l'adhésion, transaction ; ni trace ni écriture au journal", async () => {
    etat.adhesion = { membreId: randomUUID(), role: "commercial" };
    const { deps, journaliser } = dependances();
    let recu: ContexteLecture | undefined;

    await creerChaine(deps).etablirContexte(requete(), "clients.voir", async (ctx) => {
      recu = ctx;
      return "lu";
    });

    expect(recu).toMatchObject({
      utilisateurId: etat.session?.utilisateurId,
      organisationId: etat.session?.organisationActiveId,
      role: "commercial",
      perimetre: "portefeuille",
    });
    expect(recu?.tx).toBe(tx);
    expect(recu).not.toHaveProperty("journaliser");
    expect(journaliser).not.toHaveBeenCalled();
  });

  // Une page s'ouvre aussi par un lien venu d'un autre site : navigation de
  // premier niveau, sans Origin ou avec Sec-Fetch-Site: cross-site.
  test.each([
    ["Origin absente", {}],
    ["Origin d'un autre site", { origin: "https://autre.exemple" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])("sans contrôle d'origine : %s, lecture faite", async (_nom, entetes) => {
    const { deps } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(entetes),
      "organisation.membres.voir",
      lecture(),
    );

    expect(resultat).toStrictEqual({ ok: true, donnees: "lu" });
  });

  test("sans session : connexion_requise, sans transaction", async () => {
    etat.session = null;
    const { deps, executerDansOrganisation } = dependances();
    const lire = lecture();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "organisation.membres.voir",
      lire,
    );

    expect(resultat).toStrictEqual(CONNEXION);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
    expect(lire).not.toHaveBeenCalled();
  });

  test.each([
    ["absente", null],
    ["pas un UUID", "organisation-a"],
  ])("organisation active %s : refuse, sans transaction", async (_nom, organisationActiveId) => {
    etat.session = { ...sessionValide(), organisationActiveId };
    const { deps, executerDansOrganisation } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "organisation.membres.voir",
      lecture(),
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(executerDansOrganisation).not.toHaveBeenCalled();
  });

  test.each([
    ["adhésion absente", null, "organisation.membres.voir"],
    ["rôle owner", "owner", "organisation.membres.voir"],
    ["rôle multiple", "lecteur,proprietaire", "organisation.membres.voir"],
    ["lecteur sur le journal d'audit", "lecteur", "journal.consulter"],
    ["commercial sur l'export complet", "commercial", "exports.complet"],
  ] as const)("%s : refuse, lecture non faite", async (_nom, role, droit) => {
    etat.adhesion = role === null ? null : { membreId: randomUUID(), role };
    const { deps } = dependances();
    const lire = lecture();

    const resultat = await creerChaine(deps).etablirContexte(requete(), droit, lire);

    expect(resultat).toStrictEqual(REFUS);
    expect(lire).not.toHaveBeenCalled();
  });

  test("ctx.introuvable() : refuse, rien au journal technique", async () => {
    const { deps } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "organisation.membres.voir",
      async (ctx) => ctx.introuvable(),
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(espionErreur).not.toHaveBeenCalled();
  });

  test("PostgreSQL 42501 : refuse", async () => {
    const { deps } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "organisation.membres.voir",
      async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    );

    expect(resultat).toStrictEqual(REFUS);
  });

  test("erreur inattendue : erreur avec incident ; journal technique avec le droit et la classe, sans message ni cause", async () => {
    const { deps } = dependances();

    const resultat = await creerChaine(deps).etablirContexte(
      requete(),
      "clients.voir",
      async () => {
        throw new TypeError("MESSAGE-SECRET", { cause: new Error("CAUSE-SECRETE") });
      },
    );

    expect(resultat).toStrictEqual(ERREUR);
    const journal = journalTechnique();
    expect(journal).toContain("clients.voir");
    expect(journal).toContain("TypeError");
    expect(journal).toContain((resultat as { incident: string }).incident);
    expect(journal).not.toContain("MESSAGE-SECRET");
    expect(journal).not.toContain("CAUSE-SECRETE");
  });

  test.each([
    ["redirect()", () => redirect("/connexion")],
    ["notFound()", () => notFound()],
  ])("%s levé par la lecture : relancé tel quel", async (_nom, lever) => {
    let erreur: unknown;
    try {
      lever();
    } catch (levee) {
      erreur = levee;
    }
    const { deps } = dependances();

    await expect(
      creerChaine(deps).etablirContexte(requete(), "organisation.membres.voir", async () => {
        throw erreur;
      }),
    ).rejects.toBe(erreur);
  });

  test("ctx.journaliser n'existe pas dans le contexte d'une lecture (compilation)", () => {
    const lire = async (ctx: ContexteLecture) => {
      // @ts-expect-error une lecture n'écrit pas au journal
      await ctx.journaliser({ ressourceId: randomUUID() });
    };

    expect(typeof lire).toBe("function");
  });

  test("droit hors de la matrice : refusé à la compilation", () => {
    const appeler = () =>
      // @ts-expect-error droit inconnu
      creerChaine(dependances().deps).etablirContexte(requete(), "inconnu", lecture());

    expect(typeof appeler).toBe("function");
  });
});
