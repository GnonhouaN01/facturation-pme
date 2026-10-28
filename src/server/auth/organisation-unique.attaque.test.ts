import { afterEach, describe, expect, test, vi } from "vitest";

import { creerRappelSessionCreee } from "./organisation-unique";

// Décision 1 du développeur (2026-10-28) : un membre d'une seule
// organisation l'a pour organisation active dès la création de sa session.
// Rappel databaseHooks.session.create.before de Better Auth. Fiche :
// docs/features/parametres-organisation.md, section 9, test 7.

const UTILISATEUR = "4b8c5f0e-2a1d-4e3f-9b7a-6c5d4e3f2a1b";
const ORG_A = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const ORG_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("organisation unique active à la création de la session", () => {
  test("une adhésion : l'organisation devient active, lue pour l'utilisateur de la session", async () => {
    const lire = vi.fn(async () => [{ organisationId: ORG_A, role: "proprietaire" }]);
    const rappel = creerRappelSessionCreee(lire);

    const resultat = await rappel({ userId: UTILISATEUR, activeOrganizationId: null });

    expect(resultat).toEqual({ data: { activeOrganizationId: ORG_A } });
    expect(lire).toHaveBeenCalledWith(UTILISATEUR);
  });

  test.each([
    ["aucune adhésion", []],
    [
      "deux adhésions",
      [
        { organisationId: ORG_A, role: "proprietaire" },
        { organisationId: ORG_B, role: "lecteur" },
      ],
    ],
    ["rôle hors des quatre", [{ organisationId: ORG_A, role: "owner" }]],
    ["identifiant mal formé", [{ organisationId: "pas-un-uuid", role: "lecteur" }]],
  ])("%s : rien", async (_nom, adhesions) => {
    const rappel = creerRappelSessionCreee(async () => adhesions);

    expect(await rappel({ userId: UTILISATEUR })).toBeUndefined();
  });

  test("session qui a déjà une organisation active (recopiée) : inchangée, aucune lecture", async () => {
    const lire = vi.fn(async () => [{ organisationId: ORG_A, role: "proprietaire" }]);
    const rappel = creerRappelSessionCreee(lire);

    expect(await rappel({ userId: UTILISATEUR, activeOrganizationId: ORG_B })).toBeUndefined();
    expect(lire).not.toHaveBeenCalled();
  });

  test("lecture en panne : session créée sans organisation, ligne fixe sans identifiant", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rappel = creerRappelSessionCreee(async () => {
      throw new Error(`connexion refusée pour ${UTILISATEUR} vers ${ORG_A}`);
    });

    expect(await rappel({ userId: UTILISATEUR })).toBeUndefined();
    expect(journal).toHaveBeenCalledTimes(1);
    const ecrit = JSON.stringify(journal.mock.calls);
    expect(ecrit).not.toContain(UTILISATEUR);
    expect(ecrit).not.toContain(ORG_A);
    expect(ecrit).not.toContain("connexion refusée");
  });

  test("utilisateur absent de la session : rien, aucune lecture", async () => {
    const lire = vi.fn(async () => []);
    const rappel = creerRappelSessionCreee(lire);

    expect(await rappel({ userId: "" })).toBeUndefined();
    expect(lire).not.toHaveBeenCalled();
  });
});
