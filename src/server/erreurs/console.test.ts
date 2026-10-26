import { format } from "node:util";

import { createAdapterFactory } from "better-auth/adapters";
import { afterEach, describe, expect, test, vi } from "vitest";

import { argumentSur, installerFiltreConsole } from "./console";

// Filtre de console.error du serveur (T-39) : aucune erreur écrite à la
// console ne contient une requête SQL ni ses paramètres, même écrite par une
// dépendance ; les autres méthodes restent intactes.
// Fiche : docs/features/socle-interface.md, section 4.4.

const JETON = "jeton-de-session-Zx81QaP0";
const REQUETE = `select "id", "name", "email" from "user" where "user"."id" = $1`;

// Forme de l'erreur de Drizzle : la requête et ses paramètres dans le
// message, la cause de pg.
class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    cause: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(",")}`, { cause });
  }
}

const METHODES = ["error", "warn", "log", "info", "debug", "trace", "dir", "table"] as const;

// Sortie réelle de la console remplacée par une capture, filtre installé
// par-dessus : ce que le filtre transmet est ce qui atteindrait le journal.
function capturer(): { sortie: string[]; retirer: () => void } {
  const sortie: string[] = [];
  for (const methode of METHODES) {
    vi.spyOn(console, methode).mockImplementation((...args: unknown[]) => {
      sortie.push(format(...args));
    });
  }
  const retirer = installerFiltreConsole(console);
  return { sortie, retirer };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function sansFuite(sortie: string[]): void {
  const texte = sortie.join("\n");
  expect(texte).not.toContain(JETON);
  expect(texte).not.toMatch(/failed query/iu);
  expect(texte).not.toMatch(/params:/iu);
  expect(texte).not.toMatch(/\bselect\b/iu);
  expect(texte).not.toContain('"user"');
}

describe("jointure de secours de Better Auth en échec (handleFallbackJoin)", () => {
  test("ni la requête ni ses paramètres n'atteignent la console", async () => {
    const { sortie, retirer } = capturer();
    try {
      // Vraie fabrique d'adaptateurs de Better Auth : la session est lue,
      // la lecture jointe de l'utilisateur échoue comme une requête Drizzle.
      const fabrique = createAdapterFactory({
        config: { adapterId: "essai-jointure" },
        adapter: () => ({
          create: async ({ data }) => data,
          // Méthode générique chez Better Auth : la ligne factice est
          // convertie vers le type demandé.
          findOne: async <T>({ model }: { model: string }) => {
            if (model === "user") {
              throw new DrizzleQueryError(REQUETE, ["u-1", JETON], { code: "57P01" });
            }
            return {
              id: "s-1",
              token: JETON,
              userId: "u-1",
              expiresAt: new Date(0),
              createdAt: new Date(0),
              updatedAt: new Date(0),
            } as T;
          },
          findMany: async ({ model }) => {
            if (model === "user") {
              throw new DrizzleQueryError(REQUETE, ["u-1", JETON], { code: "57P01" });
            }
            return [];
          },
          update: async () => null,
          updateMany: async () => 0,
          delete: async () => undefined,
          deleteMany: async () => 0,
          count: async () => 0,
        }),
      });
      const adaptateur = fabrique({});

      await expect(
        adaptateur.findOne({
          model: "session",
          where: [{ field: "token", value: JETON }],
          join: { user: true },
        }),
      ).rejects.toBeInstanceOf(DrizzleQueryError);

      // Better Auth a bien écrit à la console ; le filtre n'a laissé passer
      // que la classe et le code.
      expect(sortie.length).toBeGreaterThan(0);
      expect(sortie.join("\n")).toContain("[DrizzleQueryError 57P01]");
      sansFuite(sortie);
    } finally {
      retirer();
    }
  });
});

describe("filtre installé", () => {
  test("console.error : objet, erreur, texte de requête retirés", () => {
    const { sortie, retirer } = capturer();
    try {
      const erreur = new DrizzleQueryError(REQUETE, [JETON], { code: "57P01" });
      console.error(erreur);
      console.error("échec :", { where: [{ field: "token", value: JETON }] });
      console.error(`Failed query: ${REQUETE}\nparams: ${JETON}`);
      console.error("%s", `params: ${JETON}`);
      console.error(`${REQUETE}`);
      expect(sortie).toEqual([
        "[DrizzleQueryError 57P01]",
        "échec : [Object]",
        "[texte retiré]",
        "[texte retiré]",
        "[texte retiré]",
      ]);
      sansFuite(sortie);
    } finally {
      retirer();
    }
  });

  test("seul console.error est remplacé ; les autres méthodes restent intactes", () => {
    const avant = METHODES.map((methode) => console[methode]);
    const retirer = installerFiltreConsole(console);
    try {
      METHODES.forEach((methode, i) => {
        if (methode === "error") expect(console.error).not.toBe(avant[i]);
        else expect(console[methode]).toBe(avant[i]);
      });
    } finally {
      retirer();
    }
    expect(console.error).toBe(avant[0]);
  });

  test("nos lignes fixes passent inchangées", () => {
    const { sortie, retirer } = capturer();
    try {
      const ligne = JSON.stringify({ digest: "123", classe: "DrizzleQueryError", code: "57P01" });
      console.error("[requete]", ligne);
      console.log("▲ Next.js 16.4.0");
      expect(sortie).toEqual([`[requete] ${ligne}`, "▲ Next.js 16.4.0"]);
    } finally {
      retirer();
    }
  });

  test("installé deux fois : un seul filtre ; retiré : console d'origine rendue", () => {
    const { sortie, retirer } = capturer();
    const filtre = console.error;
    const second = installerFiltreConsole(console);
    expect(console.error).toBe(filtre);
    second();
    retirer();
    expect(console.error).not.toBe(filtre);
    console.error(`params: ${JETON}`);
    // Sans filtre, la capture reçoit la valeur telle quelle.
    expect(sortie).toEqual([`params: ${JETON}`]);
  });
});

describe("argumentSur", () => {
  test("primitives gardées, sauf un texte de requête", () => {
    expect(argumentSur("Prêt en 120 ms")).toBe("Prêt en 120 ms");
    expect(argumentSur(42)).toBe(42);
    expect(argumentSur(true)).toBe(true);
    expect(argumentSur(undefined)).toBe(undefined);
    expect(argumentSur(null)).toBe(null);
    expect(argumentSur(`INSERT INTO "session" ("token") VALUES ($1)`)).toBe("[texte retiré]");
    expect(argumentSur(`update "user" set "name" = $1 where "id" = $2`)).toBe("[texte retiré]");
    expect(argumentSur(`delete from "verification" where "identifier" = $1`)).toBe(
      "[texte retiré]",
    );
  });

  test("objet ou erreur : classe et code seulement, formes strictes", () => {
    expect(argumentSur(new TypeError("x"))).toBe("[TypeError]");
    expect(argumentSur(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(
      "[Error ECONNRESET]",
    );
    expect(argumentSur(new Error("x", { cause: { code: "23505" } }))).toBe("[Error 23505]");
    expect(argumentSur(Object.assign(new Error("x"), { code: `SELECT '${JETON}'` }))).toBe(
      "[Error]",
    );
    expect(argumentSur({ token: JETON })).toBe("[Object]");
    expect(argumentSur(Object.create(null))).toBe("[inconnue]");
  });

  // Avant correction, « select [\s\S]* from » repartait de chaque « select »
  // jusqu'à la fin du texte : 1,7 s pour ce texte (mesure du 2026-10-22).
  test("coût linéaire : un long texte plein de mots-clés sans requête est traité vite", () => {
    const textes = [
      "a select ".repeat(11_000),
      "update ".repeat(14_000),
      "insert ".repeat(14_000),
      "delete ".repeat(14_000),
    ];
    for (const texte of textes) {
      const debut = performance.now();
      expect(argumentSur(texte)).toBe(texte);
      expect(performance.now() - debut).toBeLessThan(50);
    }
    const requete = `${"a select ".repeat(11_000)} from "session"`;
    expect(argumentSur(requete)).toBe("[texte retiré]");
  });

  test("valeur hostile (accesseur qui lève) : ligne fixe, jamais d'exception", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(JETON);
        },
        getPrototypeOf() {
          throw new Error(JETON);
        },
      },
    );
    expect(argumentSur(hostile)).toBe("[valeur retirée]");
  });
});
