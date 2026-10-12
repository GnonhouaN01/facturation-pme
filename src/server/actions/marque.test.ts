import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { declarerAction, estDeclaration, type DeclarationAction } from "./action";

// La marque posée par declarerAction : seule une déclaration qu'il a renvoyée
// la porte. exposer et l'inventaire refusent toute autre déclaration. Fiche :
// docs/features/chaine-controles.md, section 7, « Déclarations marquées ».

// action.ts charge env.ts et client.ts : valeurs factices, aucune connexion
// n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const SCHEMA = z.strictObject({});

function champs(): DeclarationAction<typeof SCHEMA, null, string> {
  return {
    nom: "demo.marque",
    droit: "organisation.membres.voir",
    entree: SCHEMA,
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: [],
    executer: async () => "fait",
  };
}

describe("estDeclaration", () => {
  test("une déclaration renvoyée par declarerAction est marquée", () => {
    expect(estDeclaration(declarerAction(champs()))).toBe(true);
  });

  test("deux déclarations distinctes sont toutes deux marquées", () => {
    const premiere = declarerAction(champs());
    const seconde = declarerAction({ ...champs(), nom: "demo.marque_bis" });

    expect(estDeclaration(premiere)).toBe(true);
    expect(estDeclaration(seconde)).toBe(true);
  });

  test("les mêmes champs écrits à la main : non marqués", () => {
    expect(estDeclaration(champs())).toBe(false);
  });

  test.each([
    ["copie par décomposition", (d: object) => ({ ...d })],
    ["copie par Object.assign", (d: object) => Object.assign({}, d)],
    ["objet dont la déclaration est le prototype", (d: object) => Object.create(d) as object],
  ])("%s d'une déclaration marquée : non marquée", (_nom, copier) => {
    const marquee = declarerAction(champs());

    expect(estDeclaration(marquee)).toBe(true);
    expect(estDeclaration(copier(marquee))).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["chaîne", "demo.marque"],
    ["nombre", 42],
    ["fonction", async () => "fait"],
    ["objet vide", {}],
  ])("%s : non marqué", (_nom, valeur) => {
    expect(estDeclaration(valeur)).toBe(false);
  });

  test("la marque est un symbole privé, absent du registre global", () => {
    const marquee = declarerAction(champs());
    const symboles = Object.getOwnPropertySymbols(marquee);

    expect(symboles.length).toBeGreaterThan(0);
    for (const symbole of symboles) {
      expect(Symbol.keyFor(symbole)).toBeUndefined();
    }
  });

  test("la déclaration marquée reste figée", () => {
    expect(Object.isFrozen(declarerAction(champs()))).toBe(true);
  });
});
