import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

// Lecture du source des requêtes de la 2.2 (S-33, correction 4 du
// développeur) : les colonnes des instructions de paiement ne s'écrivent que
// par ecrireInstructionsPaiement, et la colonne logo n'est nommée que par
// les trois requêtes du logo (lire pour la route, écrire, retirer). Une
// fonction qui les nommerait ailleurs fait échouer ce test. Fiche :
// docs/features/parametres-organisation.md, sections 5 et 6, test 5.

const SOURCE = readFileSync(fileURLToPath(new URL("./parametres.ts", import.meta.url)), "utf8");

// Corps de chaque fonction exportée, commentaires retirés.
function fonctions(source: string): Map<string, string> {
  const sansCommentaires = source.replace(/\/\/[^\n]*/gu, "");
  const morceaux = sansCommentaires.split(/(?=export (?:async )?function )/u);
  const resultat = new Map<string, string>();
  for (const morceau of morceaux) {
    const nom = /^export (?:async )?function (\w+)/u.exec(morceau)?.[1];
    if (nom) resultat.set(nom, morceau);
  }
  return resultat;
}

const FONCTIONS = fonctions(SOURCE);

function nommant(motif: RegExp): string[] {
  return [...FONCTIONS]
    .filter(([, corps]) => motif.test(corps))
    .map(([nom]) => nom)
    .sort();
}

describe("requêtes des paramètres (source)", () => {
  test("le découpage trouve les fonctions attendues", () => {
    for (const nom of [
      "lireParametres",
      "ecrireFiche",
      "lireInstructions",
      "ecrireInstructionsPaiement",
      "lireLogo",
      "ecrireLogo",
      "retirerLogo",
    ]) {
      expect(FONCTIONS.has(nom), nom).toBe(true);
    }
  });

  test("instructions de paiement : écrites par ecrireInstructionsPaiement seule", () => {
    const ecritures = [...FONCTIONS]
      .filter(
        ([, corps]) =>
          /\.(set|values)\(/u.test(corps) && /paiement(MobileMoney|Bancaire)/u.test(corps),
      )
      .map(([nom]) => nom);
    expect(ecritures).toEqual(["ecrireInstructionsPaiement"]);
    expect(nommant(/paiement(MobileMoney|Bancaire)/u)).toEqual([
      "ecrireInstructionsPaiement",
      "lireInstructions",
      "lireParametres",
    ]);
  });

  test("colonne logo : nommée par les trois requêtes du logo seulement", () => {
    expect(nommant(/\.logo\b(?!Type)|\blogo:/u)).toEqual(["ecrireLogo", "lireLogo", "retirerLogo"]);
  });

  test("ecrireFiche ne nomme ni le logo ni les instructions", () => {
    const corps = FONCTIONS.get("ecrireFiche") ?? "";
    expect(corps).not.toMatch(/paiement|logo/iu);
  });
});
