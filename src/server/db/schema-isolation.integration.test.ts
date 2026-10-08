import { eq, sql } from "drizzle-orm";
import { describe, expect, onTestFinished, test } from "vitest";

import { db, executerDansOrganisation } from "./client";
import { codeDuRefus, verifierIsolation } from "./outils-test/isolation";
import { creerDeuxOrganisations } from "./outils-test/organisations";
import { organization } from "./schema/auth";
import { temoinIsolation } from "./schema/technique";

// Ce test vit hors de schema/ : drizzle-kit charge tous les fichiers
// schema/*.ts, et lirait un fichier de test comme un schéma.
// Fiche : docs/features/acces-donnees.md, sections 2 et 4.3 à 4.4.

type TableCatalogue = {
  table: string;
  non_nul: boolean;
  type: string;
  active: boolean;
  forcee: boolean;
};

type RegleCatalogue = {
  table: string;
  nom: string;
  commande: string;
  roles: string[];
  permissive: string;
  using: string | null;
  check: string | null;
};

type CleCatalogue = {
  table: string;
  cible: string;
  colonne_cible: string;
  nb_colonnes: number;
  suppression: string;
};

// Toute table du schéma public qui porte une colonne organisation_id.
const REQUETE_TABLES = sql`
  SELECT c.relname AS table,
         a.attnotnull AS non_nul,
         format_type(a.atttypid, a.atttypmod) AS type,
         c.relrowsecurity AS active,
         c.relforcerowsecurity AS forcee
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attname = 'organisation_id'
    AND NOT a.attisdropped
  ORDER BY c.relname`;

const REQUETE_REGLES = sql`
  SELECT tablename AS table,
         policyname AS nom,
         cmd AS commande,
         roles::text[] AS roles,
         permissive,
         qual AS using,
         with_check AS check
  FROM pg_policies
  WHERE schemaname = 'public'`;

// confdeltype : 'r' = RESTRICT.
const REQUETE_CLES = sql`
  SELECT cl.relname AS table,
         ref.relname AS cible,
         af.attname AS colonne_cible,
         cardinality(con.conkey) AS nb_colonnes,
         con.confdeltype::text AS suppression
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class ref ON ref.oid = con.confrelid
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
  JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = ANY (con.confkey)
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND a.attname = 'organisation_id'`;

describe("temoin_isolation", () => {
  test("passe les huit contrôles de verifierIsolation", async () => {
    await expect(
      verifierIsolation(temoinIsolation, (organisationId) => ({
        organisationId,
        valeur: "témoin",
      })),
    ).resolves.toBeUndefined();
  });

  test("supprimer une organisation qui a une ligne est refusé (ON DELETE RESTRICT)", async () => {
    const { a, nettoyer } = await creerDeuxOrganisations({ tables: [temoinIsolation] });
    onTestFinished(nettoyer);
    await executerDansOrganisation(a, (tx) =>
      tx.insert(temoinIsolation).values({ organisationId: a, valeur: "restrict" }),
    );

    const code = await codeDuRefus(db.delete(organization).where(eq(organization.id, a)));

    // 23001 (restrict_violation) : code de PostgreSQL 18 pour une clé en ON
    // DELETE RESTRICT ; les versions antérieures renvoyaient 23503 dans les
    // deux cas. Nos bases sont en version 18.
    expect(code).toBe("23001");
  });
});

describe("inventaire : toute table qui porte organisation_id suit le modèle", () => {
  test("chaque table est conforme, et temoin_isolation en fait partie", async () => {
    const tables = (await db.execute<TableCatalogue>(REQUETE_TABLES)).rows;
    const regles = (await db.execute<RegleCatalogue>(REQUETE_REGLES)).rows;
    const cles = (await db.execute<CleCatalogue>(REQUETE_CLES)).rows;

    // Garde contre un catalogue vide ou illisible.
    expect(tables.map((t) => t.table)).toContain("temoin_isolation");

    const reference = regles.find(
      (r) => r.table === "temoin_isolation" && r.nom === "isolation_organisation",
    );
    expect(reference, "règle de référence sur temoin_isolation").toBeDefined();
    expect(reference?.using).toBe(reference?.check);
    expect(reference?.using).toContain("NULLIF(current_setting('app.organisation_id'");

    for (const t of tables) {
      expect(t.non_nul, `${t.table} : organisation_id NOT NULL`).toBe(true);
      expect(t.type, `${t.table} : organisation_id en uuid`).toBe("uuid");
      expect(t.active, `${t.table} : règle activée`).toBe(true);
      expect(t.forcee, `${t.table} : règle forcée`).toBe(true);

      const reglesTable = regles.filter((r) => r.table === t.table);
      expect(reglesTable, `${t.table} : exactement une règle`).toHaveLength(1);
      const [regle] = reglesTable;
      expect(regle?.nom, `${t.table} : nom de la règle`).toBe("isolation_organisation");
      expect(regle?.commande, `${t.table} : toutes les commandes`).toBe("ALL");
      expect(regle?.roles, `${t.table} : pour tous les rôles`).toEqual(["public"]);
      expect(regle?.permissive, `${t.table} : règle permissive`).toBe("PERMISSIVE");
      expect(regle?.using, `${t.table} : USING identique au modèle`).toBe(reference?.using);
      expect(regle?.check, `${t.table} : WITH CHECK identique au modèle`).toBe(reference?.check);

      const clesTable = cles.filter((c) => c.table === t.table);
      expect(clesTable, `${t.table} : une clé étrangère sur organisation_id`).toHaveLength(1);
      const [cle] = clesTable;
      expect(cle?.cible, `${t.table} : clé vers organization`).toBe("organization");
      expect(cle?.colonne_cible, `${t.table} : clé vers organization.id`).toBe("id");
      expect(cle?.nb_colonnes, `${t.table} : clé sur une seule colonne`).toBe(1);
      expect(cle?.suppression, `${t.table} : ON DELETE RESTRICT`).toBe("r");
    }
  });
});

// 0.3 : droits des tables en ajout seul, TRUNCATE et index. Fiche :
// docs/features/journal-audit.md, section 8.2.

// Tables en ajout seul : le rôle de l'application n'y a ni UPDATE, ni
// DELETE, ni TRUNCATE. Toute autre table portant organisation_id a UPDATE et
// DELETE.
const TABLES_AJOUT_SEUL = ["journal_audit"];

// Tables portant organisation_id dispensées de l'index qui commence par
// cette colonne. temoin_isolation n'a aucun usage métier : elle ne reçoit de
// lignes que des tests et reste vide en production ; aucune requête de
// l'application ne la filtre, et lui ajouter un index demanderait une
// migration sur une table déjà déployée, sans gain.
const EXEMPTIONS_INDEX = ["temoin_isolation"];

type DroitsCatalogue = {
  table: string;
  organisation: boolean;
  lecture: boolean;
  insertion: boolean;
  modification: boolean;
  suppression: boolean;
  vidage: boolean;
  indexee: boolean;
};

// Toute table du schéma public, ses droits pour le rôle de la connexion, et
// l'existence d'un index dont la première colonne est organisation_id.
const REQUETE_DROITS = sql`
  SELECT c.relname AS table,
         EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'organisation_id'
                   AND NOT a.attisdropped) AS organisation,
         has_table_privilege(current_user, c.oid, 'SELECT') AS lecture,
         has_table_privilege(current_user, c.oid, 'INSERT') AS insertion,
         has_table_privilege(current_user, c.oid, 'UPDATE') AS modification,
         has_table_privilege(current_user, c.oid, 'DELETE') AS suppression,
         has_table_privilege(current_user, c.oid, 'TRUNCATE') AS vidage,
         EXISTS (SELECT 1 FROM pg_index i
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                 WHERE i.indrelid = c.oid AND a.attname = 'organisation_id') AS indexee
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
  ORDER BY c.relname`;

describe("inventaire : droits et index", () => {
  test("l'inventaire voit journal_audit", async () => {
    const tables = (await db.execute<DroitsCatalogue>(REQUETE_DROITS)).rows;

    expect(tables.filter((t) => t.organisation).map((t) => t.table)).toContain("journal_audit");
  });

  test("les tables en ajout seul sont exactement TABLES_AJOUT_SEUL", async () => {
    const tables = (await db.execute<DroitsCatalogue>(REQUETE_DROITS)).rows;
    const organisation = tables.filter((t) => t.organisation);

    const sansModification = organisation
      .filter((t) => !t.modification || !t.suppression)
      .map((t) => t.table)
      .sort();
    expect(sansModification).toEqual([...TABLES_AJOUT_SEUL].sort());

    for (const nom of TABLES_AJOUT_SEUL) {
      const t = organisation.find((ligne) => ligne.table === nom);
      expect(t, `${nom} : table portant organisation_id`).toBeDefined();
      expect(t?.lecture, `${nom} : SELECT`).toBe(true);
      expect(t?.insertion, `${nom} : INSERT`).toBe(true);
      expect(t?.modification, `${nom} : pas d'UPDATE`).toBe(false);
      expect(t?.suppression, `${nom} : pas de DELETE`).toBe(false);
      expect(t?.vidage, `${nom} : pas de TRUNCATE`).toBe(false);
    }
  });

  test("aucune table du schéma public n'accorde TRUNCATE au rôle de l'application", async () => {
    const tables = (await db.execute<DroitsCatalogue>(REQUETE_DROITS)).rows;

    // TRUNCATE ignore la règle d'isolation : il viderait la table de toutes
    // les organisations.
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((t) => t.vidage).map((t) => t.table)).toEqual([]);
  });

  test("toute table portant organisation_id, hors exemption, a un index qui commence par cette colonne", async () => {
    const tables = (await db.execute<DroitsCatalogue>(REQUETE_DROITS)).rows;
    const organisation = tables.filter((t) => t.organisation);

    // Une exemption ne survit pas à sa table.
    for (const nom of EXEMPTIONS_INDEX) {
      expect(
        organisation.map((t) => t.table),
        `exemption ${nom}`,
      ).toContain(nom);
    }

    const soumises = organisation.filter((t) => !EXEMPTIONS_INDEX.includes(t.table));
    expect(soumises.length, "au moins une table soumise au contrôle").toBeGreaterThan(0);
    for (const t of soumises) {
      expect(t.indexee, `${t.table} : index commençant par organisation_id`).toBe(true);
    }
  });
});
