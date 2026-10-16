import { randomBytes } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { POINTS_ENTREE_OUVERTS } from "../auth/points-entree";
import type { Compteur } from "../db/debit";

import { CHEMINS_LIMITES, creerStockageBetterAuth, reglesBetterAuth } from "./better-auth";
import { LIMITES, type NomLimite } from "./limites";

// Le stockage de la limitation de Better Auth, branché sur notre compteur
// (option B3 de la 0.5) : clé en empreinte, règles tirées de LIMITES, règle
// inconnue refusée. Compteur factice : aucune base. Fiche :
// docs/features/inscription.md, section 3.

// env.ts n'est pas chargé ici : le stockage lié (stockageBetterAuth) vit dans
// le même module, avec une clé dérivée de BETTER_AUTH_SECRET.
vi.mock("../env", () => ({
  env: { BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres" },
}));
vi.mock("../db/debit", () => ({
  compteur: { consommer: async () => 1, purger: async () => 0 },
}));

function compteurFactice(comptes: number[] = []) {
  const appels: { cle: string; regle: { maximum: number; fenetreSecondes: number } }[] = [];
  let i = 0;
  const compteur: Compteur = {
    consommer: async (cle, regle) => {
      appels.push({ cle, regle });
      return comptes[i++] ?? 1;
    },
    purger: async () => 0,
  };
  return { compteur, appels };
}

function regle(nom: NomLimite) {
  return { window: LIMITES[nom].fenetreSecondes, max: LIMITES[nom].maximum };
}

const CLE_BETTER_AUTH = "203.0.113.7|/sign-up/email";

describe("reglesBetterAuth : règles par chemin, tirées de LIMITES", () => {
  // Modifié en 1.2 : cinq chemins ouverts au lieu de trois
  // (docs/features/connexion.md, section 3, test 11).
  test("les cinq chemins ouverts, chacun avec sa limite", () => {
    expect(CHEMINS_LIMITES).toEqual({
      "/sign-up/email": "auth.inscription",
      "/send-verification-email": "auth.renvoi_verification",
      "/verify-email": "auth.verification",
      "/sign-in/email": "auth.connexion",
      "/sign-out": "auth.deconnexion",
    });
    expect(reglesBetterAuth()).toEqual({
      "/sign-up/email": regle("auth.inscription"),
      "/send-verification-email": regle("auth.renvoi_verification"),
      "/verify-email": regle("auth.verification"),
      "/sign-in/email": regle("auth.connexion"),
      "/sign-out": regle("auth.deconnexion"),
    });
  });

  test("les règles couvrent exactement les points d'entrée ouverts", () => {
    expect(Object.keys(reglesBetterAuth()).sort()).toEqual(
      Object.keys(POINTS_ENTREE_OUVERTS).sort(),
    );
  });

  test("chaque limite citée est par adresse IP et dure au plus 24 heures", () => {
    for (const nom of Object.values(CHEMINS_LIMITES)) {
      expect(LIMITES[nom].par).toBe("adresse_ip");
      expect(LIMITES[nom].fenetreSecondes).toBeLessThanOrEqual(24 * 60 * 60);
    }
  });
});

describe("stockage : consume", () => {
  test("la règle de la limite par compte (adresse email) n'est pas une règle de Better Auth : refusée sans compter", async () => {
    const { compteur, appels } = compteurFactice();
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });
    const resultat = await stockage.consume(CLE_BETTER_AUTH, regle("auth.connexion_compte"));
    expect(resultat).toEqual({ allowed: false, retryAfter: null });
    expect(appels).toEqual([]);
  });

  test("la règle de la connexion (auth.connexion) est connue et comptée", async () => {
    const { compteur, appels } = compteurFactice([1]);
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });
    const resultat = await stockage.consume("203.0.113.7|/sign-in/email", regle("auth.connexion"));
    expect(resultat).toEqual({ allowed: true, retryAfter: null });
    expect(appels[0]?.cle).toMatch(/^auth\.connexion:/u);
  });

  test("la clé est l'empreinte, sous le nom de la limite ; l'adresse IP n'y paraît pas", async () => {
    const { compteur, appels } = compteurFactice();
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    await stockage.consume(CLE_BETTER_AUTH, regle("auth.inscription"));

    const cle = appels[0]?.cle ?? "";
    expect(cle).toMatch(/^auth\.inscription:[0-9a-f]{64}$/u);
    expect(cle).not.toContain("203.0.113.7");
    expect(cle).not.toContain("sign-up");
    expect(appels[0]?.regle).toEqual({
      maximum: LIMITES["auth.inscription"].maximum,
      fenetreSecondes: LIMITES["auth.inscription"].fenetreSecondes,
    });
  });

  test("deux adresses donnent deux clés ; une même adresse, la même clé", async () => {
    const { compteur, appels } = compteurFactice();
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    await stockage.consume("203.0.113.7|/sign-up/email", regle("auth.inscription"));
    await stockage.consume("203.0.113.8|/sign-up/email", regle("auth.inscription"));
    await stockage.consume("203.0.113.7|/sign-up/email", regle("auth.inscription"));

    expect(appels[0]?.cle).not.toBe(appels[1]?.cle);
    expect(appels[0]?.cle).toBe(appels[2]?.cle);
  });

  test("permis jusqu'au maximum, refusé au-delà ; retryAfter toujours nul", async () => {
    const max = LIMITES["auth.inscription"].maximum;
    const { compteur } = compteurFactice([max, max + 1]);
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    expect(await stockage.consume(CLE_BETTER_AUTH, regle("auth.inscription"))).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await stockage.consume(CLE_BETTER_AUTH, regle("auth.inscription"))).toEqual({
      allowed: false,
      retryAfter: null,
    });
  });

  test.each([
    ["règle spéciale par défaut de Better Auth (10 s, 3)", { window: 10, max: 3 }],
    ["règle spéciale par défaut de Better Auth (60 s, 3)", { window: 60, max: 3 }],
    ["règle par défaut de Better Auth (10 s, 100)", { window: 10, max: 100 }],
    // email.destinataire a la même règle (1 h, 3) que auth.renvoi_verification :
    // le cas prend une règle qu'aucune limite auth.* n'a.
    ["règle d'une limite qui n'est pas auth.*", regle("email.application")],
  ])("règle inconnue refusée sans compter : %s", async (_nom, inconnue) => {
    const { compteur, appels } = compteurFactice();
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    expect(await stockage.consume(CLE_BETTER_AUTH, inconnue)).toEqual({
      allowed: false,
      retryAfter: null,
    });
    expect(appels).toEqual([]);
  });

  test("la règle par défaut de l'application (auth.defaut) est connue", async () => {
    const { compteur, appels } = compteurFactice();
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    expect((await stockage.consume(CLE_BETTER_AUTH, regle("auth.defaut"))).allowed).toBe(true);
    expect(appels[0]?.cle).toMatch(/^auth\.defaut:/u);
  });

  test("erreur du compteur : propagée (refus fermé par défaut, section 6 de la 0.5)", async () => {
    const compteur: Compteur = {
      consommer: async () => {
        throw new Error("base injoignable");
      },
      purger: async () => 0,
    };
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });

    await expect(stockage.consume(CLE_BETTER_AUTH, regle("auth.inscription"))).rejects.toThrow();
  });
});
