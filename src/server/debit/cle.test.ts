import { createHmac, hkdfSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { cleCompteur, deriverSecret } from "./cle";

// La clé d'un compteur : nom en clair, empreinte HMAC-SHA-256, jamais la
// valeur. Fiche : docs/features/limitation-debit.md, section 3.

const SECRET_AUTH = "secret-factice-de-trente-deux-caracteres";
const AUTRE_SECRET_AUTH = "autre-secret-factice-de-trente-deux-car";
const UTILISATEUR = "3f2b8c4e-6d1a-4f5b-9c7e-2a8d0b1e4f6c";
const FORME = /^membre\.action:[0-9a-f]{64}$/;

function hex(octets: Uint8Array): string {
  return Buffer.from(octets).toString("hex");
}

describe("deriverSecret : HKDF depuis BETTER_AUTH_SECRET (décision 1)", () => {
  test("32 octets, égaux à HKDF-SHA-256 avec l'étiquette de la fiche", () => {
    const attendu = new Uint8Array(
      hkdfSync("sha256", SECRET_AUTH, "", "facturation-pme/compteur-debit/v1", 32),
    );

    const secret = deriverSecret(SECRET_AUTH);

    expect(secret).toHaveLength(32);
    expect(hex(secret)).toBe(hex(attendu));
  });

  test("même entrée, même secret ; autre entrée, autre secret", () => {
    expect(hex(deriverSecret(SECRET_AUTH))).toBe(hex(deriverSecret(SECRET_AUTH)));
    expect(hex(deriverSecret(SECRET_AUTH))).not.toBe(hex(deriverSecret(AUTRE_SECRET_AUTH)));
  });

  test("le secret de Better Auth n'apparaît pas dans le secret dérivé", () => {
    const secret = deriverSecret(SECRET_AUTH);

    expect(Buffer.from(secret).toString("utf8")).not.toContain(SECRET_AUTH);
    expect(hex(secret)).not.toContain(Buffer.from(SECRET_AUTH).toString("hex"));
  });
});

describe("cleCompteur", () => {
  const secret = new Uint8Array(32).fill(7);
  const autreSecret = new Uint8Array(32).fill(8);

  test("forme <nom>:<64 hexadécimaux>, égale au HMAC du nom, d'un octet nul et de la valeur", () => {
    const attendu = createHmac("sha256", secret)
      .update(`membre.action\0${UTILISATEUR}`)
      .digest("hex");

    const cle = cleCompteur("membre.action", UTILISATEUR, secret);

    expect(cle).toMatch(FORME);
    expect(cle).toBe(`membre.action:${attendu}`);
  });

  test("la valeur comptée n'apparaît pas dans la clé", () => {
    const cle = cleCompteur("membre.action", UTILISATEUR, secret);

    expect(cle).not.toContain(UTILISATEUR);
    expect(cle).not.toContain(UTILISATEUR.replaceAll("-", ""));
  });

  test("même entrée, même clé", () => {
    expect(cleCompteur("membre.action", UTILISATEUR, secret)).toBe(
      cleCompteur("membre.action", UTILISATEUR, secret),
    );
  });

  test("autre nom de limite : empreinte différente pour la même valeur", () => {
    const a = cleCompteur("membre.action", UTILISATEUR, secret).split(":")[1];
    const b = cleCompteur("autre.limite", UTILISATEUR, secret).split(":")[1];

    expect(a).not.toBe(b);
  });

  test("autre secret : clé différente", () => {
    expect(cleCompteur("membre.action", UTILISATEUR, secret)).not.toBe(
      cleCompteur("membre.action", UTILISATEUR, autreSecret),
    );
  });

  test("aucune collision par séparateur", () => {
    const a = cleCompteur("a", "b:c", secret).split(":").at(-1);
    const b = cleCompteur("a:b", "c", secret).split(":").at(-1);

    expect(a).not.toBe(b);
  });

  test("valeur très longue : clé de longueur fixe", () => {
    const cle = cleCompteur("membre.action", "x".repeat(100_000), secret);

    expect(cle).toMatch(FORME);
    expect(cle).toHaveLength("membre.action:".length + 64);
  });
});
