import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { lireSession } from "../auth/session";

import { declarerAction, executerChaine, type DeclarationAction } from "./action";
import {
  declarationExposee,
  ErreurPage,
  exposer,
  lireComptePourPage,
  redirigerSiConnecte,
  traduireLecture,
} from "./exposer";
import type { Resultat } from "./refus";

// L'adaptateur Next.js, sans Next.js : headers() et la chaîne sont remplacés
// par des espions. La chaîne elle-même est testée par action.test.ts. Fiche :
// docs/features/chaine-controles.md, sections 3.2 et 7.

vi.mock("next/headers", () => ({ headers: vi.fn() }));
// Zone (compte), 1.2 : la session est lue par lireSession, remplacée ici.
vi.mock("../auth/session", () => ({ lireSession: vi.fn() }));
// declarerAction est le vrai : il marque les déclarations (PR 3). Seule la
// chaîne est remplacée.
vi.mock("./action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action")>()),
  executerChaine: vi.fn(),
}));
// action.ts charge env.ts et client.ts : valeurs factices, aucune connexion
// n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const lireEntetes = vi.mocked(headers);
const chaine = vi.mocked(executerChaine);

const ORIGINE = "https://facturation.exemple.ci";

// Déclaration marquée, par declarerAction.
function declaration(): DeclarationAction<ReturnType<typeof schema>, null, string> {
  return declarerAction(champsDeclaration());
}

// Mêmes champs, écrits à la main : aucune marque.
function declarationEcriteALaMain(): DeclarationAction<ReturnType<typeof schema>, null, string> {
  return champsDeclaration();
}

function champsDeclaration(): DeclarationAction<ReturnType<typeof schema>, null, string> {
  return {
    nom: "demo.exposee",
    droit: "organisation.membres.voir",
    entree: schema(),
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: [],
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

// PR 3 : déclarations marquées. Fiche : section 7, « Déclarations marquées ».
describe("exposer : déclaration non marquée refusée", () => {
  test("une déclaration écrite à la main est refusée, la même par declarerAction est acceptée", () => {
    expect(() => exposer(declaration())).not.toThrow();
    expect(() => exposer(declarationEcriteALaMain())).toThrow();
  });

  test("une copie d'une déclaration marquée est refusée", () => {
    const copie = { ...declaration() };

    expect(() => exposer(copie)).toThrow();
  });

  test("le refus a lieu à l'exposition, sans lecture des en-têtes ni appel de la chaîne", () => {
    expect(() => exposer(declarationEcriteALaMain())).toThrow();
    expect(lireEntetes).not.toHaveBeenCalled();
    expect(chaine).not.toHaveBeenCalled();
  });
});

// Fonctionnalité 0.6, PR 3 : traduction d'une lecture pour une page. Fiche :
// docs/features/socle-interface.md, sections 2.1 et 4.2.
describe("traduireLecture", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // Erreur levée par une fonction, pour la comparer à celle de notFound().
  function leveeDe(fonction: () => unknown): unknown {
    try {
      fonction();
    } catch (erreur) {
      return erreur;
    }
    throw new Error("rien n'a été levé");
  }

  const digestDe = (erreur: unknown) => (erreur as { digest?: unknown }).digest;
  const NOT_FOUND = digestDe(leveeDe(() => notFound()));

  test("ok : renvoie les données elles-mêmes", () => {
    const donnees = { role: "lecteur", entrees: [] };

    expect(traduireLecture({ ok: true, donnees })).toBe(donnees);
  });

  test.each(["refuse", "connexion_requise"] as const)(
    "%s : notFound(), la page « introuvable » (S-02, décision 1)",
    (raison) => {
      const erreur = leveeDe(() => traduireLecture({ ok: false, raison }));

      expect(NOT_FOUND).toEqual(expect.any(String));
      expect(digestDe(erreur)).toBe(NOT_FOUND);
    },
  );

  test("refuse et connexion_requise : la même erreur, sans rien qui les distingue", () => {
    const refuse = leveeDe(() => traduireLecture({ ok: false, raison: "refuse" })) as Error;
    const connexion = leveeDe(() =>
      traduireLecture({ ok: false, raison: "connexion_requise" }),
    ) as Error;

    expect(digestDe(refuse)).toBe(NOT_FOUND);
    expect(connexion.constructor).toBe(refuse.constructor);
    expect(connexion.message).toBe(refuse.message);
    expect(digestDe(connexion)).toBe(digestDe(refuse));
  });

  test("erreur : ErreurPage, dont le digest est l'incident", () => {
    const incident = "6f1c3c1e-8a3d-4c5b-9f0e-2d7a1b4c5e6f";

    const erreur = leveeDe(() => traduireLecture({ ok: false, raison: "erreur", incident }));

    expect(erreur).toBeInstanceOf(ErreurPage);
    expect(erreur).toBeInstanceOf(Error);
    expect(digestDe(erreur)).toBe(incident);
  });

  test("erreur : message fixe, qui ne contient pas l'incident, et sans cause", () => {
    // Incident chargé de marqueurs : il ne doit apparaître que dans le digest.
    const marque = "SELECT postgresql://x@y/z DATABASE_URL a@b.ci";
    const premiere = leveeDe(() =>
      traduireLecture({ ok: false, raison: "erreur", incident: marque }),
    ) as Error;
    const seconde = leveeDe(() =>
      traduireLecture({ ok: false, raison: "erreur", incident: "autre-incident" }),
    ) as Error;

    expect(premiere).toBeInstanceOf(ErreurPage);
    expect(seconde).toBeInstanceOf(ErreurPage);
    expect(premiere.message).toBe(seconde.message);
    expect(premiere.message).not.toContain("SELECT");
    expect(premiere.message).not.toContain("postgresql");
    expect(premiere.message).not.toContain("autre-incident");
    expect(premiere.cause).toBeUndefined();
    expect(Object.hasOwn(premiere, "cause")).toBe(false);
  });

  test("trop_de_requetes : traité comme erreur, avec un nouvel incident à chaque fois", () => {
    const premiere = leveeDe(() => traduireLecture({ ok: false, raison: "trop_de_requetes" }));
    const seconde = leveeDe(() => traduireLecture({ ok: false, raison: "trop_de_requetes" }));

    expect(premiere).toBeInstanceOf(ErreurPage);
    expect(digestDe(premiere)).toMatch(UUID);
    expect(digestDe(seconde)).toMatch(UUID);
    expect(digestDe(premiere)).not.toBe(digestDe(seconde));
    expect((premiere as Error).cause).toBeUndefined();
  });
});

// Zone (compte) de la 1.2 : pages d'un utilisateur connecté, sans
// organisation. Fiche : docs/features/connexion.md, section 5.1, test 12.
describe("lireComptePourPage", () => {
  const session = vi.mocked(lireSession);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function leveeDe(fonction: () => Promise<unknown>): Promise<unknown> {
    return fonction().then(
      () => {
        throw new Error("rien n'a été levé");
      },
      (erreur: unknown) => erreur,
    );
  }

  const digestDe = (erreur: unknown) => (erreur as { digest?: unknown }).digest;

  async function digestNotFound(): Promise<unknown> {
    try {
      notFound();
    } catch (erreur) {
      return digestDe(erreur);
    }
    return undefined;
  }

  beforeEach(() => {
    session.mockReset();
  });

  test("sans session : la page « introuvable » (notFound), lire jamais appelée", async () => {
    session.mockResolvedValue(null);
    const lire = vi.fn(async () => "donnees");

    const erreur = await leveeDe(() => lireComptePourPage(lire));

    expect(digestDe(erreur)).toBe(await digestNotFound());
    expect(lire).not.toHaveBeenCalled();
  });

  test("avec session : lire ne reçoit que l'identifiant de l'utilisateur, aucune organisation", async () => {
    session.mockResolvedValue({
      utilisateurId: "0d6f6c4e-1d1e-4a57-9a51-3f2a7f0b9c11",
      organisationActiveId: "6f1c3c1e-8a3d-4c5b-9f0e-2d7a1b4c5e6f",
      // La zone compte reste ouverte sans second facteur : c'est là qu'on
      // l'active (docs/features/double-authentification.md, section 9).
      doubleAuthentification: false,
    });
    const lire = vi.fn(async (compte: unknown) => compte);

    const lu = await lireComptePourPage(lire);

    expect(lu).toStrictEqual({ utilisateurId: "0d6f6c4e-1d1e-4a57-9a51-3f2a7f0b9c11" });
    expect(lire).toHaveBeenCalledTimes(1);
  });

  test("la session est lue avec les en-têtes de la requête", async () => {
    session.mockResolvedValue(null);
    await leveeDe(() => lireComptePourPage(async () => null));
    expect(session).toHaveBeenCalledTimes(1);
    expect(session.mock.calls[0]?.[0].get("cookie")).toBe("jeton=valeur");
  });

  test("lecture de la session en échec : ErreurPage avec un incident, sans cause ni message de l'erreur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    session.mockRejectedValue(new Error("Failed query: select ... params: jeton"));
    const lire = vi.fn(async () => "donnees");

    const erreur = await leveeDe(() => lireComptePourPage(lire));

    expect(erreur).toBeInstanceOf(ErreurPage);
    expect(digestDe(erreur)).toMatch(UUID);
    expect((erreur as Error).message).not.toContain("Failed query");
    expect((erreur as Error).cause).toBeUndefined();
    expect(lire).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

// Correctif de la 1.2 (constat sur la prévisualisation) : les pages de
// connexion et d'inscription redirigent un utilisateur connecté vers
// /compte, par une lecture de session côté serveur. Sans session, ou avec
// une session illisible, rien ne change. Fiche : docs/features/connexion.md,
// section 5.2.
describe("redirigerSiConnecte", () => {
  const session = vi.mocked(lireSession);

  async function issue(): Promise<unknown> {
    try {
      await redirigerSiConnecte();
      return "affichee";
    } catch (erreur) {
      return erreur;
    }
  }

  function digestRedirection(): unknown {
    try {
      redirect("/compte");
    } catch (erreur) {
      return (erreur as { digest?: unknown }).digest;
    }
    return undefined;
  }

  beforeEach(() => {
    session.mockReset();
  });

  test("session valide : redirection vers /compte", async () => {
    session.mockResolvedValue({
      utilisateurId: "u",
      organisationActiveId: null,
      doubleAuthentification: false,
    });
    const erreur = await issue();
    expect((erreur as { digest?: unknown }).digest).toBe(digestRedirection());
  });

  test("sans session (absente, invalide, adresse non vérifiée) : la page s'affiche", async () => {
    session.mockResolvedValue(null);
    expect(await issue()).toBe("affichee");
  });

  test("lecture de la session en échec : la page s'affiche, sans erreur ni cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    session.mockRejectedValue(new Error("Failed query: select ... params: jeton"));
    expect(await issue()).toBe("affichee");
    vi.restoreAllMocks();
  });

  test("la session est lue avec les en-têtes de la requête", async () => {
    session.mockResolvedValue(null);
    await issue();
    expect(session.mock.calls[0]?.[0].get("cookie")).toBe("jeton=valeur");
  });
});
