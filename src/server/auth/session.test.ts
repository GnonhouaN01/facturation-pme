import { afterEach, describe, expect, test, vi } from "vitest";

import { lireSession } from "./session";

// Lecture de la session : un utilisateur dont l'adresse n'est pas vérifiée
// n'a pas de session (F-001) ; l'état du second facteur est lu avec elle
// (étape 7 de la chaîne). Better Auth est simulé : seule la règle est testée
// ici. Fiches : docs/features/inscription.md, section 4.6 ;
// docs/features/double-authentification.md, section 9, test 30.

const getSession = vi.fn();

vi.mock("./config", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

function lue(emailVerified: unknown, twoFactorEnabled: unknown = false) {
  return {
    user: { id: "u1", email: "awa@exemple.invalid", emailVerified, twoFactorEnabled },
    session: { id: "s1", activeOrganizationId: "o1" },
  };
}

afterEach(() => {
  getSession.mockReset();
});

describe("lireSession", () => {
  test("adresse vérifiée : utilisateur et organisation active", async () => {
    getSession.mockResolvedValue(lue(true));
    expect(await lireSession(new Headers())).toStrictEqual({
      utilisateurId: "u1",
      sessionId: "s1",
      organisationActiveId: "o1",
      doubleAuthentification: false,
    });
  });

  test("second facteur actif : doubleAuthentification vrai", async () => {
    getSession.mockResolvedValue(lue(true, true));
    expect(await lireSession(new Headers())).toStrictEqual({
      utilisateurId: "u1",
      sessionId: "s1",
      organisationActiveId: "o1",
      doubleAuthentification: true,
    });
  });

  test.each([false, undefined, null, "true", 1, {}])(
    "twoFactorEnabled = %j : doubleAuthentification faux",
    async (valeur) => {
      getSession.mockResolvedValue(lue(true, valeur));
      expect((await lireSession(new Headers()))?.doubleAuthentification).toBe(false);
    },
  );

  test.each([false, undefined, null, "true", 1])(
    "adresse non vérifiée (emailVerified = %j) : aucune session",
    async (valeur) => {
      getSession.mockResolvedValue(lue(valeur));
      expect(await lireSession(new Headers())).toBeNull();
    },
  );

  // 1.5 : l'identifiant de la session de la requête, jamais son jeton
  // (docs/features/profil-sessions.md, section 3.1, test 11).
  test("sessionId : l'identifiant de la session, jamais le jeton", async () => {
    getSession.mockResolvedValue({
      ...lue(true),
      session: { id: "s1", token: "jeton-secret", activeOrganizationId: null },
    });
    const lu = await lireSession(new Headers());
    expect(lu?.sessionId).toBe("s1");
    expect(JSON.stringify(lu)).not.toContain("jeton-secret");
  });

  test("aucune session : null", async () => {
    getSession.mockResolvedValue(null);
    expect(await lireSession(new Headers())).toBeNull();
  });
});
