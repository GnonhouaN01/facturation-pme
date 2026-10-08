import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BaseDeDonnees, TransactionOrganisation } from "../db/client";
import { insererEntreeJournal } from "../db/requetes/journal";

import { EntreeJournalInvalide, journaliser, type EntreeJournal } from "./audit";

// Test sans base : la validation précède toute requête. L'insertion est
// remplacée par un espion ; aucun module de la base n'est chargé (client.ts
// n'est importé que pour ses types). Fiche : docs/features/journal-audit.md,
// sections 6 et 7.
vi.mock("../db/requetes/journal", () => ({ insererEntreeJournal: vi.fn(async () => undefined) }));

const inserer = vi.mocked(insererEntreeJournal);

const MESSAGE = "Entrée du journal d'audit invalide.";

// Transaction factice : la validation ne doit jamais s'en servir.
const tx = {} as TransactionOrganisation;

const RESSOURCES: Record<string, string> = {
  "organisation.parametres_modifies": "organisation",
  "organisation.instructions_paiement_modifiees": "organisation",
  "organisation.visibilite_modifiee": "organisation",
  "organisation.suppression_demandee": "organisation",
  "organisation.suppression_annulee": "organisation",
  "invitation.creee": "invitation",
  "invitation.revoquee": "invitation",
  "membre.ajoute": "membre",
  "membre.role_modifie": "membre",
  "membre.retire": "membre",
  "membre.parti": "membre",
};

function entreeValide(): EntreeJournal {
  return { action: "membre.ajoute", auteurId: randomUUID(), ressourceId: randomUUID() };
}

// Promesse refusée par EntreeJournalInvalide, sans insertion.
async function exigerRefus(entree: unknown): Promise<void> {
  await expect(journaliser(tx, entree as EntreeJournal)).rejects.toBeInstanceOf(
    EntreeJournalInvalide,
  );
  expect(inserer).not.toHaveBeenCalled();
}

beforeEach(() => {
  inserer.mockClear();
});

describe("journaliser : entrée valide", () => {
  test.each(Object.entries(RESSOURCES))(
    "%s : une insertion, type de ressource %s lu dans la liste, sans organisation ni horodatage",
    async (action, ressource) => {
      const auteurId = randomUUID();
      const ressourceId = randomUUID();

      await journaliser(tx, { action, auteurId, ressourceId });

      expect(inserer).toHaveBeenCalledTimes(1);
      // Égalité stricte de l'objet : aucune clé de plus (organisation,
      // horodatage) n'est transmise à l'insertion.
      expect(inserer).toHaveBeenCalledWith(tx, {
        action,
        typeRessource: ressource,
        auteurId,
        ressourceId,
        details: {},
      });
    },
  );
});

describe("journaliser : action hors de la liste", () => {
  test.each([
    ["action reportée à sa fonctionnalité", "facture.emise"],
    ["action reportée à sa fonctionnalité", "export.complet"],
    ["chaîne vide", ""],
    ["casse différente", "Membre.ajoute"],
    ["espace", "membre.ajoute "],
    ["injection", "membre.ajoute'; DROP TABLE journal_audit; --"],
    ["nombre", 1],
    ["absente", undefined],
  ])("%s (%s) : refus, aucune insertion", async (_nom, action) => {
    await exigerRefus({ ...entreeValide(), action });
  });
});

describe("journaliser : clé supplémentaire", () => {
  test.each([
    ["organisationId", randomUUID()],
    ["organisation_id", randomUUID()],
    ["typeRessource", "facture"],
    ["creeLe", new Date().toISOString()],
    ["id", randomUUID()],
  ])("%s : refus, aucune insertion", async (cle, valeur) => {
    await exigerRefus({ ...entreeValide(), [cle]: valeur });
  });
});

describe("journaliser : identifiants invalides", () => {
  const uuid = randomUUID();
  const INVALIDES: [string, unknown][] = [
    ["chaîne vide", ""],
    ["texte quelconque", "auteur-a"],
    ["UUID entouré d'espaces", ` ${uuid} `],
    ["injection", "00000000-0000-4000-8000-000000000000' OR '1'='1"],
    ["nombre", 42],
    ["null", null],
    ["absent", undefined],
  ];

  test.each(INVALIDES)("auteurId, %s : refus", async (_nom, auteurId) => {
    await exigerRefus({ ...entreeValide(), auteurId });
  });

  test.each(INVALIDES)("ressourceId, %s : refus", async (_nom, ressourceId) => {
    await exigerRefus({ ...entreeValide(), ressourceId });
  });
});

describe("journaliser : détails", () => {
  test.each([
    ["email", { email: "personne@exemple.invalid" }],
    ["nom", { nom: "Kouassi Aya" }],
    ["telephone", { telephone: "+225 07 00 00 00 00" }],
    ["motif", { motif: "texte libre" }],
    ["identifiant non prévu", { clientId: randomUUID() }],
  ])("clé inconnue (%s) : refus", async (_nom, details) => {
    await exigerRefus({ ...entreeValide(), details });
  });

  test.each([
    ["tableau", []],
    ["chaîne", "détails"],
    ["nombre", 1],
    ["null", null],
  ])("détails qui ne sont pas un objet (%s) : refus", async (_nom, details) => {
    await exigerRefus({ ...entreeValide(), details });
  });
});

describe("EntreeJournalInvalide : rien de la valeur reçue (S-54)", () => {
  test("message fixe, sans valeur reçue ni cause", async () => {
    const secret = "personne@exemple.invalid";
    let erreur: unknown;
    try {
      await journaliser(tx, { ...entreeValide(), details: { email: secret } });
    } catch (e) {
      erreur = e;
    }

    expect(erreur).toBeInstanceOf(EntreeJournalInvalide);
    const e = erreur as Error;
    expect(e.message).toBe(MESSAGE);
    expect(String(e)).not.toContain(secret);
    expect(JSON.stringify(e)).not.toContain(secret);
    expect("cause" in e).toBe(false);
  });
});

// Vérification de type, jamais exécutée : db, qui n'a pas d'organisation
// active, n'est pas une TransactionOrganisation. Vérifié par npm run typecheck.
export function _db_refuse_par_le_type(base: BaseDeDonnees): Promise<void> {
  // @ts-expect-error db n'a pas d'organisation active : journaliser exige la transaction.
  return journaliser(base, entreeValide());
}
