import { afterEach, describe, expect, test, vi } from "vitest";

import { formaterDate, formaterJour } from "./dates";

// Format jour/mois/année de DESIGN-SYSTEM.md, fuseau fixé à Africa/Abidjan
// (UTC+0, sans heure d'été). Fiche : docs/features/socle-interface.md,
// section 11.3.
//
// La CI tourne en UTC, qui donne déjà le jour d'Abidjan : sans changer le
// fuseau du processus, aucun test ne distinguerait une implémentation qui
// oublie le fuseau. Node applique un changement de TZ en cours d'exécution.

afterEach(() => {
  vi.unstubAllEnvs();
});

function simulerPoste(fuseau: string) {
  vi.stubEnv("TZ", fuseau);
}

describe("précondition : le fuseau du processus change bien", () => {
  test("à UTC+14, 2026-10-05T20:00:00Z tombe le 6 en heure locale", () => {
    simulerPoste("Pacific/Kiritimati");
    expect(new Date("2026-10-05T20:00:00Z").getDate()).toBe(6);
  });

  test("à UTC-11, 2026-10-05 (minuit UTC) tombe le 4 en heure locale", () => {
    simulerPoste("Pacific/Pago_Pago");
    expect(new Date("2026-10-05").getDate()).toBe(4);
  });
});

describe("formaterDate : un instant, au jour d'Abidjan", () => {
  const CAS: ReadonlyArray<[string, string]> = [
    ["2026-10-05T20:00:00Z", "05/10/2026"],
    ["2026-10-05T23:59:59Z", "05/10/2026"],
    ["2026-10-06T00:00:00Z", "06/10/2026"],
    ["2026-10-05T00:00:00+05:30", "04/10/2026"],
    ["2026-01-01T00:00:00Z", "01/01/2026"],
    ["2025-12-31T23:59:59Z", "31/12/2025"],
  ];

  test.each(CAS)("%s donne %s sur un poste à UTC+14", (instant, attendu) => {
    simulerPoste("Pacific/Kiritimati");
    expect(formaterDate(new Date(instant))).toBe(attendu);
  });

  test.each(CAS)("%s donne %s sur un poste à UTC-11", (instant, attendu) => {
    simulerPoste("Pacific/Pago_Pago");
    expect(formaterDate(new Date(instant))).toBe(attendu);
  });

  test("une date invalide est refusée par RangeError", () => {
    expect(() => formaterDate(new Date("pas une date"))).toThrow(RangeError);
  });
});

describe("formaterJour : une date de calendrier, sans fuseau", () => {
  const VALIDES: ReadonlyArray<[string, string]> = [
    ["2026-10-05", "05/10/2026"],
    ["2026-01-01", "01/01/2026"],
    ["2026-12-31", "31/12/2026"],
    ["2024-02-29", "29/02/2024"],
    ["2000-02-29", "29/02/2000"],
  ];

  test.each(VALIDES)("%s donne %s sur un poste à UTC-11", (jour, attendu) => {
    simulerPoste("Pacific/Pago_Pago");
    expect(formaterJour(jour)).toBe(attendu);
  });

  test.each(VALIDES)("%s donne %s sur un poste à UTC+14", (jour, attendu) => {
    simulerPoste("Pacific/Kiritimati");
    expect(formaterJour(jour)).toBe(attendu);
  });

  test.each([
    ["un 29 février d'une année non bissextile", "2025-02-29"],
    ["un 29 février d'une année séculaire non bissextile", "1900-02-29"],
    ["un mois 13", "2026-13-01"],
    ["un mois 00", "2026-00-10"],
    ["un 31 avril", "2026-04-31"],
    ["un jour 00", "2026-10-00"],
    ["le format jour/mois/année", "05/10/2026"],
    ["un horodatage", "2026-10-05T00:00"],
    ["des chiffres manquants", "2026-1-5"],
    ["une chaîne vide", ""],
    ["une espace en tête", " 2026-10-05"],
    ["une espace en fin", "2026-10-05 "],
  ])("refuse %s par RangeError", (_nom, jour) => {
    expect(() => formaterJour(jour)).toThrow(RangeError);
  });
});
