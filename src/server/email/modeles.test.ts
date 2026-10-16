import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { TEXTES_EMAILS } from "@/textes/emails";

import {
  briques,
  LONGUEUR_JETON,
  LONGUEUR_MAX_CORPS,
  ligneEnTete,
  lienFragment,
  lienPublic,
  LONGUEUR_MAX_JETON_VERIFICATION,
  MODELES_EMAIL,
  MOTIF_JETON_VERIFICATION,
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
  "compte.verification": {
    jeton:
      "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U",
  },
  "compte.existant": {},
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
  // 0.7 : un seul modèle. 1.1 : les deux emails de compte
  // (docs/features/inscription.md, section 4.5).
  test("1.1 : trois modèles, l'essai et les deux emails de compte", () => {
    expect(NOMS).toEqual(["essai.verification_envoi", "compte.verification", "compte.existant"]);
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
      propriete.pattern === MOTIF_JETON_VERIFICATION &&
      propriete.maxLength === LONGUEUR_MAX_JETON_VERIFICATION
    ) {
      return "jetonVerification";
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
      jetonVerification: briques.jetonVerification(),
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

// Jeton de vérification de Better Auth (un JWT) et lien en fragment : le
// jeton ne figure jamais dans une adresse reçue par le serveur (décision 3).
// Fiche : docs/features/inscription.md, section 4.3.
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U";

describe("jetonVerification : un JWT, trois segments base64url", () => {
  test("forme admise, et longueur maximale", () => {
    const schema = briques.jetonVerification();
    expect(schema.safeParse(JWT).success).toBe(true);
    expect(LONGUEUR_MAX_JETON_VERIFICATION).toBe(1024);
    const long = `${"a".repeat(500)}.${"b".repeat(400)}.${"c".repeat(1024 - 902)}`;
    expect(long).toHaveLength(1024);
    expect(schema.safeParse(long).success).toBe(true);
    expect(schema.safeParse(`${long}c`).success).toBe(false);
  });

  test.each([
    ["deux segments", "aaa.bbb"],
    ["quatre segments", "aaa.bbb.ccc.ddd"],
    ["segment vide", "aaa..ccc"],
    [
      "retour à la ligne",
      `${JWT}
`,
    ],
    ["espace", `${JWT} `],
    ["barre oblique", "aaa.b/b.ccc"],
    ["plus", "aaa.b+b.ccc"],
    ["égal", "aaa.bbb.ccc="],
    ["dièse", "aaa.bbb.c#c"],
    ["adresse", "https://attaquant.invalid/a.b"],
  ])("refusé : %s", (_nom, valeur) => {
    expect(briques.jetonVerification().safeParse(valeur).success).toBe(false);
  });
});

describe("lienFragment (T-65, décision 3) : <origine>/lien/<type>#<jeton>", () => {
  test("forme produite", () => {
    expect(lienFragment(ORIGINE, "verification", JWT)).toBe(`${ORIGINE}/lien/verification#${JWT}`);
  });

  test("le jeton n'est ni dans le chemin ni dans la requête : seulement dans le fragment", () => {
    const lien = new URL(lienFragment(ORIGINE, "verification", JWT));
    expect(lien.origin).toBe(ORIGINE);
    expect(lien.pathname).toBe("/lien/verification");
    expect(lien.search).toBe("");
    expect(lien.hash).toBe(`#${JWT}`);
    // Ce qu'un navigateur envoie au serveur : origine, chemin et requête.
    expect(`${lien.origin}${lien.pathname}${lien.search}`).not.toContain(JWT.slice(0, 20));
  });

  test("seule l'origine de l'adresse de configuration est gardée", () => {
    expect(lienFragment(`${ORIGINE}/un/chemin?x=1#y`, "verification", JWT)).toBe(
      `${ORIGINE}/lien/verification#${JWT}`,
    );
  });

  test.each([
    ["jeton invalide", ORIGINE, "verification", "a.b"],
    ["jeton adresse", ORIGINE, "verification", "https://attaquant.invalid/a.b.c"],
    ["type invalide", ORIGINE, "Verification", JWT],
    ["type remontant", ORIGINE, "..", JWT],
    ["origine non web", "javascript:alert(1)", "verification", JWT],
  ])("refusé : %s", (_nom, origine, type, valeur) => {
    expect(lienFragment(ORIGINE, "verification", JWT)).toBe(`${ORIGINE}/lien/verification#${JWT}`);
    expect(() => lienFragment(origine, type, valeur)).toThrow();
  });
});

describe("modèles de compte (1.1)", () => {
  test("compte.verification : le lien en fragment, construit depuis le jeton seul", () => {
    const { corps } = MODELES_EMAIL["compte.verification"].construire(
      { jeton: JWT },
      { origine: ORIGINE },
    );
    expect(corps).toContain(`${ORIGINE}/lien/verification#${JWT}`);
    expect(corps).not.toContain(`/lien/verification/${JWT.slice(0, 10)}`);
    expect(corps).not.toContain("/api/auth");
    expect(corps).not.toContain("token=");
  });

  test("compte.verification : jeton hors format refusé par le schéma", () => {
    expect(MODELES_EMAIL["compte.verification"].parametres.safeParse({ jeton: "x" }).success).toBe(
      false,
    );
  });

  test("compte.existant : aucun paramètre, aucun lien", () => {
    const { corps } = MODELES_EMAIL["compte.existant"].construire({}, { origine: ORIGINE });
    expect(corps).not.toMatch(/https?:/u);
    expect(MODELES_EMAIL["compte.existant"].parametres.safeParse({ jeton: JWT }).success).toBe(
      false,
    );
  });

  // Dette de la 1.1 : le texte vaut pour un compte vérifié ou non, et renvoie
  // à la page de connexion (1.2), sans lien (règle 17 ; liens en 1.3). Fiche :
  // docs/features/connexion.md, section 7, test 13.
  test("compte.existant : texte de la 1.2, pour un compte vérifié ou non", () => {
    const texte = TEXTES_EMAILS.modeles["compte.existant"];
    expect(texte.sujet).toBe("Tentative d'inscription avec votre adresse");
    expect(texte.corps).toBe(
      "Quelqu'un a tenté de créer un compte sur Facturation PME avec votre adresse email, qui a déjà un compte. Si c'est vous, connectez-vous depuis la page de connexion de Facturation PME avec votre mot de passe. Si vous n'avez pas encore confirmé votre adresse, demandez un nouveau lien de confirmation depuis cette même page. Sinon, ignorez cet email : votre compte n'a pas été modifié.",
    );
    const { corps } = MODELES_EMAIL["compte.existant"].construire({}, { origine: ORIGINE });
    expect(corps).toContain(texte.corps);
    expect(corps).not.toMatch(/https?:|\/connexion/u);
    expect(corps.toLowerCase()).not.toContain("mot de passe oublié");
  });
});
