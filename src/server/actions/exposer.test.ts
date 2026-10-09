import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { executerChaine, type DeclarationAction } from "./action";
import { declarationExposee, exposer } from "./exposer";
import type { Resultat } from "./refus";

// L'adaptateur Next.js, sans Next.js : headers() et la chaîne sont remplacés
// par des espions. La chaîne elle-même est testée par action.test.ts. Fiche :
// docs/features/chaine-controles.md, sections 3.2 et 7.

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("./action", () => ({ executerChaine: vi.fn() }));

const lireEntetes = vi.mocked(headers);
const chaine = vi.mocked(executerChaine);

const ORIGINE = "https://facturation.exemple.ci";

// Déclaration écrite à la main : declarerAction n'est pas en jeu ici.
function declaration(): DeclarationAction<ReturnType<typeof schema>, null, string> {
  return {
    nom: "demo.exposee",
    droit: "organisation.membres.voir",
    entree: schema(),
    journal: null,
    nouvelleAuthentification: false,
    executer: async () => "fait",
  };
}

function schema() {
  return z.strictObject({ nom: z.string() });
}

beforeEach(() => {
  lireEntetes.mockReset();
  chaine.mockReset();
  lireEntetes.mockResolvedValue(
    new Headers({ origin: ORIGINE, cookie: "jeton=valeur" }) as Awaited<ReturnType<typeof headers>>,
  );
  chaine.mockResolvedValue({ ok: true, donnees: "fait" });
});

describe("exposer : la fonction renvoyée", () => {
  test("est une fonction async, et rien n'est lu à la déclaration", () => {
    const action = exposer(declaration());

    expect(typeof action).toBe("function");
    expect(action.constructor.name).toBe("AsyncFunction");
    expect(lireEntetes).not.toHaveBeenCalled();
    expect(chaine).not.toHaveBeenCalled();
  });

  test("à l'appel : lit les en-têtes de la requête, appelle la chaîne avec la déclaration et l'entrée reçue", async () => {
    const decl = declaration();
    const entree = { nom: "Awa" };

    await exposer(decl)(entree);

    expect(lireEntetes).toHaveBeenCalledTimes(1);
    expect(chaine).toHaveBeenCalledTimes(1);
    const [declRecue, requete, entreeRecue] = chaine.mock.calls[0]!;
    expect(declRecue).toBe(decl);
    expect(entreeRecue).toBe(entree);
    expect(requete.entetes.get("origin")).toBe(ORIGINE);
    expect(requete.entetes.get("cookie")).toBe("jeton=valeur");
  });

  test.each<[string, Resultat<string>]>([
    ["succès", { ok: true, donnees: "fait" }],
    ["refus", { ok: false, raison: "refuse" }],
    ["invalide", { ok: false, raison: "invalide", champs: ["nom"] }],
    ["erreur", { ok: false, raison: "erreur", incident: "6f1c3c1e-8a3d-4c5b-9f0e-2d7a1b4c5e6f" }],
  ])("renvoie le résultat de la chaîne tel quel : %s", async (_nom, resultat) => {
    chaine.mockResolvedValueOnce(resultat);

    expect(await exposer(declaration())({ nom: "Awa" })).toStrictEqual(resultat);
  });

  test.each([
    ["redirect()", () => redirect("/connexion")],
    ["notFound()", () => notFound()],
  ])("%s levé par la chaîne : relancé tel quel", async (_nom, lever) => {
    let erreur: unknown;
    try {
      lever();
    } catch (levee) {
      erreur = levee;
    }
    chaine.mockRejectedValueOnce(erreur);

    await expect(exposer(declaration())({ nom: "Awa" })).rejects.toBe(erreur);
  });
});

describe("la marque lue par l'inventaire (section 7)", () => {
  test("une fonction renvoyée par exposer porte sa déclaration", () => {
    const decl = declaration();

    expect(declarationExposee(exposer(decl))).toBe(decl);
  });

  test("deux expositions de la même déclaration : deux fonctions, toutes deux marquées", () => {
    const decl = declaration();
    const premiere = exposer(decl);
    const seconde = exposer(decl);

    expect(premiere).not.toBe(seconde);
    expect(declarationExposee(premiere)).toBe(decl);
    expect(declarationExposee(seconde)).toBe(decl);
  });

  test.each([
    ["fonction async quelconque", async () => "fait"],
    [
      "fonction avec une propriété declaration",
      Object.assign(async () => "fait", { declaration: declaration() }),
    ],
    ["objet", { declaration: declaration() }],
    ["null", null],
    ["undefined", undefined],
    ["chaîne", "demo.exposee"],
  ])("%s : non marquée", (_nom, valeur) => {
    expect(declarationExposee(valeur)).toBeUndefined();
  });

  test("la marque est un symbole privé, absent du registre global", () => {
    const action = exposer(declaration());
    const symboles = Object.getOwnPropertySymbols(action);

    expect(symboles.length).toBeGreaterThan(0);
    for (const symbole of symboles) {
      expect(Symbol.keyFor(symbole)).toBeUndefined();
    }
  });
});
