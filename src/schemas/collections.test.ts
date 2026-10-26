import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

// Toute collection d'un schéma Zod (tableau, ensemble, tuple variadique) porte
// une borne .max(). GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6) : un grand tableau
// invalide face à un schéma de tableau faisait accumuler un problème par
// élément, jusqu'à l'épuisement de la mémoire. zod 4.6.7 corrige l'avis ; la
// borne garde la même défense pour toute collection future. Aujourd'hui,
// src/ n'en contient aucune hors des tests (vérifié le 2026-10-26).
// Les corps de /api/auth sont en outre bornés à 4 096 octets
// (server/auth/points-entree.ts, TAILLE_MAX_CORPS).

const RACINE = join(__dirname, "..");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) return fichiers(chemin);
    return /\.tsx?$/u.test(entree.name) && !/\.test\.tsx?$/u.test(entree.name) ? [chemin] : [];
  });
}

// Le reste de l'expression qui commence à `debut` : jusqu'au premier `,`,
// `;` ou parenthèse fermante qui la termine, hors parenthèses, crochets et
// accolades ouverts depuis.
function expression(source: string, debut: number): string {
  let profondeur = 0;
  for (let i = debut; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(" || c === "[" || c === "{") profondeur += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (profondeur === 0) return source.slice(debut, i);
      profondeur -= 1;
    } else if ((c === "," || c === ";") && profondeur === 0) return source.slice(debut, i);
  }
  return source.slice(debut);
}

const COLLECTION = /\bz\.(array|set)\(|\.array\(\)|\.rest\(/gu;

// Collections sans .max() dans un texte : « ligne: début de l'expression ».
export function collectionsSansBorne(source: string): string[] {
  const fautes: string[] = [];
  for (const trouve of source.matchAll(COLLECTION)) {
    const texte = expression(source, trouve.index);
    if (!/\.max\(/u.test(texte)) {
      const ligne = source.slice(0, trouve.index).split("\n").length;
      fautes.push(`${ligne}: ${texte.replace(/\s+/gu, " ").slice(0, 60)}`);
    }
  }
  return fautes;
}

describe("collections bornées dans les schémas Zod", () => {
  test("détecteur : tableau, ensemble, .array() et .rest() sans .max() relevés ; bornés acceptés", () => {
    expect(collectionsSansBorne("const a = z.array(z.string());")).toHaveLength(1);
    expect(collectionsSansBorne("const a = z.set(z.uuid()).min(1);")).toHaveLength(1);
    expect(collectionsSansBorne("const a = z.string().array();")).toHaveLength(1);
    expect(collectionsSansBorne("const a = z.tuple([z.string()]).rest(z.number());")).toHaveLength(
      1,
    );
    expect(
      collectionsSansBorne("const s = z.strictObject({ ids: z.array(z.uuid()), n: z.number() });"),
    ).toHaveLength(1);
    expect(collectionsSansBorne("const a = z.array(z.string()).max(10);")).toEqual([]);
    expect(
      collectionsSansBorne("const a = z.array(z.object({ x: z.string() })).min(1).max(50);"),
    ).toEqual([]);
    expect(
      collectionsSansBorne(
        "const s = z.strictObject({ ids: z.array(z.uuid()).max(20), n: z.number() });",
      ),
    ).toEqual([]);
  });

  test("aucune collection sans .max() dans src/ (hors tests)", () => {
    const fautes = fichiers(RACINE).flatMap((chemin) =>
      collectionsSansBorne(readFileSync(chemin, "utf8")).map(
        (faute) => `${relative(RACINE, chemin)}:${faute}`,
      ),
    );
    expect(fautes).toEqual([]);
  });
});
