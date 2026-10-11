import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { consignerErreurRequete } from "./consigner";

// onRequestError délègue à consignerErreurRequete : une ligne
// console.error("[requete]", JSON) avec seulement digest, classe, code,
// routePath, routeType. Jamais le message, la pile, la cause, l'adresse
// demandée, les en-têtes ni les paramètres (S-54, S-85, S-20).
// Fiche : docs/features/socle-interface.md, section 4.2.

const JETON = "jT0k3n-Secret-De-Lien-9f8e7d6c5b4a";
const EMAIL = "victime@exemple.ci";
const URL_BASE = "postgresql://app_facturation:mot-de-passe-secret@db.exemple.ci:5432/facturation";

type Requete = Parameters<typeof consignerErreurRequete>[1];
type Contexte = Parameters<typeof consignerErreurRequete>[2];

const REQUETE: Requete = {
  path: `/lien/devis/${JETON}?email=${encodeURIComponent(EMAIL)}`,
  method: "GET",
  headers: {
    cookie: "better-auth.session_token=jeton-de-session-secret",
    "x-forwarded-for": "203.0.113.7",
  },
};

const CONTEXTE: Contexte = {
  routerKind: "App Router",
  routePath: "/lien/devis/[jeton]",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
};

class DrizzleQueryError extends Error {
  override name = "DrizzleQueryError";
}

function erreurChargee(): Error {
  const pg = Object.assign(new Error(`connexion à ${URL_BASE} refusée pour ${EMAIL}`), {
    code: "23505",
    detail: `Key (email)=(${EMAIL}) already exists.`,
  });
  const erreur = new DrizzleQueryError(
    `Failed query: select * from "member" where "email" = '${EMAIL}'\nparams: ${URL_BASE}`,
    { cause: pg },
  );
  erreur.stack = `DrizzleQueryError: ...\n    at lire (/var/task/node_modules/drizzle-orm/index.js:1:1)\n    at DATABASE_URL (/var/task/.next/server/app/page.js:2:2)`;
  return Object.assign(erreur, { digest: "2876543210" });
}

let espion: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  espion = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  espion.mockRestore();
});

// Tout ce qui a été passé à console.error, Error comprises : inspect montre
// leur message, leur pile et leur cause.
function journal(): string {
  return inspect(espion.mock.calls, { depth: Infinity });
}

function ligne(): Record<string, unknown> {
  expect(espion).toHaveBeenCalledTimes(1);
  const [prefixe, json, ...reste] = espion.mock.calls[0] ?? [];
  expect(prefixe).toBe("[requete]");
  expect(reste).toEqual([]);
  expect(typeof json).toBe("string");
  return JSON.parse(json as string) as Record<string, unknown>;
}

describe("consignerErreurRequete", () => {
  test("seulement digest, classe, code, routePath et routeType", async () => {
    await consignerErreurRequete(erreurChargee(), REQUETE, CONTEXTE);

    expect(ligne()).toEqual({
      digest: "2876543210",
      classe: "DrizzleQueryError",
      code: "23505",
      routePath: "/lien/devis/[jeton]",
      routeType: "render",
    });
  });

  test("ni message, ni pile, ni cause, ni adresse demandée, ni en-têtes", async () => {
    await consignerErreurRequete(erreurChargee(), REQUETE, CONTEXTE);

    const texte = journal();
    for (const marqueur of [
      EMAIL,
      "postgresql://",
      "mot-de-passe-secret",
      "db.exemple.ci",
      "select",
      "Failed query",
      "already exists",
      "node_modules",
      ".next",
      "/var/task",
      "DATABASE_URL",
      "jeton-de-session-secret",
      "203.0.113.7",
      "GET",
      "react-server-components",
    ]) {
      expect(texte, marqueur).not.toContain(marqueur);
    }
  });

  test("le chemin réel /lien/devis/<jeton> n'apparaît pas, seul le motif de la route", async () => {
    await consignerErreurRequete(erreurChargee(), REQUETE, CONTEXTE);

    expect(journal()).not.toContain(JETON);
    expect(ligne().routePath).toBe("/lien/devis/[jeton]");
  });

  test("code PostgreSQL lu en suivant les cause, sur plusieurs niveaux", async () => {
    const profonde = new Error("niveau 3", { cause: { code: "40001" } });
    const erreur = new Error("niveau 1", { cause: new Error("niveau 2", { cause: profonde }) });

    await consignerErreurRequete(erreur, REQUETE, CONTEXTE);

    expect(ligne().code).toBe("40001");
  });

  test.each([
    ["code non PostgreSQL", "ECONNREFUSED"],
    ["code trop long", "235050"],
    ["code en minuscules", "abcde"],
    ["code numérique", 23505],
  ])("%s : pas de code consigné", async (_nom, code) => {
    await consignerErreurRequete(Object.assign(new Error("x"), { code }), REQUETE, CONTEXTE);

    expect(ligne()).not.toHaveProperty("code");
  });

  test("sans digest : pas de digest consigné, et pas d'autre champ", async () => {
    await consignerErreurRequete(new TypeError("x"), REQUETE, CONTEXTE);

    expect(ligne()).toEqual({
      classe: "TypeError",
      routePath: "/lien/devis/[jeton]",
      routeType: "render",
    });
  });

  test("digest non textuel : ignoré", async () => {
    await consignerErreurRequete(
      Object.assign(new Error("x"), { digest: { message: EMAIL } }),
      REQUETE,
      CONTEXTE,
    );

    expect(ligne()).not.toHaveProperty("digest");
    expect(journal()).not.toContain(EMAIL);
  });

  test.each([
    ["une chaîne", `erreur pour ${EMAIL}`],
    ["un objet", { message: EMAIL, stack: "/var/task" }],
    ["null", null],
    ["undefined", undefined],
  ])(
    "valeur levée qui n'est pas une Error (%s) : une ligne, sans la valeur",
    async (_n, valeur) => {
      await consignerErreurRequete(valeur, REQUETE, CONTEXTE);

      const champs = ligne();
      expect(Object.keys(champs).sort()).toEqual(
        expect.arrayContaining(["classe", "routePath", "routeType"]),
      );
      expect(journal()).not.toContain(EMAIL);
      expect(journal()).not.toContain("/var/task");
    },
  );

  test("classe d'erreur au nom forgé : le nom du constructeur, pas name", async () => {
    const erreur = new Error("x");
    erreur.name = `Erreur de ${EMAIL}`;

    await consignerErreurRequete(erreur, REQUETE, CONTEXTE);

    expect(ligne().classe).toBe("Error");
    expect(journal()).not.toContain(EMAIL);
  });
});

// consignerErreurRequete ne lève jamais : une valeur levée hostile (accesseur
// qui lève, Proxy) ou inattendue donne une ligne, au pire la ligne fixe, sans
// aucune donnée de la valeur levée.
const LIGNE_FIXE = { echec: "consignation" };

function accesseurQuiLeve(nom: string): Error {
  return Object.defineProperty(new Error("x"), nom, {
    get() {
      throw new Error(`accesseur piégé ${EMAIL}`);
    },
  });
}

const PROXY_HOSTILE = new Proxy(
  {},
  {
    get() {
      throw new Error(`lecture piégée ${EMAIL}`);
    },
    has() {
      throw new Error(`in piégé ${EMAIL}`);
    },
    getPrototypeOf() {
      throw new Error(`prototype piégé ${EMAIL}`);
    },
    getOwnPropertyDescriptor() {
      throw new Error(`descripteur piégé ${EMAIL}`);
    },
    ownKeys() {
      throw new Error(`clés piégées ${EMAIL}`);
    },
  },
);

describe("consignerErreurRequete ne lève jamais", () => {
  test.each([
    ["accesseur digest qui lève", accesseurQuiLeve("digest")],
    ["accesseur code qui lève", accesseurQuiLeve("code")],
    ["accesseur cause qui lève", accesseurQuiLeve("cause")],
    ["accesseur constructor qui lève", accesseurQuiLeve("constructor")],
    ["Proxy qui lève à toute lecture", PROXY_HOSTILE],
  ])("%s : la ligne fixe, sans donnée de la valeur levée", async (_nom, valeur) => {
    await expect(consignerErreurRequete(valeur, REQUETE, CONTEXTE)).resolves.toBeUndefined();

    expect(ligne()).toEqual(LIGNE_FIXE);
    expect(journal()).not.toContain(EMAIL);
    expect(journal()).not.toContain("piégé");
  });

  test.each([
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["une chaîne", `erreur pour ${EMAIL}`, "string"],
    ["un symbole", Symbol(EMAIL), "symbol"],
    [
      "un objet sans prototype",
      Object.assign(Object.create(null) as object, { message: EMAIL }),
      "inconnue",
    ],
  ])("%s : ne lève pas, une ligne sans la valeur", async (_nom, valeur, classe) => {
    await expect(consignerErreurRequete(valeur, REQUETE, CONTEXTE)).resolves.toBeUndefined();

    expect(ligne()).toEqual({ classe, routePath: "/lien/devis/[jeton]", routeType: "render" });
    expect(journal()).not.toContain(EMAIL);
  });
});
