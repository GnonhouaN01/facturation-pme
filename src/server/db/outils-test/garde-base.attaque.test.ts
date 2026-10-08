import { describe, expect, test, vi } from "vitest";

import { deciderBaseDeTest, type EtatBase } from "./garde-base";

// Test sans base de la décision du garde-fou : aucune base non marquée n'est
// nécessaire. client.ts est remplacé pour ne pas charger env.ts.
// Fiche : docs/features/acces-donnees.md, section 5. Menace : T-74.
vi.mock("../client", () => ({ db: {} }));

const ACCEPTE: EtatBase = {
  marque: "environnement:test",
  role: "app_facturation",
  contourne: false,
};

const RAISON_MARQUE = "la base visée n'est pas marquée comme base de test";
const RAISON_ROLE = "le rôle de connexion n'est pas app_facturation";
const RAISON_CONTOURNE = "le rôle de connexion contourne l'isolation";

function refus(etat: EtatBase): Error | null {
  try {
    deciderBaseDeTest(etat);
    return null;
  } catch (erreur) {
    return erreur as Error;
  }
}

describe("deciderBaseDeTest", () => {
  test("base marquée, rôle app_facturation, sans contournement : acceptée", () => {
    expect(() => deciderBaseDeTest(ACCEPTE)).not.toThrow();
  });

  test.each([
    ["absente", null],
    ["vide", ""],
    ["casse différente", "environnement:Test"],
    ["espace final", "environnement:test "],
    ["espace initial", " environnement:test"],
    ["production", "environnement:production"],
    ["preview", "environnement:preview"],
    ["ancienne forme", "test"],
    ["clé en majuscule", "Environnement:test"],
  ])("marque %s : refus", (_nom, marque) => {
    const erreur = refus({ ...ACCEPTE, marque });

    expect(erreur?.message).toBe(`Tests refusés : ${RAISON_MARQUE}.`);
  });

  test.each(["neondb_owner", "postgres", null])("rôle %s : refus", (role) => {
    const erreur = refus({ ...ACCEPTE, role });

    expect(erreur?.message).toBe(`Tests refusés : ${RAISON_ROLE}.`);
  });

  test.each([true, null])("contourne = %s : refus", (contourne) => {
    const erreur = refus({ ...ACCEPTE, contourne });

    expect(erreur?.message).toBe(`Tests refusés : ${RAISON_CONTOURNE}.`);
  });

  test("le message ne contient ni la marque lue ni le rôle lu (S-54)", () => {
    const marque = refus({ ...ACCEPTE, marque: "environnement:production" });
    const role = refus({ ...ACCEPTE, role: "neondb_owner" });

    expect(marque?.message).toMatch(/^Tests refusés : /);
    expect(marque?.message).not.toContain("production");
    expect(role?.message).toMatch(/^Tests refusés : /);
    expect(role?.message).not.toContain("neondb_owner");
  });
});
