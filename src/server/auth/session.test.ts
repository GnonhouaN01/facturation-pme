import { afterEach, describe, expect, test, vi } from "vitest";

import { lireSession } from "./session";

// Lecture de la session : un utilisateur dont l'adresse n'est pas vérifiée
// n'a pas de session (F-001). Better Auth est simulé : seule la règle est
// testée ici. Fiche : docs/features/inscription.md, section 4.6.

const getSession = vi.fn();

vi.mock("./config", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

function lue(emailVerified: unknown) {
  return {
    user: { id: "u1", email: "awa@exemple.invalid", emailVerified },
    session: { id: "s1", activeOrganizationId: "o1" },
  };
}

afterEach(() => {
  getSession.mockReset();
});

describe("lireSession", () => {
  test("adresse vérifiée : utilisateur et organisation active", async () => {
    getSession.mockResolvedValue(lue(true));
    expect(await lireSession(new Headers())).toEqual({
      utilisateurId: "u1",
      organisationActiveId: "o1",
    });
  });

  test.each([false, undefined, null, "true", 1])(
    "adresse non vérifiée (emailVerified = %j) : aucune session",
    async (valeur) => {
      getSession.mockResolvedValue(lue(valeur));
      expect(await lireSession(new Headers())).toBeNull();
    },
  );

  test("aucune session : null", async () => {
    getSession.mockResolvedValue(null);
    expect(await lireSession(new Headers())).toBeNull();
  });
});
