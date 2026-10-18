import { describe, expect, test, vi } from "vitest";

import { ALPHABET_CODES_SECOURS, normaliserCodeSecours } from "@/schemas/regles-compte";

import {
  creerEmpreinteCodeSecours,
  creerStockageCodesSecours,
  deriverSecretCodes,
  genererCodesSecours,
  NOMBRE_CODES_SECOURS,
  PREFIXE_EMPREINTE_CODE,
} from "./codes-secours";

// Les codes de secours (F-003) : générés par nous, stockés sous empreinte
// HMAC à clé dérivée de BETTER_AUTH_SECRET, jamais en clair ni sous une forme
// réversible (S-15, THREATS.md 7.2). Fiche :
// docs/features/double-authentification.md, section 3.2, test 11.

vi.mock("../env", () => ({
  env: { BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres" },
}));

const FORME = /^[a-z2-9]{5}-[a-z2-9]{5}$/u;
const SECRET_A = deriverSecretCodes("secret-factice-de-trente-deux-caracteres");
const SECRET_B = deriverSecretCodes("un-autre-secret-factice-de-32-car");

describe("alphabet : 31 caractères sans confusion à la lecture", () => {
  test("minuscules et chiffres, ni i, l, o, 0, 1", () => {
    expect(ALPHABET_CODES_SECOURS).toBe("abcdefghjkmnpqrstuvwxyz23456789");
    expect(new Set(ALPHABET_CODES_SECOURS).size).toBe(31);
    for (const ambigu of ["i", "l", "o", "0", "1"]) {
      expect(ALPHABET_CODES_SECOURS).not.toContain(ambigu);
    }
  });
});

describe("genererCodesSecours", () => {
  test("10 codes de 10 caractères de l'alphabet, présentés xxxxx-xxxxx, tous différents", () => {
    const codes = genererCodesSecours();
    expect(NOMBRE_CODES_SECOURS).toBe(10);
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(FORME);
    expect(new Set(codes).size).toBe(10);
  });

  test("tirage par la fonction reçue (randomInt de node:crypto par défaut), sur tout l'alphabet", () => {
    let i = 0;
    const tirer = vi.fn((max: number) => i++ % max);
    const codes = genererCodesSecours(tirer);
    expect(tirer).toHaveBeenCalledTimes(100);
    for (const appel of tirer.mock.calls) expect(appel[0]).toBe(31);
    const caracteres = new Set(codes.join("").replaceAll("-", ""));
    expect(caracteres).toEqual(new Set(ALPHABET_CODES_SECOURS));
  });

  test("deux générations ne se ressemblent pas", () => {
    const a = genererCodesSecours();
    const b = genererCodesSecours();
    expect(a.filter((code) => b.includes(code))).toEqual([]);
  });
});

describe("normaliserCodeSecours : la saisie de l'utilisateur", () => {
  test.each([
    ["abcde-fghjk", "abcde-fghjk"],
    ["abcdefghjk", "abcde-fghjk"],
    ["ABCDE-FGHJK", "abcde-fghjk"],
    [" abcde fghjk ", "abcde-fghjk"],
    ["ab-cd-ef-gh-jk", "abcde-fghjk"],
  ])("%j : %j", (saisie, attendu) => {
    expect(normaliserCodeSecours(saisie)).toBe(attendu);
  });

  test.each([
    ["", "vide"],
    ["abcde-fghj", "9 caractères"],
    ["abcde-fghjkm", "11 caractères"],
    ["abcde-fghji", "i hors alphabet"],
    ["abcde-fghj0", "0 hors alphabet"],
    ["abcde_fghjk", "séparateur inconnu"],
    ["abcdé-fghjk", "lettre accentuée"],
    ["123456", "code de l'application"],
  ])("%j (%s) : refusé", (saisie) => {
    expect(normaliserCodeSecours(saisie)).toBeNull();
  });
});

describe("empreinte d'un code", () => {
  const empreinteA = creerEmpreinteCodeSecours(SECRET_A);
  const empreinteB = creerEmpreinteCodeSecours(SECRET_B);

  test("préfixe cs1:, HMAC-SHA-256 en base64url, sans le code", () => {
    const empreinte = empreinteA("abcde-fghjk");
    expect(PREFIXE_EMPREINTE_CODE).toBe("cs1:");
    expect(empreinte).toMatch(/^cs1:[A-Za-z0-9_-]{43}$/u);
    expect(empreinte).not.toContain("abcde");
    expect(empreinte).not.toContain("fghjk");
  });

  test("stable, différente pour deux codes et pour deux secrets", () => {
    expect(empreinteA("abcde-fghjk")).toBe(empreinteA("abcde-fghjk"));
    expect(empreinteA("abcde-fghjk")).not.toBe(empreinteA("abcde-fghjm"));
    expect(empreinteA("abcde-fghjk")).not.toBe(empreinteB("abcde-fghjk"));
  });

  test("une saisie hors forme lève : seul un code normalisé a une empreinte", () => {
    expect(() => empreinteA("abcdefghjk")).toThrow();
    expect(() => empreinteA("ABCDE-FGHJK")).toThrow();
  });

  test("clé dérivée par HKDF : 32 octets, différente du secret et d'un secret à l'autre", () => {
    expect(SECRET_A).toHaveLength(32);
    expect(Buffer.from(SECRET_A).toString("utf8")).not.toContain("secret-factice");
    expect(Buffer.from(SECRET_A).equals(Buffer.from(SECRET_B))).toBe(false);
  });
});

describe("stockage branché sur Better Auth (storeBackupCodes)", () => {
  const empreinte = creerEmpreinteCodeSecours(SECRET_A);
  const stockage = creerStockageCodesSecours(empreinte);

  test("encrypt : une liste de codes frais devient la liste de leurs empreintes", async () => {
    const codes = ["abcde-fghjk", "mnpqr-stuvw"];
    const stocke = await stockage.encrypt(JSON.stringify(codes));
    expect(JSON.parse(stocke)).toEqual(codes.map(empreinte));
    expect(stocke).not.toContain("abcde");
  });

  test("encrypt : une liste d'empreintes (réécrite par Better Auth après un usage) est gardée telle quelle", async () => {
    const empreintes = ["abcde-fghjk", "mnpqr-stuvw"].map(empreinte);
    expect(JSON.parse(await stockage.encrypt(JSON.stringify(empreintes)))).toEqual(empreintes);
    // Idempotente : deux passages donnent la même liste.
    const une = await stockage.encrypt(JSON.stringify(["abcde-fghjk"]));
    expect(await stockage.encrypt(une)).toBe(une);
  });

  test("encrypt : liste vide admise (tous les codes utilisés)", async () => {
    expect(JSON.parse(await stockage.encrypt("[]"))).toEqual([]);
  });

  test.each([
    ["un objet", JSON.stringify({ code: "abcde-fghjk" })],
    ["un élément d'une autre forme", JSON.stringify(["abcde-fghjk", "ABCDE-FGHJK"])],
    ["un nombre", JSON.stringify([123])],
    ["une empreinte tronquée", JSON.stringify(["cs1:abc"])],
    ["du texte non JSON", "abcde-fghjk"],
  ])("encrypt : %s lève, rien n'est stocké", async (_nom, entree) => {
    await expect(stockage.encrypt(entree)).rejects.toThrow();
  });

  test("decrypt : rend la liste stockée telle quelle (aucun déchiffrement : rien n'est réversible)", async () => {
    const stocke = await stockage.encrypt(JSON.stringify(["abcde-fghjk"]));
    expect(await stockage.decrypt(stocke)).toBe(stocke);
  });
});
