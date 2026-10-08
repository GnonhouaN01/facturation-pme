import { getColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import * as schemaAuth from "./schema/auth";

// Ce test vit hors de schema/ : drizzle-kit charge tous les fichiers
// schema/*.ts, et lirait un fichier de test comme un schéma.
// Fiche : docs/features/identifiants-uuid.md.

const TABLES = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "two_factor",
  "user",
  "verification",
];

// [table, colonne, table visée, colonne visée], noms SQL.
const CLES_ETRANGERES: [string, string, string, string][] = [
  ["account", "user_id", "user", "id"],
  ["invitation", "inviter_id", "user", "id"],
  ["invitation", "organization_id", "organization", "id"],
  ["member", "organization_id", "organization", "id"],
  ["member", "user_id", "user", "id"],
  ["session", "user_id", "user", "id"],
  ["two_factor", "user_id", "user", "id"],
];

// auth.ts exporte aussi authRelations : on ne garde que les tables.
const tables = new Map(
  (Object.values(schemaAuth) as unknown[])
    .filter((valeur): valeur is PgTable => is(valeur, PgTable))
    .map((table) => [getTableName(table), table]),
);

function table(nom: string): PgTable {
  const trouvee = tables.get(nom);
  if (!trouvee) throw new Error(`Table absente du schéma : ${nom}`);
  return trouvee;
}

function colonne(nomTable: string, nomColonne: string) {
  const trouvee = Object.values(getColumns(table(nomTable))).find(
    (candidate) => candidate.name === nomColonne,
  );
  if (!trouvee) throw new Error(`Colonne absente du schéma : ${nomTable}.${nomColonne}`);
  return trouvee;
}

function clesEtrangeresDuSchema(): [string, string, string, string][] {
  return [...tables.values()].flatMap((source) =>
    getTableConfig(source).foreignKeys.map((cle): [string, string, string, string] => {
      const reference = cle.reference();
      const [colonneSource, ...autresSources] = reference.columns;
      const [colonneCible, ...autresCibles] = reference.foreignColumns;
      if (!colonneSource || !colonneCible || autresSources.length || autresCibles.length) {
        throw new Error(`Clé étrangère sur plusieurs colonnes : ${cle.getName()}`);
      }
      return [
        getTableName(source),
        colonneSource.name,
        getTableName(reference.foreignTable),
        colonneCible.name,
      ];
    }),
  );
}

describe("schéma de Better Auth : identifiants UUID", () => {
  test("le schéma contient exactement les 8 tables attendues", () => {
    expect([...tables.keys()].sort()).toEqual(TABLES);
  });

  test.each(TABLES)("%s.id est une clé primaire uuid avec une valeur par défaut", (nom) => {
    const id = colonne(nom, "id");
    expect(id.getSQLType()).toBe("uuid");
    expect(id.primary).toBe(true);
    expect(id.hasDefault).toBe(true);
  });

  test.each(CLES_ETRANGERES)("%s.%s est de type uuid", (nomTable, nomColonne) => {
    expect(colonne(nomTable, nomColonne).getSQLType()).toBe("uuid");
  });

  test("les clés étrangères du schéma sont exactement les 7 attendues", () => {
    expect(clesEtrangeresDuSchema().sort()).toEqual(CLES_ETRANGERES);
  });

  test("chaque clé étrangère relie une colonne uuid à une colonne uuid", () => {
    for (const [source, colonneSource, cible, colonneCible] of clesEtrangeresDuSchema()) {
      expect(colonne(source, colonneSource).getSQLType(), `${source}.${colonneSource}`).toBe(
        "uuid",
      );
      expect(colonne(cible, colonneCible).getSQLType(), `${cible}.${colonneCible}`).toBe("uuid");
    }
  });

  test("session.active_organization_id reste en text (exception documentée)", () => {
    expect(colonne("session", "active_organization_id").getSQLType()).toBe("text");
  });

  test("le schéma contient exactement 15 colonnes uuid : les 8 id et les 7 clés étrangères", () => {
    const attendues = [
      ...TABLES.map((nom) => `${nom}.id`),
      ...CLES_ETRANGERES.map(([nomTable, nomColonne]) => `${nomTable}.${nomColonne}`),
    ].sort();
    const obtenues = [...tables.entries()]
      .flatMap(([nom, source]) =>
        Object.values(getColumns(source))
          .filter((candidate) => candidate.getSQLType() === "uuid")
          .map((candidate) => `${nom}.${candidate.name}`),
      )
      .sort();
    expect(obtenues).toEqual(attendues);
  });
});
