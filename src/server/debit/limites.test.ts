import { describe, expect, test } from "vitest";

import { fenetreMaxSecondes, LIMITES, type Limite } from "./limites";

// Les limites, source unique. Fiche : docs/features/limitation-debit.md,
// section 1.

const UN_JOUR = 24 * 60 * 60;

describe("LIMITES", () => {
  test.each(Object.entries(LIMITES))(
    "%s : nom, maximum, fenêtre et désignation valides",
    (nom, limite: Limite) => {
      // Le nom apparaît en clair dans la clé, avant « : ».
      expect(nom).toMatch(/^[a-z_.]+$/);
      expect(Number.isInteger(limite.maximum)).toBe(true);
      expect(limite.maximum).toBeGreaterThan(0);
      expect(Number.isInteger(limite.fenetreSecondes)).toBe(true);
      expect(limite.fenetreSecondes).toBeGreaterThan(0);
      expect(limite.fenetreSecondes).toBeLessThanOrEqual(UN_JOUR);
      expect(["utilisateur"]).toContain(limite.par);
    },
  );

  test("membre.action : 60 tentatives par minute et par utilisateur (décision 4)", () => {
    expect(LIMITES["membre.action"]).toStrictEqual({
      maximum: 60,
      fenetreSecondes: 60,
      par: "utilisateur",
    });
  });
});

describe("fenetreMaxSecondes", () => {
  test("renvoie la plus longue fenêtre", () => {
    const limites: Record<string, Limite> = {
      courte: { maximum: 3, fenetreSecondes: 10, par: "utilisateur" },
      longue: { maximum: 5, fenetreSecondes: 3_600, par: "utilisateur" },
      moyenne: { maximum: 9, fenetreSecondes: 60, par: "utilisateur" },
    };

    expect(fenetreMaxSecondes(limites)).toBe(3_600);
  });

  test("LIMITES : positive et au plus 24 heures", () => {
    const fenetre = fenetreMaxSecondes(LIMITES);

    expect(fenetre).toBeGreaterThan(0);
    expect(fenetre).toBeLessThanOrEqual(UN_JOUR);
  });
});
