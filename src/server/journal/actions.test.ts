import { describe, expect, test } from "vitest";
import { z } from "zod";

import { ACTIONS_JOURNAL, briques } from "./actions";

// La liste fermée des actions, et la règle des détails : un objet strict dont
// chaque champ est un identifiant, une valeur énumérée, un entier ou un
// booléen. Aucun texte libre (S-54). Fiche : docs/features/journal-audit.md,
// section 6.

const ATTENDUES: Record<string, string> = {
  "organisation.parametres_modifies": "organisation",
  "organisation.instructions_paiement_modifiees": "organisation",
  "organisation.visibilite_modifiee": "organisation",
  "organisation.suppression_demandee": "organisation",
  "organisation.suppression_annulee": "organisation",
  "invitation.creee": "invitation",
  "invitation.revoquee": "invitation",
  "membre.ajoute": "membre",
  "membre.role_modifie": "membre",
  "membre.retire": "membre",
  "membre.parti": "membre",
};

const TYPES_RESSOURCE = ["organisation", "invitation", "membre"];

type SchemaJson = {
  type?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaJson>;
  additionalProperties?: unknown;
};

// Écarts du schéma des détails à la règle. Mode « input » : en mode
// « output » (par défaut), Zod marque aussi un z.object ordinaire comme
// fermé, et un objet ouvert passerait le contrôle.
function ecarts(schema: z.ZodType): string[] {
  const json = z.toJSONSchema(schema, { io: "input" }) as SchemaJson;
  if (json.type !== "object") return ["les détails ne sont pas un objet"];
  const liste: string[] = [];
  if (json.additionalProperties !== false) liste.push("clés supplémentaires admises");
  for (const [cle, champ] of Object.entries(json.properties ?? {})) {
    const identifiant = champ.type === "string" && champ.format === "uuid";
    const enumeration = champ.type === "string" && Array.isArray(champ.enum);
    const entier = champ.type === "integer";
    const booleen = champ.type === "boolean";
    if (!(identifiant || enumeration || entier || booleen)) {
      liste.push(`${cle} : ni identifiant, ni valeur énumérée, ni entier, ni booléen`);
    }
  }
  return liste;
}

describe("liste fermée des actions", () => {
  test("exactement les onze actions de la fiche, avec leur type de ressource", () => {
    const lues = Object.fromEntries(
      Object.entries(ACTIONS_JOURNAL).map(([action, definition]) => [action, definition.ressource]),
    );

    expect(lues).toEqual(ATTENDUES);
  });

  test("chaque type de ressource appartient à la liste fermée", () => {
    const types = Object.values(ACTIONS_JOURNAL).map((definition) => definition.ressource);

    expect(types.length).toBeGreaterThan(0);
    for (const type of types) expect(TYPES_RESSOURCE).toContain(type);
  });

  test.each(Object.keys(ATTENDUES))("%s : détails conformes à la règle", (action) => {
    const definition = ACTIONS_JOURNAL[action];

    expect(definition, `${action} absente de la liste`).toBeDefined();
    expect(ecarts(definition!.details)).toEqual([]);
  });
});

describe("le contrôle des détails ne réussit pas à vide", () => {
  test("accepte un schéma fait des quatre briques", () => {
    const schema = z.strictObject({
      identifiant: briques.identifiant(),
      valeur: briques.enumeration(["a", "b"]),
      nombre: briques.nombre(),
      drapeau: briques.booleen(),
    });

    expect(ecarts(schema)).toEqual([]);
  });

  test("les briques refusent ce qu'elles doivent refuser", () => {
    expect(briques.identifiant().safeParse("texte").success).toBe(false);
    expect(briques.enumeration(["a", "b"]).safeParse("c").success).toBe(false);
    expect(briques.nombre().safeParse(1.5).success).toBe(false);
    expect(briques.nombre().safeParse("1").success).toBe(false);
    expect(briques.booleen().safeParse("true").success).toBe(false);
  });

  test.each([
    ["texte libre", z.strictObject({ nom: z.string() })],
    ["date en texte", z.strictObject({ le: z.iso.date() })],
    ["nombre à virgule", z.strictObject({ montant: z.number() })],
    ["tableau", z.strictObject({ ids: z.array(z.uuid()) })],
    ["objet imbriqué", z.strictObject({ sous: z.strictObject({}) })],
    ["valeur facultative nulle", z.strictObject({ id: z.uuid().nullable() })],
    ["objet ouvert", z.object({ id: z.uuid() })],
    ["objet qui laisse passer toute clé", z.looseObject({ id: z.uuid() })],
    ["pas un objet", z.uuid()],
  ])("refuse : %s", (_nom, schema) => {
    expect(ecarts(schema)).not.toEqual([]);
  });
});
