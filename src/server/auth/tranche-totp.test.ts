import { describe, expect, test } from "vitest";

import { codeHotp, PERIODE_TOTP, trancheCourante, trancheDuCode } from "./tranche-totp";

// Anti-rejeu des codes de l'application (décision 4) : la passerelle calcule
// elle-même la tranche de 30 secondes qui correspond à un code, pour ne
// jamais accepter deux fois un code d'un même compte. Valeurs de référence
// de la RFC 4226 (annexe D) et de la RFC 6238 (annexe B), secret ASCII
// « 12345678901234567890 », HMAC-SHA-1, réduites à 6 chiffres comme les codes
// de Better Auth. Fiche : docs/features/double-authentification.md,
// section 6.1, test 7.

const SECRET_RFC = "12345678901234567890";

describe("codeHotp : RFC 4226, 6 chiffres", () => {
  test.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [9, "520489"],
  ])("compteur %i : %s", (compteur, attendu) => {
    expect(codeHotp(SECRET_RFC, compteur)).toBe(attendu);
  });
});

describe("tranches de temps : RFC 6238, période de 30 secondes", () => {
  test("période de 30 secondes, comme Better Auth (période par défaut)", () => {
    expect(PERIODE_TOTP).toBe(30);
  });

  test.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ])("à %i s : le code de la tranche courante est %s", (secondes, attendu) => {
    const maintenant = secondes * 1000;
    expect(codeHotp(SECRET_RFC, trancheCourante(maintenant))).toBe(attendu);
    expect(trancheDuCode(SECRET_RFC, attendu, maintenant)).toBe(trancheCourante(maintenant));
  });
});

describe("trancheDuCode : fenêtre de ±1 tranche, comme Better Auth", () => {
  const maintenant = 1_234_567_890 * 1000;
  const t = trancheCourante(maintenant);

  test("le code de la tranche précédente, courante ou suivante donne sa tranche", () => {
    for (const ecart of [-1, 0, 1]) {
      expect(trancheDuCode(SECRET_RFC, codeHotp(SECRET_RFC, t + ecart), maintenant)).toBe(
        t + ecart,
      );
    }
  });

  test("hors de la fenêtre (±2 tranches) : aucune tranche", () => {
    for (const ecart of [-2, 2]) {
      const code = codeHotp(SECRET_RFC, t + ecart);
      // Garde : le code de ±2 ne coïncide pas avec ceux de la fenêtre.
      const fenetre = [-1, 0, 1].map((e) => codeHotp(SECRET_RFC, t + e));
      expect(fenetre).not.toContain(code);
      expect(trancheDuCode(SECRET_RFC, code, maintenant)).toBeNull();
    }
  });

  test("un code faux, un autre secret, une forme invalide : aucune tranche", () => {
    const juste = codeHotp(SECRET_RFC, t);
    const faux = juste === "000000" ? "000001" : "000000";
    expect(trancheDuCode(SECRET_RFC, faux, maintenant)).toBeNull();
    expect(trancheDuCode("un-autre-secret-de-32-caracteres!", juste, maintenant)).toBeNull();
    for (const forme of ["", "12345", "1234567", "12a456", " 12345", "١٢٣٤٥٦"]) {
      expect(trancheDuCode(SECRET_RFC, forme, maintenant)).toBeNull();
    }
  });
});
