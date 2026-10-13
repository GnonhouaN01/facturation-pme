import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { secretValide } from "./secret";

// Comparaison de l'en-tête Authorization avec « Bearer <CRON_SECRET> », en
// temps constant : deux empreintes SHA-256 de 32 octets comparées par
// timingSafeEqual, calcul fait même quand le secret n'est pas configuré.
// Fiche : docs/features/tache-quotidienne.md, section 2.2, test 1.

const comparer = vi.hoisted(() => ({ appels: [] as [number, number][] }));

vi.mock("node:crypto", async (importOriginal) => {
  const reel = await importOriginal<typeof import("node:crypto")>();
  return {
    ...reel,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      comparer.appels.push([a.byteLength, b.byteLength]);
      return reel.timingSafeEqual(a, b);
    },
  };
});

const SECRET = randomBytes(32).toString("base64url");

beforeEach(() => {
  comparer.appels.length = 0;
});

describe("secretValide", () => {
  test("Bearer suivi du secret exact : accepté", () => {
    expect(secretValide(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  const DERNIER = SECRET.at(-1) === "A" ? "B" : "A";

  test.each([
    ["en-tête absent", null],
    ["en-tête vide", ""],
    ["Bearer seul", "Bearer"],
    ["Bearer et une espace", "Bearer "],
    ["schéma en minuscules", `bearer ${SECRET}`],
    ["deux espaces", `Bearer  ${SECRET}`],
    ["espace finale", `Bearer ${SECRET} `],
    ["secret sans Bearer", SECRET],
    ["préfixe du secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["secret suivi d'un caractère", `Bearer ${SECRET}A`],
    ["même longueur, dernier caractère différent", `Bearer ${SECRET.slice(0, -1)}${DERNIER}`],
    ["en-tête de 64 Kio", `Bearer ${"A".repeat(64 * 1024)}`],
    ["autre schéma", `Basic ${SECRET}`],
  ])("%s : refusé, sans exception", (_nom, entete) => {
    expect(secretValide(entete, SECRET)).toBe(false);
  });

  test.each([
    ["Bearer et une espace", "Bearer "],
    ["Bearer null", "Bearer null"],
    ["Bearer undefined", "Bearer undefined"],
    ["en-tête absent", null],
    ["secret quelconque", `Bearer ${randomBytes(32).toString("base64url")}`],
  ])("secret non configuré, %s : refusé", (_nom, entete) => {
    expect(secretValide(entete, null)).toBe(false);
  });

  test.each([
    ["secret configuré, en-tête juste", `Bearer ${SECRET}`, SECRET],
    ["secret configuré, en-tête de 64 Kio", `Bearer ${"A".repeat(64 * 1024)}`, SECRET],
    ["secret configuré, en-tête absent", null, SECRET],
    ["secret non configuré", "Bearer ", null],
    ["secret non configuré, en-tête absent", null, null],
  ])(
    "%s : un seul appel de timingSafeEqual, sur deux empreintes de 32 octets",
    (_nom, entete, secret) => {
      secretValide(entete, secret);

      expect(comparer.appels).toEqual([[32, 32]]);
    },
  );
});
