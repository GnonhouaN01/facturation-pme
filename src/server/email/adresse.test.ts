import { describe, expect, test } from "vitest";

import { adressePourCompteur, schemaAdresse } from "./adresse";

// L'adresse du destinataire : schéma propre, plus étroit que z.email(), et
// normalisation pour le compteur « destinataire ». Fiche :
// docs/features/envoi-emails.md, sections 3.1 et 5.2, décision 10.

function accepte(valeur: string): boolean {
  return schemaAdresse.safeParse(valeur).success;
}

describe("schemaAdresse : adresses acceptées", () => {
  test.each([
    ["simple", "client@exemple.invalid"],
    ["point dans la partie locale", "jean.dupont@exemple.invalid"],
    ["sous-adresse", "jean+factures@exemple.invalid"],
    ["chiffres et tiret", "compta-2026@sous-domaine.exemple.invalid"],
    ["partie locale de 64 caractères", `${"a".repeat(64)}@exemple.invalid`],
  ])("%s", (_nom, valeur) => {
    expect(accepte(valeur)).toBe(true);
  });

  test("254 caractères au total : acceptée", () => {
    const domaine = `${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(63)}.invalid`;
    const locale = "a".repeat(254 - 1 - domaine.length);
    expect(`${locale}@${domaine}`).toHaveLength(254);
    expect(accepte(`${locale}@${domaine}`)).toBe(true);
  });
});

describe("schemaAdresse : formes refusées (injection d'en-têtes, T-64)", () => {
  test.each([
    ["retour chariot", "client@exemple.invalid\rBcc: x@exemple.invalid"],
    ["saut de ligne", "client@exemple.invalid\nBcc: x@exemple.invalid"],
    ["CRLF", "client@exemple.invalid\r\nBcc: x@exemple.invalid"],
    ["caractère nul", "client\u0000@exemple.invalid"],
    ["tabulation", "client\t@exemple.invalid"],
    ["caractère de contrôle", "client\u001b@exemple.invalid"],
    ["DEL", "client\u007f@exemple.invalid"],
    ["virgule : deux destinataires", "a@exemple.invalid,b@exemple.invalid"],
    ["point-virgule", "a@exemple.invalid;b@exemple.invalid"],
    ["nom affiché", "Client <client@exemple.invalid>"],
    ["chevrons seuls", "<client@exemple.invalid>"],
    ["guillemets", '"client"@exemple.invalid'],
    ["parenthèses : commentaire RFC 5322", "client(commentaire)@exemple.invalid"],
    ["espace interne", "cli ent@exemple.invalid"],
    ["non ASCII dans la partie locale", "clïent@exemple.invalid"],
    ["non ASCII dans le domaine", "client@exémple.invalid"],
    ["deux @", "client@autre@exemple.invalid"],
    ["sans @", "client.exemple.invalid"],
    ["partie locale vide", "@exemple.invalid"],
    ["domaine sans point", "client@localhost"],
    ["étiquette commençant par un tiret", "client@-exemple.invalid"],
    ["étiquette finissant par un tiret", "client@exemple-.invalid"],
    ["étiquette vide", "client@exemple..invalid"],
    ["partie locale de 65 caractères", `${"a".repeat(65)}@exemple.invalid`],
    ["chaîne vide", ""],
  ])("%s", (_nom, valeur) => {
    expect(accepte(valeur)).toBe(false);
  });

  test("255 caractères au total : refusée", () => {
    const domaine = `${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(63)}.invalid`;
    const locale = "a".repeat(255 - 1 - domaine.length);
    expect(`${locale}@${domaine}`).toHaveLength(255);
    expect(accepte(`${locale}@${domaine}`)).toBe(false);
  });

  test.each([
    ["nombre", 42],
    ["null", null],
    ["tableau d'adresses", ["a@exemple.invalid", "b@exemple.invalid"]],
    ["objet", { adresse: "a@exemple.invalid" }],
  ])("%s : refusé", (_nom, valeur) => {
    expect(schemaAdresse.safeParse(valeur).success).toBe(false);
  });
});

describe("schemaAdresse : normalisation avant envoi", () => {
  test("espaces de bord retirés, domaine en minuscules, partie locale gardée", () => {
    expect(schemaAdresse.parse("  Jean.Dupont@Exemple.INVALID ")).toBe(
      "Jean.Dupont@exemple.invalid",
    );
  });
});

describe("adressePourCompteur (décision 10, option c) : pour le compteur seulement", () => {
  test.each([
    ["minuscules partout", "Jean.Dupont@Exemple.INVALID", "jean.dupont@exemple.invalid"],
    ["sous-adresse retirée", "jean+factures@exemple.invalid", "jean@exemple.invalid"],
    ["sous-adresse vide retirée", "jean+@exemple.invalid", "jean@exemple.invalid"],
    ["points gardés hors Gmail", "jean.dupont+x@exemple.invalid", "jean.dupont@exemple.invalid"],
    ["points retirés chez gmail.com", "Jean.Du.Pont+abc@Gmail.com", "jeandupont@gmail.com"],
    [
      "points retirés chez googlemail.com",
      "jean.dupont@googlemail.com",
      "jeandupont@googlemail.com",
    ],
  ])("%s", (_nom, entree, attendu) => {
    expect(adressePourCompteur(entree)).toBe(attendu);
  });

  test("variantes d'une même boîte : une seule valeur comptée", () => {
    const variantes = [
      "jeandupont@gmail.com",
      "Jean.Dupont@gmail.com",
      "j.e.a.n.dupont+1@gmail.com",
      "JEANDUPONT+relance@GMAIL.COM",
    ];
    expect(new Set(variantes.map(adressePourCompteur)).size).toBe(1);
  });

  test("ne change pas l'adresse d'envoi : schemaAdresse garde la sous-adresse", () => {
    expect(schemaAdresse.parse("jean+factures@exemple.invalid")).toBe(
      "jean+factures@exemple.invalid",
    );
  });
});
