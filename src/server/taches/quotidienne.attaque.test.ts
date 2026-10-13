import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { validerSecretTache } from "@/server/env-schema";

import { creerTraitementTache } from "./quotidienne";

// T-45 : un appel sans le secret, avec un secret forgé ou mal formé, ou vers
// une tâche inconnue, reçoit exactement la réponse d'une tâche inexistante
// (statut, en-têtes, corps lu en octets), sans aucune étape lancée et sans
// rien écrire au journal. Fiche : docs/features/tache-quotidienne.md,
// section 2.1, tests 2 et 3a.

// quotidienne.ts charge les vraies étapes, donc env.ts et client.ts : valeurs
// factices, aucune connexion n'est ouverte.
vi.mock("@/server/env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  secretTache: { secret: null },
}));

const SECRET = randomBytes(32).toString("base64url");

type Traitement = ReturnType<typeof creerTraitementTache>;

async function appeler(
  traiter: Traitement,
  nom: string,
  options: { autorisation?: string; requete?: string } = {},
): Promise<Response> {
  const entetes = new Headers();
  if (options.autorisation !== undefined) entetes.set("authorization", options.autorisation);
  const adresse = `https://facturation.exemple.ci/api/taches/${encodeURIComponent(nom)}${options.requete ?? ""}`;
  return traiter(new Request(adresse, { headers: entetes }), {
    params: Promise.resolve({ tache: nom }),
  });
}

type Forme = { statut: number; entetes: [string, string][]; corps: number[] };

async function forme(reponse: Response): Promise<Forme> {
  return {
    statut: reponse.status,
    entetes: [...reponse.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    corps: [...new Uint8Array(await reponse.arrayBuffer())],
  };
}

function inconnue(): string {
  return randomBytes(8).toString("hex");
}

let espions: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  espions = (["log", "info", "warn", "error", "debug"] as const).map((niveau) =>
    vi.spyOn(console, niveau).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function journalVide(): void {
  for (const espion of espions) expect(espion).not.toHaveBeenCalled();
}

describe("refus : la réponse d'une tâche inexistante, octet pour octet", () => {
  const DERNIER = SECRET.at(-1) === "A" ? "B" : "A";
  const REFUS: [string, string, { autorisation?: string; requete?: string }][] = [
    ["sans Authorization", "quotidienne", {}],
    [
      "secret forgé",
      "quotidienne",
      { autorisation: `Bearer ${randomBytes(32).toString("base64url")}` },
    ],
    [
      "dernier caractère différent",
      "quotidienne",
      { autorisation: `Bearer ${SECRET.slice(0, -1)}${DERNIER}` },
    ],
    ["bearer en minuscules", "quotidienne", { autorisation: `bearer ${SECRET}` }],
    ["espace en trop", "quotidienne", { autorisation: `Bearer  ${SECRET}` }],
    ["secret seul", "quotidienne", { autorisation: SECRET }],
    ["secret dans la requête", "quotidienne", { requete: `?secret=${SECRET}` }],
    [
      "Authorization dans la requête",
      "quotidienne",
      { requete: `?authorization=Bearer%20${SECRET}` },
    ],
    ["secret juste, tâche inconnue", inconnue(), { autorisation: `Bearer ${SECRET}` }],
    ["secret juste, QUOTIDIENNE", "QUOTIDIENNE", { autorisation: `Bearer ${SECRET}` }],
    ["secret juste, quotidienne.", "quotidienne.", { autorisation: `Bearer ${SECRET}` }],
    ["secret juste, __proto__", "__proto__", { autorisation: `Bearer ${SECRET}` }],
    ["secret juste, constructor", "constructor", { autorisation: `Bearer ${SECRET}` }],
    ["secret juste, toString", "toString", { autorisation: `Bearer ${SECRET}` }],
  ];

  test.each(REFUS)("%s : refusé, aucune étape, rien au journal", async (_nom, nom, options) => {
    const etape = vi.fn(async () => true);
    const traiter = creerTraitementTache({ secret: SECRET, taches: { quotidienne: etape } });
    const reference = await forme(await appeler(traiter, inconnue()));

    const recue = await forme(await appeler(traiter, nom, options));

    expect(recue).toEqual(reference);
    expect(reference.statut).toBe(404);
    expect(reference.corps).toEqual([]);
    expect(etape).not.toHaveBeenCalled();
    journalVide();
  });

  test("la réponse inexistante : 404, corps vide, Cache-Control: no-store et rien d'autre", async () => {
    const traiter = creerTraitementTache({ secret: SECRET, taches: {} });

    expect(await forme(await appeler(traiter, inconnue()))).toEqual({
      statut: 404,
      entetes: [["cache-control", "no-store"]],
      corps: [],
    });
  });

  test("témoin : le secret juste sur quotidienne lance la tâche", async () => {
    const etape = vi.fn(async () => true);
    const traiter = creerTraitementTache({ secret: SECRET, taches: { quotidienne: etape } });

    const reponse = await appeler(traiter, "quotidienne", { autorisation: `Bearer ${SECRET}` });

    expect(reponse.status).toBe(200);
    expect(etape).toHaveBeenCalledTimes(1);
  });
});

describe("CRON_SECRET absente en prévisualisation : tout appel est refusé", () => {
  const { secret } = validerSecretTache({ VERCEL_ENV: "preview", NODE_ENV: "production" });

  test("la configuration lue donne un secret nul", () => {
    expect(secret).toBeNull();
  });

  test.each([
    ["sans Authorization", undefined],
    ["Bearer et une espace", "Bearer "],
    ["Bearer null", "Bearer null"],
    ["Bearer undefined", "Bearer undefined"],
    ["Bearer suivi d'un secret quelconque", `Bearer ${randomBytes(32).toString("base64url")}`],
  ])("%s : réponse inexistante, aucune étape", async (_nom, autorisation) => {
    const etape = vi.fn(async () => true);
    const traiter = creerTraitementTache({ secret, taches: { quotidienne: etape } });
    const reference = await forme(await appeler(traiter, inconnue()));

    const recue = await forme(
      await appeler(traiter, "quotidienne", autorisation === undefined ? {} : { autorisation }),
    );

    expect(recue).toEqual(reference);
    expect(recue.statut).toBe(404);
    expect(etape).not.toHaveBeenCalled();
    journalVide();
  });
});
