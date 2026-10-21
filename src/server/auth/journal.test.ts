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

  // Modifié le 2026-10-21 (fix(1.2)) : une 500 sans cause était
  // inexploitable. La cause est décrite, jamais le message de l'erreur ni ses
  // paramètres (T-39) : le point, les appels internes, la classe, le code SQL,
  // la contrainte et les emplacements de la pile.
  test("avec une cause : point, appels, classe, code SQL, contrainte et pile ; jamais le message", () => {
    const lignes = capturer();
    const base = Object.assign(new Error("duplicate key (jeton-secret-123) awa@exemple.invalid"), {
      name: "DatabaseError",
      code: "23505",
      constraint: "verification_pkey",
    });
    const erreur = new Error("Failed query: insert ... params: jeton-secret-123", { cause: base });
    erreur.name = "DrizzleQueryError";

    const incident = consignerIncidentAuth({
      point: "/two-factor/verify-totp",
      appels: [
        { chemin: "/two-factor/verify-totp", statut: 500, code: "FAILED_TO_CREATE_SESSION" },
      ],
      erreur,
    });

    expect(lignes).toHaveLength(1);
    const [prefixe, json] = [lignes[0]?.slice(0, 7), lignes[0]?.slice(7)];
    expect(prefixe).toBe("[auth] ");
    const lu = JSON.parse(json ?? "{}") as Record<string, unknown>;
    expect(lu).toMatchObject({
      niveau: "error",
      incident,
      point: "/two-factor/verify-totp",
      appels: [
        { chemin: "/two-factor/verify-totp", statut: 500, code: "FAILED_TO_CREATE_SESSION" },
      ],
      erreur: {
        classes: ["DrizzleQueryError", "DatabaseError"],
        code: "23505",
        contrainte: "verification_pkey",
      },
    });
    const pile = (lu.erreur as { pile: string[] }).pile;
    expect(pile.length).toBeGreaterThan(0);
    for (const cadre of pile) expect(cadre).toMatch(/^[A-Za-z0-9_@.\-/]+:\d+:\d+$/u);
    for (const interdit of [
      "jeton-secret-123",
      "awa@exemple.invalid",
      "Failed query",
      "duplicate key",
    ]) {
      expect(lignes[0]).not.toContain(interdit);
    }
  });

  test("valeurs hors forme : remplacées, jamais recopiées", () => {
    const lignes = capturer();
    const erreur = { name: "x y <script>", code: "pas un code", constraint: "Drop Table;" };
    consignerIncidentAuth({
      point: "/../etc?x=jeton-secret-123",
      appels: [
        { chemin: "/x?jeton=jeton-secret-123", statut: 500, code: "code avec jeton-secret-123" },
      ],
      erreur,
    });
    expect(lignes[0]).not.toContain("jeton-secret-123");
    expect(lignes[0]).not.toContain("<script>");
    expect(lignes[0]).not.toContain("Drop Table");
    const lu = JSON.parse(lignes[0]?.slice(7) ?? "{}") as Record<string, unknown>;
    expect(lu).toMatchObject({
      point: "autre",
      appels: [{ chemin: "autre", statut: 500, code: null }],
      erreur: { classes: ["object"], pile: [] },
    });
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
