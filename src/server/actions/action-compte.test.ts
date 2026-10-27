import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import type { TransactionOrganisation } from "../db/client";

import {
  creerChaineCompte,
  declarerAction,
  declarerActionCompte,
  estDeclaration,
  estDeclarationCompte,
  type AdhesionLue,
  type DeclarationCompte,
  type DependancesChaineCompte,
  type SessionLue,
} from "./action";

// La chaîne « portée compte » (2.1), sans base ni Next.js : dépendances
// factices et espionnes. Fiche : docs/features/organisations.md, section 3.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  configurationEmail: { estProduction: false },
}));

const ORIGINE = "https://facturation.exemple.ci";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFUS = { ok: false, raison: "refuse" } as const;
const NOUVELLE = "0f1e2d3c-4b5a-4968-8776-655443322110";
const CIBLE = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const tx = { transactionFactice: true } as unknown as TransactionOrganisation;

const SCHEMA_CREATION = z.strictObject({ nom: z.string().min(1) });
const SCHEMA_ADHESION = z.strictObject({ organisationId: z.uuid() });

type Etat = { session: SessionLue | null; adhesion: AdhesionLue | null; debit: boolean };
let etat: Etat;
let etapes: string[];

function session(): SessionLue {
  return {
    utilisateurId: randomUUID(),
    sessionId: randomUUID(),
    organisationActiveId: null,
    doubleAuthentification: false,
  };
}

function dependances(surcharges: Partial<DependancesChaineCompte> = {}) {
  const journaliser = vi.fn(async () => {
    etapes.push("journal");
  });
  const deps: DependancesChaineCompte = {
    origineAttendue: ORIGINE,
    comptesOuverts: true,
    nouvelIdentifiant: () => NOUVELLE,
    lireSession: async () => {
      etapes.push("session");
      return etat.session;
    },
    verifierDebit: async (nom) => {
      etapes.push(`debit:${nom}`);
      return etat.debit;
    },
    executerDansOrganisation: (async <T>(
      organisationId: string,
      travail: (t: TransactionOrganisation) => Promise<T>,
    ) => {
      etapes.push(`transaction:${organisationId}`);
      try {
        const resultat = await travail(tx);
        etapes.push("validation");
        return resultat;
      } catch (erreur) {
        etapes.push("annulation");
        throw erreur;
      }
    }) as DependancesChaineCompte["executerDansOrganisation"],
    lireAdhesion: async () => {
      etapes.push("adhesion");
      return etat.adhesion;
    },
    journaliser,
    ...surcharges,
  };
  return { deps, journaliser };
}

function requete(entetes: Record<string, string> = { origin: ORIGINE }) {
  return { entetes: new Headers(entetes) };
}

function creation(
  surcharges: Partial<DeclarationCompte<typeof SCHEMA_CREATION, null, unknown>> = {},
) {
  return declarerActionCompte({
    nom: "demo.creation",
    entree: SCHEMA_CREATION,
    cible: "nouvelle_organisation",
    journal: null,
    debit: "organisation.creation",
    executer: async (ctx) => {
      etapes.push("service");
      return { organisationId: ctx.organisationId, role: ctx.role };
    },
    ...surcharges,
  });
}

function adhesion() {
  return declarerActionCompte({
    nom: "demo.adhesion",
    entree: SCHEMA_ADHESION,
    cible: "adhesion",
    journal: null,
    debit: "membre.action",
    executer: async (ctx) => {
      etapes.push("service");
      return { organisationId: ctx.organisationId, role: ctx.role };
    },
  });
}

beforeEach(() => {
  etat = {
    session: session(),
    adhesion: { membreId: randomUUID(), role: "comptable" },
    debit: true,
  };
  etapes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("déclaration d'une action de compte", () => {
  test("marquée, distincte d'une action d'organisation", () => {
    const declaration = creation();
    expect(estDeclarationCompte(declaration)).toBe(true);
    expect(estDeclaration(declaration)).toBe(false);
    expect(estDeclarationCompte({ ...declaration })).toBe(false);
    const organisation = declarerAction({
      nom: "demo.organisation",
      droit: "organisation.membres.voir",
      entree: z.strictObject({}),
      journal: null,
      nouvelleAuthentification: false,
      debit: null,
      emails: [],
      executer: async () => null,
    });
    expect(estDeclarationCompte(organisation)).toBe(false);
  });

  test.each([
    ["schéma non strict", { entree: z.object({ nom: z.string() }) }],
    ["cible inconnue", { cible: "organisation" }],
    ["journal inconnu", { journal: "organisation.inventee" }],
    ["limite absente", { debit: undefined }],
    ["limite inconnue", { debit: "inventee" }],
    ["limite d'une autre portée", { debit: "email.application" }],
    ["nom vide", { nom: "" }],
  ])("refusée : %s", (_cas, surcharge) => {
    expect(() => creation(surcharge as never)).toThrow(/Déclaration d'action invalide/);
  });

  test("cible adhesion : organisationId en z.uuid() exigé dans le schéma", () => {
    expect(() =>
      declarerActionCompte({
        nom: "demo.adhesion_sans_identifiant",
        entree: z.strictObject({ autre: z.string() }),
        cible: "adhesion",
        journal: null,
        debit: null,
        executer: async () => null,
      }),
    ).toThrow(/Déclaration d'action invalide/);
    expect(() =>
      declarerActionCompte({
        nom: "demo.adhesion_texte",
        entree: z.strictObject({ organisationId: z.string() }),
        cible: "adhesion",
        journal: null,
        debit: null,
        executer: async () => null,
      }),
    ).toThrow(/Déclaration d'action invalide/);
  });
});

describe("ordre des contrôles", () => {
  test("nouvelle organisation : session, débit, transaction de l'identifiant tiré, service", async () => {
    const { deps } = dependances();
    const resultat = await creerChaineCompte(deps).executerChaineCompte(creation(), requete(), {
      nom: "Kouamé",
    });
    expect(resultat).toEqual({ ok: true, donnees: { organisationId: NOUVELLE, role: null } });
    expect(etapes).toEqual([
      "session",
      "debit:organisation.creation",
      `transaction:${NOUVELLE}`,
      "service",
      "validation",
    ]);
  });

  test("adhésion : transaction de l'organisation demandée, adhésion avant le service", async () => {
    const { deps } = dependances();
    const resultat = await creerChaineCompte(deps).executerChaineCompte(adhesion(), requete(), {
      organisationId: CIBLE,
    });
    expect(resultat).toEqual({ ok: true, donnees: { organisationId: CIBLE, role: "comptable" } });
    expect(etapes).toEqual([
      "session",
      "debit:membre.action",
      `transaction:${CIBLE}`,
      "adhesion",
      "service",
      "validation",
    ]);
  });
});

describe("refus", () => {
  test("origine étrangère ou absente : refuse, sans lire la session", async () => {
    const { deps } = dependances();
    const chaine = creerChaineCompte(deps);
    for (const entetes of [{ origin: "https://autre.exemple" }, {}] as Record<string, string>[]) {
      expect(await chaine.executerChaineCompte(creation(), requete(entetes), { nom: "A" })).toEqual(
        REFUS,
      );
    }
    expect(etapes).toEqual([]);
  });

  test("sans session : connexion_requise", async () => {
    etat.session = null;
    const { deps } = dependances();
    expect(
      await creerChaineCompte(deps).executerChaineCompte(creation(), requete(), { nom: "A" }),
    ).toEqual({ ok: false, raison: "connexion_requise" });
    expect(etapes).toEqual(["session"]);
  });

  test("comptes fermés (production) : refuse, sans débit ni transaction", async () => {
    const { deps } = dependances({ comptesOuverts: false });
    expect(
      await creerChaineCompte(deps).executerChaineCompte(creation(), requete(), { nom: "A" }),
    ).toEqual(REFUS);
    expect(etapes).toEqual(["session"]);
  });

  test("limite atteinte : trop_de_requetes, sans transaction", async () => {
    etat.debit = false;
    const { deps } = dependances();
    expect(
      await creerChaineCompte(deps).executerChaineCompte(creation(), requete(), { nom: "A" }),
    ).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(etapes).toEqual(["session", "debit:organisation.creation"]);
  });

  test("entrée invalide : champs seulement, sans transaction ; un identifiant fourni est refusé", async () => {
    const { deps } = dependances();
    const chaine = creerChaineCompte(deps);
    expect(await chaine.executerChaineCompte(creation(), requete(), { nom: "" })).toEqual({
      ok: false,
      raison: "invalide",
      champs: ["nom"],
    });
    const resultat = await chaine.executerChaineCompte(creation(), requete(), {
      nom: "A",
      organisationId: CIBLE,
    });
    expect(resultat.ok).toBe(false);
    expect(!resultat.ok && resultat.raison).toBe("invalide");
    expect(etapes.some((etape) => etape.startsWith("transaction"))).toBe(false);
  });

  test("adhésion absente ou rôle inconnu : refuse, transaction annulée, service jamais appelé", async () => {
    const { deps } = dependances();
    const chaine = creerChaineCompte(deps);
    for (const lue of [null, { membreId: randomUUID(), role: "owner" }]) {
      etat.adhesion = lue;
      etapes = [];
      expect(
        await chaine.executerChaineCompte(adhesion(), requete(), { organisationId: CIBLE }),
      ).toEqual(REFUS);
      expect(etapes).toContain("annulation");
      expect(etapes).not.toContain("service");
    }
  });

  test("introuvable() du service : refuse", async () => {
    const { deps } = dependances();
    const declaration = creation({ executer: async (ctx) => ctx.introuvable() });
    expect(
      await creerChaineCompte(deps).executerChaineCompte(declaration, requete(), { nom: "A" }),
    ).toEqual(REFUS);
  });
});

describe("trace", () => {
  function tracee(ecrire: boolean) {
    return declarerActionCompte({
      nom: "demo.creation_tracee",
      entree: SCHEMA_CREATION,
      cible: "nouvelle_organisation",
      journal: "organisation.creee",
      debit: null,
      executer: async (ctx) => {
        if (ecrire) await ctx.journaliser({ ressourceId: ctx.organisationId });
        return null;
      },
    });
  }

  test("écrite avec l'action déclarée et l'auteur de la session", async () => {
    const { deps, journaliser } = dependances();
    const resultat = await creerChaineCompte(deps).executerChaineCompte(tracee(true), requete(), {
      nom: "A",
    });
    expect(resultat.ok).toBe(true);
    expect(journaliser).toHaveBeenCalledWith(tx, {
      action: "organisation.creee",
      auteurId: etat.session?.utilisateurId,
      ressourceId: NOUVELLE,
    });
  });

  test("déclarée et non écrite : erreur, transaction annulée", async () => {
    const { deps } = dependances();
    const resultat = await creerChaineCompte(deps).executerChaineCompte(tracee(false), requete(), {
      nom: "A",
    });
    expect(resultat).toEqual({
      ok: false,
      raison: "erreur",
      incident: expect.stringMatching(UUID),
    });
    expect(etapes).toContain("annulation");
  });
});
