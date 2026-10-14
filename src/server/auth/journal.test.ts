import { afterEach, describe, expect, test, vi } from "vitest";

import { consignerAuth, consignerIncidentAuth } from "./journal";

// Identifiant d'incident des réponses « erreur » de /api/auth (dette de
// PLAN.md, section 7) : la ligne [auth] écrite au journal technique et
// l'identifiant renvoyé au navigateur sont les mêmes. Fiche :
// docs/features/connexion.md, section 6, test 9.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function capturer() {
  const lignes: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
    lignes.push(valeurs.map(String).join(" "));
  });
  return lignes;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consignerIncidentAuth", () => {
  test("écrit une seule ligne [auth] de niveau error et rend son identifiant", () => {
    const lignes = capturer();
    const incident = consignerIncidentAuth();
    expect(incident).toMatch(UUID);
    expect(lignes).toEqual([`[auth] ${JSON.stringify({ niveau: "error", incident })}`]);
  });

  test("deux appels : deux identifiants", () => {
    capturer();
    expect(consignerIncidentAuth()).not.toBe(consignerIncidentAuth());
  });

  test("ne lit aucun argument : rien d'autre que le niveau et l'identifiant ne peut sortir", () => {
    expect(consignerIncidentAuth.length).toBe(0);
  });

  test("console défaillante : rend quand même un identifiant, sans lever", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console en panne");
    });
    expect(consignerIncidentAuth()).toMatch(UUID);
  });
});

describe("consignerAuth (journal de Better Auth) inchangé", () => {
  test("une ligne pour warn et error, rien pour info et debug", () => {
    const lignes = capturer();
    consignerAuth("info");
    consignerAuth("debug");
    consignerAuth("warn");
    consignerAuth("error");
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatch(/^\[auth\] \{"niveau":"warn","incident":"[0-9a-f-]{36}"\}$/u);
  });
});
