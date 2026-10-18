import { describe, expect, test } from "vitest";

import { matriceQr } from "./qr";

// La matrice du code QR de l'activation, calculée sur le serveur par uqr
// (décision 1) : le navigateur ne reçoit que des lignes de 0 et de 1, jamais
// la bibliothèque. Fiche : docs/features/double-authentification.md,
// sections 3.4 et 11.3, test 13.

const URI =
  "otpauth://totp/Facturation%20PME:awa%40exemple.invalid?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPJQWEY3E&issuer=Facturation+PME&digits=6&period=30";

describe("matriceQr", () => {
  test("carré de 21 à 177 modules, lignes de 0 et de 1", () => {
    const lignes = matriceQr(URI);
    expect(lignes.length).toBeGreaterThanOrEqual(21);
    expect(lignes.length).toBeLessThanOrEqual(177);
    for (const ligne of lignes) {
      expect(ligne).toHaveLength(lignes.length);
      expect(ligne).toMatch(/^[01]+$/u);
    }
  });

  test("taille d'une version de QR (21 + 4 × n modules), sans marge : la marge est tracée par le composant", () => {
    const lignes = matriceQr(URI);
    expect((lignes.length - 21) % 4).toBe(0);
    // Motif de repérage en haut à gauche : première ligne 1111111 puis un 0.
    expect(lignes[0]?.slice(0, 8)).toBe("11111110");
  });

  test("déterministe ; deux adresses différentes donnent deux matrices", () => {
    expect(matriceQr(URI)).toEqual(matriceQr(URI));
    expect(matriceQr(URI.replace("MFRG", "MFRH"))).not.toEqual(matriceQr(URI));
  });

  test.each([
    ["autre schéma", "https://exemple.invalid/?secret=ABC"],
    ["hotp", "otpauth://hotp/x?secret=ABC"],
    ["texte vide", ""],
    ["trop long", `otpauth://totp/x?secret=${"A".repeat(3000)}`],
  ])("%s : lève", (_nom, texte) => {
    expect(() => matriceQr(texte)).toThrow();
  });
});
