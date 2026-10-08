import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import { creerAcces, OrganisationActiveInvalide } from "./client";

// Test sans base : la validation de l'identifiant a lieu avant toute
// connexion. env est remplacé par une valeur factice, pour que client.ts se
// charge sans .env.local. Fiche : docs/features/acces-donnees.md, section 1.4.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
  },
}));

const MESSAGE = "Identifiant d'organisation active invalide.";

const uuid = randomUUID();

const INVALIDES: [string, unknown][] = [
  ["chaîne vide", ""],
  ["texte quelconque", "organisation-a"],
  ["nombre", 42],
  ["undefined", undefined],
  ["null", null],
  ["UUID entouré d'espaces", ` ${uuid} `],
  ["UUID en majuscules entouré d'espaces", ` ${uuid.toUpperCase()} `],
  ["UUID hors des variantes de la RFC 9562", "11111111-1111-1111-1111-111111111111"],
  ["injection", "00000000-0000-4000-8000-000000000000' OR '1'='1"],
];

function poolFactice() {
  const connect = vi.fn();
  const query = vi.fn();
  const pool = { connect, query } as unknown as Pool;
  return { pool, connect, query };
}

describe("executerDansOrganisation : identifiant invalide", () => {
  test.each(INVALIDES)(
    "%s : OrganisationActiveInvalide, travail jamais appelé",
    async (_nom, valeur) => {
      const { pool } = poolFactice();
      const travail = vi.fn(async () => "jamais");

      const promesse = creerAcces(pool).executerDansOrganisation(valeur as string, travail);

      await expect(promesse).rejects.toBeInstanceOf(OrganisationActiveInvalide);
      expect(travail).not.toHaveBeenCalled();
    },
  );

  test.each(INVALIDES)("%s : aucune connexion demandée au Pool", async (_nom, valeur) => {
    const { pool, connect, query } = poolFactice();

    await creerAcces(pool)
      .executerDansOrganisation(valeur as string, async () => "jamais")
      .catch(() => undefined);

    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test.each(INVALIDES)(
    "%s : message fixe, sans la valeur ni cause (S-54)",
    async (_nom, valeur) => {
      const { pool } = poolFactice();

      const erreur = await creerAcces(pool)
        .executerDansOrganisation(valeur as string, async () => "jamais")
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(erreur).toBeInstanceOf(OrganisationActiveInvalide);
      const e = erreur as Error;
      expect(e.message).toBe(MESSAGE);
      expect(Object.hasOwn(e, "cause")).toBe(false);
      if (typeof valeur === "string" && valeur.trim() !== "") {
        expect(e.message).not.toContain(valeur.trim());
        expect(String(e)).not.toContain(valeur.trim());
        expect(JSON.stringify(e)).not.toContain(valeur.trim());
      }
    },
  );
});
