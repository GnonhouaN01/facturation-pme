import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { TEXTES_EMAILS } from "@/textes/emails";

import {
  briques,
  LONGUEUR_JETON,
  LONGUEUR_MAX_CORPS,
  ligneEnTete,
  lienPublic,
  MODELES_EMAIL,
  type ModeleEmail,
} from "./modeles";

// Les modèles : liste fermée, paramètres en briques admises, textes de
// src/textes/emails.ts, texte brut. Fiche : docs/features/envoi-emails.md,
// sections 3.2, 3.3 et 4.

const ORIGINE = "https://facturation.exemple.invalid";

// Un exemple de paramètres par modèle. satisfies : un modèle ajouté sans
// exemple ne compile pas, et ce fichier le teste avec les autres.
const EXEMPLES = {
  "essai.verification_envoi": {},
} as const satisfies Record<ModeleEmail, Record<string, unknown>>;

const NOMS = Object.keys(MODELES_EMAIL) as ModeleEmail[];

function construire(nom: ModeleEmail) {
  const modele = MODELES_EMAIL[nom];
  const parametres = modele.parametres.parse(EXEMPLES[nom]);
  return modele.construire(parametres as never, { origine: ORIGINE });
}

// Caractères de contrôle C0, DEL et C1.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/u;

function jeton(): string {
  return randomBytes(32).toString("base64url");
}

describe("la liste fermée", () => {
  test("0.7 : un seul modèle, essai.verification_envoi (section 4)", () => {
    expect(NOMS).toEqual(["essai.verification_envoi"]);
  });

  test.each(NOMS)("%s : nom au format domaine.action", (nom) => {
    expect(nom).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});

describe("paramètres : schéma strict, briques admises seulement", () => {
  // Formes JSON Schema admises pour une propriété (section 4).
  function brique(propriete: Record<string, unknown>): string | null {
    if (propriete.type === "string" && propriete.format === "uuid") return "identifiant";
    if (Array.isArray(propriete.enum) && propriete.enum.every((v) => typeof v === "string")) {
      return "enumeree";
    }
    if (propriete.type === "integer") return "entier";
    if (propriete.type === "boolean") return "booleen";
    if (propriete.type === "string" && propriete.pattern === `^[A-Za-z0-9_-]{${LONGUEUR_JETON}}$`) {
      return "jeton";
    }
    if (
      propriete.type === "string" &&
      typeof propriete.maxLength === "number" &&
      typeof propriete.pattern === "string" &&
      propriete.format === undefined
    ) {
      return "texte";
    }
    return null;
  }

  test.each(NOMS)("%s : objet sans propriété supplémentaire", (nom) => {
    const schema = z.toJSONSchema(MODELES_EMAIL[nom].parametres) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
  });

  test.each(NOMS)("%s : chaque propriété est une brique admise", (nom) => {
    const schema = z.toJSONSchema(MODELES_EMAIL[nom].parametres) as {
      properties?: Record<string, Record<string, unknown>>;
    };
    for (const [cle, propriete] of Object.entries(schema.properties ?? {})) {
      expect(brique(propriete), `${nom}.${cle}`).not.toBeNull();
    }
  });

  test.each(NOMS)("%s : une clé inconnue est refusée", (nom) => {
    const resultat = MODELES_EMAIL[nom].parametres.safeParse({
      ...EXEMPLES[nom],
      destinataire: "x@exemple.invalid",
    });
    expect(resultat.success).toBe(false);
  });

  test("le contrôle refuse les formes interdites (témoin)", () => {
    const interdits = {
      chaineLibre: z.string(),
      adresse: z.email(),
      tableau: z.array(z.uuid()),
      objet: z.strictObject({ a: z.int() }),
      decimal: z.number(),
    };
    for (const [nom, schema] of Object.entries(interdits)) {
      const json = z.toJSONSchema(schema) as Record<string, unknown>;
      expect(brique(json), nom).toBeNull();
    }
  });

  test("les briques fournies passent le contrôle (témoin)", () => {
    const admises = {
      identifiant: briques.identifiant(),
      enumeree: briques.enumeree(["a", "b"]),
      entier: briques.entier(),
      booleen: briques.booleen(),
      jeton: briques.jeton(),
      texte: briques.texteAffichable(80),
    };
    for (const [nom, schema] of Object.entries(admises)) {
      const json = z.toJSONSchema(schema) as Record<string, unknown>;
      expect(brique(json), nom).toBe(nom);
    }
  });
});

describe("briques", () => {
  test("texteAffichable : refuse tout caractère de contrôle et la longueur dépassée", () => {
    const texte = briques.texteAffichable(20);
    for (const valeur of [
      "a\rb",
      "a\nb",
      "a\u0000b",
      "a\tb",
      "a\u001bb",
      "a\u0085b",
      "x".repeat(21),
    ]) {
      expect(texte.safeParse(valeur).success, JSON.stringify(valeur)).toBe(false);
    }
  });

  test("texteAffichable : garde tel quel un contenu qui ressemble à du code (S-51)", () => {
    const texte = briques.texteAffichable(80);
    for (const valeur of ["<script>alert(1)</script>", "=CMD()", "Société & Fils", "Ébène"]) {
      expect(texte.parse(valeur)).toBe(valeur);
    }
  });

  test("jeton : base64url de longueur fixe seulement", () => {
    const schema = briques.jeton();
    expect(schema.safeParse(jeton()).success).toBe(true);
    for (const valeur of [
      jeton().slice(1),
      `${jeton()}A`,
      `${jeton().slice(1)}/`,
      `${jeton().slice(1)}.`,
      `${jeton().slice(1)}:`,
      `${jeton().slice(1)}%`,
      `${jeton().slice(1)}=`,
    ]) {
      expect(schema.safeParse(valeur).success, valeur).toBe(false);
    }
  });

  test("identifiant, entier, booléen", () => {
    expect(briques.identifiant().safeParse(randomUUID()).success).toBe(true);
    expect(briques.identifiant().safeParse("pas-un-uuid").success).toBe(false);
    expect(briques.entier().safeParse(1.5).success).toBe(false);
    expect(briques.booleen().safeParse("vrai").success).toBe(false);
  });
});

describe("construction : textes de src/textes/emails.ts, texte brut", () => {
  test.each(NOMS)("%s : sujet et corps tirés de TEXTES_EMAILS", (nom) => {
    const { sujet, corps } = construire(nom);
    const textes = TEXTES_EMAILS.modeles[nom];
    expect(sujet).toBe(textes.sujet);
    expect(corps.startsWith(textes.corps)).toBe(true);
  });

  test.each(NOMS)("%s : le corps se termine par la phrase « ne pas répondre »", (nom) => {
    const { corps } = construire(nom);
    expect(corps.trimEnd().endsWith(TEXTES_EMAILS.neRepondezPas)).toBe(true);
  });

  test.each(NOMS)("%s : sujet sans caractère de contrôle", (nom) => {
    expect(construire(nom).sujet).not.toMatch(CONTROLE);
  });

  test.each(NOMS)("%s : corps sans balise HTML, longueur bornée", (nom) => {
    const { corps } = construire(nom);
    expect(corps).not.toMatch(/<\s*[a-z!/]/iu);
    expect(corps.length).toBeLessThanOrEqual(LONGUEUR_MAX_CORPS);
  });

  test("la phrase de fin demande de ne pas répondre et renvoie vers l'entreprise", () => {
    expect(TEXTES_EMAILS.neRepondezPas).toMatch(/ne pas répondre/u);
    expect(TEXTES_EMAILS.neRepondezPas).toMatch(/directement/u);
  });

  test("le nom de l'expéditeur est fixe et sans caractère de contrôle (décision 7)", () => {
    expect(TEXTES_EMAILS.expediteur).not.toBe("");
    expect(TEXTES_EMAILS.expediteur).not.toMatch(CONTROLE);
    expect(TEXTES_EMAILS.expediteur).not.toMatch(/[<>",;@]/u);
  });
});

describe("ligneEnTete", () => {
  test("retire retours à la ligne, nul et toute la plage de contrôle", () => {
    const sortie = ligneEnTete("Facture\r\nBcc: x@exemple.invalid\u0000\u001b\u0085 fin");
    expect(sortie).not.toMatch(CONTROLE);
    expect(sortie).not.toContain("\r");
    expect(sortie).not.toContain("\n");
  });

  test("limite la longueur", () => {
    expect(ligneEnTete("x".repeat(1_000)).length).toBeLessThanOrEqual(200);
    expect(ligneEnTete("x".repeat(1_000), 50).length).toBeLessThanOrEqual(50);
  });

  test("garde un texte ordinaire", () => {
    expect(ligneEnTete("Société Ébène & Fils")).toBe("Société Ébène & Fils");
  });
});

describe("lienPublic (T-65) : toujours <origine>/lien/<type>/<jeton>", () => {
  test("forme produite", () => {
    const j = jeton();
    expect(lienPublic(ORIGINE, "devis", j)).toBe(`${ORIGINE}/lien/devis/${j}`);
  });

  test("seule l'origine de l'adresse de configuration est gardée", () => {
    const j = jeton();
    expect(lienPublic(`${ORIGINE}/un/chemin?x=1#y`, "devis", j)).toBe(`${ORIGINE}/lien/devis/${j}`);
  });

  test.each([
    ["barre oblique", (j: string) => `${j.slice(1)}/`],
    ["deux-points", (j: string) => `${j.slice(1)}:`],
    ["point", (j: string) => `${j.slice(1)}.`],
    ["pourcentage", (j: string) => `${j.slice(1)}%`],
    ["trop long", (j: string) => `${j}A`],
    ["trop court", (j: string) => j.slice(1)],
    ["adresse complète", () => "https://attaquant.invalid/piege"],
    ["chemin remontant", () => "../../api/auth/x"],
  ])("jeton refusé : %s", (_nom, fabriquer) => {
    // Contrôle dans le même test : un jeton valide passe. Sans lui, une
    // fonction qui lève toujours ferait passer le refus.
    const valide = jeton();
    expect(lienPublic(ORIGINE, "devis", valide)).toBe(`${ORIGINE}/lien/devis/${valide}`);
    expect(() => lienPublic(ORIGINE, "devis", fabriquer(jeton()))).toThrow();
  });

  test.each(["", "Devis", "de/vis", "devis?x", "..", "devis.html"])("type refusé : %j", (type) => {
    const valide = jeton();
    expect(lienPublic(ORIGINE, "devis", valide)).toBe(`${ORIGINE}/lien/devis/${valide}`);
    expect(() => lienPublic(ORIGINE, type, jeton())).toThrow();
  });
});
