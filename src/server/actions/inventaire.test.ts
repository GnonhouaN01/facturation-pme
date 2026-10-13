import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { declarerAction, estDeclaration } from "./action";
import { declarationExposee } from "./exposer";
import { REGISTRE } from "./registre";

// Aucune action ne contourne la chaîne (T-50, T-72) : chaque export de chaque
// src/app/**/actions.ts est une fonction d'exposer, dont la déclaration est
// marquée par declarerAction et inscrite au registre ; chaque route.ts est
// sur la liste admise. La même fonction parcourt le dépôt, qui doit passer,
// et des exemples de démonstration (tests/fixtures/inventaire/), qui doivent
// échouer. Fiche : docs/features/chaine-controles.md, section 7.

// Les fichiers importés chargent action.ts, donc env.ts et client.ts :
// valeurs factices, aucune connexion n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  // 8.3 : la route de la tâche quotidienne charge server/taches/, qui lit
  // le secret de la tâche ; aucun appel n'est fait.
  secretTache: { secret: null },
}));

const APP = fileURLToPath(new URL("../../app/", import.meta.url));
const DEMO = fileURLToPath(new URL("../../../tests/fixtures/inventaire/", import.meta.url));

// Liste fermée des gestionnaires de route, chacun avec sa fiche. Chemin du
// dossier sous src/app/, séparé par des « / ». La tâche quotidienne est
// servie par un segment dynamique, avec une liste fermée de tâches (8.3,
// docs/features/tache-quotidienne.md, section 2.1, décision 2).
const ROUTES_ADMISES: Readonly<Record<string, string>> = {
  "api/auth/[...all]": "PLAN.md 1.1 : exposition de /api/auth, après fermeture de /organization/*",
  "api/taches/[tache]":
    "PLAN.md 8.3 : tâche quotidienne, avec son propre contrôle (docs/features/tache-quotidienne.md)",
};

const ACTIONS = /^actions\.(ts|tsx|js|jsx|mjs|mts)$/;
const ROUTE = /^route\.(ts|tsx|js|jsx|mjs|mts)$/;

type Inventaire = { parcourus: string[]; problemes: string[] };

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name));
}

function versPosix(chemin: string): string {
  return chemin.split(sep).join("/");
}

// Problèmes du registre seul : déclaration non marquée, nom en double.
function problemesDuRegistre(registre: readonly unknown[]): string[] {
  const problemes: string[] = [];
  const vus = new Set<string>();
  registre.forEach((declaration, rang) => {
    if (!estDeclaration(declaration)) {
      problemes.push(`registre[${rang}] : déclaration non marquée par declarerAction`);
      return;
    }
    if (vus.has(declaration.nom)) problemes.push(`registre : nom en double ${declaration.nom}`);
    vus.add(declaration.nom);
  });
  return problemes;
}

// Parcourt racine (un dossier app/), importe chaque actions.ts et vérifie
// chaque export ; vérifie chaque route.ts contre la liste admise. Lève si le
// dossier n'existe pas : un parcours vide ne passe pas pour un succès.
async function inventorier(
  racine: string,
  registre: readonly unknown[],
  routesAdmises: Readonly<Record<string, string>> = ROUTES_ADMISES,
): Promise<Inventaire> {
  const parcourus = fichiers(racine).map((chemin) => versPosix(relative(racine, chemin)));
  const problemes = problemesDuRegistre(registre);

  for (const chemin of parcourus) {
    const morceaux = chemin.split("/");
    const nom = morceaux.at(-1) ?? "";
    const dossier = morceaux.slice(0, -1).join("/");

    if (ROUTE.test(nom) && !Object.hasOwn(routesAdmises, dossier)) {
      problemes.push(`${chemin} : route hors de la liste admise`);
    }

    if (!ACTIONS.test(nom)) continue;
    let charge: Record<string, unknown>;
    try {
      charge = (await import(pathToFileURL(join(racine, chemin)).href)) as Record<string, unknown>;
    } catch {
      // Une déclaration non marquée fait lever exposer au chargement.
      problemes.push(`${chemin} : chargement refusé`);
      continue;
    }
    for (const [exporte, valeur] of Object.entries(charge)) {
      const declaration = declarationExposee(valeur);
      if (declaration === undefined) {
        problemes.push(`${chemin} : ${exporte} n'est pas passé par exposer`);
      } else if (!estDeclaration(declaration)) {
        problemes.push(`${chemin} : ${exporte} porte une déclaration non marquée`);
      } else if (!registre.includes(declaration)) {
        problemes.push(`${chemin} : ${exporte} est absent du registre`);
      }
    }
  }

  return { parcourus, problemes };
}

describe("inventaire du dépôt", () => {
  test("src/app/ : aucun problème, et le parcours a bien eu lieu", async () => {
    const { parcourus, problemes } = await inventorier(APP, REGISTRE);

    expect(parcourus).toContain("layout.tsx");
    // 0.6, PR 3 (modifié, signalé) : l'accueil est déplacé dans la zone
    // publique (docs/features/socle-interface.md, section 1).
    expect(parcourus).toContain("(public)/page.tsx");
    expect(problemes).toEqual([]);
  });

  test("le registre : déclarations marquées, noms uniques", () => {
    expect(problemesDuRegistre(REGISTRE)).toEqual([]);
  });

  test("chaque route admise cite sa fiche", () => {
    for (const [route, fiche] of Object.entries(ROUTES_ADMISES)) {
      expect(fiche, route).toMatch(/^PLAN\.md \d+\.\d+ : /);
    }
  });
});

describe("inventaire de démonstration (tests/fixtures/inventaire/)", () => {
  async function demo(cas: string, registre: readonly unknown[] = []) {
    return inventorier(join(DEMO, cas), registre);
  }

  test("action exposée, déclaration marquée et inscrite au registre : aucun problème", async () => {
    const { demoAgir } = await import("../../../tests/fixtures/inventaire/declarations");

    const { parcourus, problemes } = await demo("correcte", [demoAgir]);

    expect(parcourus).toEqual(["essai/actions.ts"]);
    expect(problemes).toEqual([]);
  });

  test("la même action, absente du registre : refusée", async () => {
    expect((await demo("correcte")).problemes).toEqual([
      "essai/actions.ts : agir est absent du registre",
    ]);
  });

  test("action exposée hors du registre (une autre y figure) : refusée", async () => {
    const { demoAgir } = await import("../../../tests/fixtures/inventaire/declarations");

    expect((await demo("hors-registre", [demoAgir])).problemes).toEqual([
      "essai/actions.ts : autre est absent du registre",
    ]);
  });

  test("export async function, sans exposer : refusé", async () => {
    expect((await demo("export-brut")).problemes).toEqual([
      "essai/actions.ts : agirSansChaine n'est pas passé par exposer",
    ]);
  });

  test("export d'une valeur qui n'est pas une action : refusé", async () => {
    expect((await demo("valeur-exportee")).problemes).toEqual([
      "essai/actions.ts : reglage n'est pas passé par exposer",
    ]);
  });

  test("déclaration écrite à la main, exposée : refusée", async () => {
    const { problemes } = await demo("non-marquee");

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toMatch(
      /^essai\/actions\.ts : (chargement refusé|aLaMain porte une déclaration non marquée)$/,
    );
  });

  test("route.ts hors de la liste admise : refusé", async () => {
    expect((await demo("route-hors-liste")).problemes).toEqual([
      "api/autre/route.ts : route hors de la liste admise",
    ]);
  });

  test("route.ts de la liste admise : accepté", async () => {
    expect((await demo("route-admise")).problemes).toEqual([]);
  });

  test("registre avec une déclaration écrite à la main : refusé", async () => {
    const { declarationALaMain } = await import("../../../tests/fixtures/inventaire/declarations");

    expect((await demo("vide", [declarationALaMain])).problemes).toEqual([
      "registre[0] : déclaration non marquée par declarerAction",
    ]);
  });

  test("registre avec deux déclarations de même nom : refusé", async () => {
    const { demoAgir } = await import("../../../tests/fixtures/inventaire/declarations");
    const homonyme = declarerAction({ ...demoAgir });

    expect((await demo("vide", [demoAgir, homonyme])).problemes).toEqual([
      "registre : nom en double demo.inventaire_agir",
    ]);
  });

  test("dossier absent : lève, au lieu de passer à vide", async () => {
    await expect(demo("absent")).rejects.toThrow();
  });
});

// Un seul fichier de proxy : src/proxy.ts. Next.js en cherche un à la racine
// du projet ou de src/, sous le nom proxy ou middleware ; un second fichier,
// ou un fichier ailleurs que prévu, poserait une autre politique, ou aucune.
// Fiche : docs/features/socle-interface.md, section 7.
const RACINE = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = fileURLToPath(new URL("../../", import.meta.url));
const PROXY = /^(proxy|middleware)\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/;
const PROXY_ADMIS = "src/proxy.ts";

// chemins : relatifs à la racine du projet, séparés par des « / ».
function problemesDeProxy(chemins: readonly string[]): string[] {
  const proxys = chemins.filter((chemin) => PROXY.test(chemin.split("/").at(-1) ?? ""));
  const problemes = proxys
    .filter((chemin) => chemin !== PROXY_ADMIS)
    .map((chemin) => `${chemin} : fichier de proxy hors de ${PROXY_ADMIS}`);
  if (!proxys.includes(PROXY_ADMIS)) problemes.push(`${PROXY_ADMIS} : absent`);
  return problemes;
}

// Fichiers de la racine du projet (sans descendre), et tout src/.
function cheminsDuProjet(): string[] {
  const racine = readdirSync(RACINE, { withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => entree.name);
  const src = fichiers(SRC).map((chemin) => `src/${versPosix(relative(SRC, chemin))}`);
  return [...racine, ...src];
}

describe("fichier de proxy", () => {
  test("dépôt : src/proxy.ts existe et il est le seul", () => {
    const chemins = cheminsDuProjet();

    expect(chemins).toContain("package.json");
    expect(chemins).toContain("src/app/layout.tsx");
    expect(problemesDeProxy(chemins)).toEqual([]);
  });

  test.each([
    ["src/proxy.ts seul", ["src/proxy.ts", "src/proxy.test.ts"], []],
    ["absent", ["src/app/page.tsx"], ["src/proxy.ts : absent"]],
    [
      "middleware.ts à la racine, en plus",
      ["src/proxy.ts", "middleware.ts"],
      ["middleware.ts : fichier de proxy hors de src/proxy.ts"],
    ],
    [
      "src/middleware.ts, en plus",
      ["src/proxy.ts", "src/middleware.ts"],
      ["src/middleware.ts : fichier de proxy hors de src/proxy.ts"],
    ],
    [
      "proxy.ts à la racine au lieu de src/",
      ["proxy.ts"],
      ["proxy.ts : fichier de proxy hors de src/proxy.ts", "src/proxy.ts : absent"],
    ],
    [
      "src/proxy.js, en plus",
      ["src/proxy.ts", "src/proxy.js"],
      ["src/proxy.js : fichier de proxy hors de src/proxy.ts"],
    ],
    [
      "un proxy.ts dans un dossier de src/",
      ["src/proxy.ts", "src/app/proxy.ts"],
      ["src/app/proxy.ts : fichier de proxy hors de src/proxy.ts"],
    ],
  ])("démonstration, %s", (_nom, chemins, attendus) => {
    expect(problemesDeProxy(chemins)).toEqual(attendus);
  });
});

// Chaque page de la zone application se protège elle-même : son page.tsx
// appelle lirePourPage. Le gabarit ne protège pas (il n'est pas réexécuté à
// chaque navigation). Contrôle textuel, contournable à dessein (« Limites
// connues ») : un appel dont le résultat n'est pas utilisé passe. Les
// commentaires sont retirés avant la recherche : une mention ne suffit pas.
// Fiche : docs/features/socle-interface.md, sections 2.3 et 7.
const ZONE_APPLICATION = "(app)/";
const PAGE = /^page\.(ts|tsx|js|jsx|mjs|mts)$/;
const APPEL_LIRE_POUR_PAGE = /\blirePourPage\s*(<[^>]*>)?\s*\(/;

type Source = { chemin: string; contenu: string };

function sansCommentaires(contenu: string): string {
  return contenu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// chemins : relatifs à src/app/, séparés par des « / ».
function problemesDesPages(sources: readonly Source[]): string[] {
  return sources
    .filter(({ chemin }) => chemin.startsWith(ZONE_APPLICATION))
    .filter(({ chemin }) => PAGE.test(chemin.split("/").at(-1) ?? ""))
    .filter(({ contenu }) => !APPEL_LIRE_POUR_PAGE.test(sansCommentaires(contenu)))
    .map(({ chemin }) => `${chemin} : page de la zone application sans lirePourPage`);
}

function sourcesDeApp(): Source[] {
  return fichiers(APP).map((chemin) => ({
    chemin: versPosix(relative(APP, chemin)),
    contenu: readFileSync(chemin, "utf8"),
  }));
}

describe("pages de la zone application", () => {
  test("dépôt : le tableau de bord existe, et chaque page de (app)/ appelle lirePourPage", () => {
    const sources = sourcesDeApp();

    expect(sources.map(({ chemin }) => chemin)).toContain("(app)/tableau-de-bord/page.tsx");
    expect(problemesDesPages(sources)).toEqual([]);
  });

  const APPEL = `export default async function Page() {
  const donnees = await lirePourPage("clients.voir", async (ctx) => ctx.role);
  return <h1>{donnees}</h1>;
}`;

  test.each<[string, Source[], string[]]>([
    ["page qui appelle lirePourPage", [{ chemin: "(app)/clients/page.tsx", contenu: APPEL }], []],
    [
      "appel avec un paramètre de type",
      [
        {
          chemin: "(app)/clients/page.tsx",
          contenu: `const d = await lirePourPage<string>("clients.voir", lire);`,
        },
      ],
      [],
    ],
    [
      "page sans lirePourPage",
      [{ chemin: "(app)/clients/page.tsx", contenu: "export default function Page() {}" }],
      ["(app)/clients/page.tsx : page de la zone application sans lirePourPage"],
    ],
    [
      "lirePourPage importé mais jamais appelé",
      [
        {
          chemin: "(app)/clients/page.tsx",
          contenu: `import { lirePourPage } from "@/server/actions/exposer";\nexport default function Page() {}`,
        },
      ],
      ["(app)/clients/page.tsx : page de la zone application sans lirePourPage"],
    ],
    [
      "appel seulement dans un commentaire",
      [
        {
          chemin: "(app)/clients/page.tsx",
          contenu: `// lirePourPage("clients.voir", lire)\n/* lirePourPage(\"x\") */\nexport default function Page() {}`,
        },
      ],
      ["(app)/clients/page.tsx : page de la zone application sans lirePourPage"],
    ],
    [
      "page imbriquée, en .jsx",
      [{ chemin: "(app)/clients/[id]/modifier/page.jsx", contenu: "export default () => null;" }],
      ["(app)/clients/[id]/modifier/page.jsx : page de la zone application sans lirePourPage"],
    ],
    [
      "le gabarit, un composant et les pages hors de la zone : non concernés",
      [
        { chemin: "(app)/layout.tsx", contenu: "export default function L() {}" },
        { chemin: "(app)/clients/tableau.tsx", contenu: "export function T() {}" },
        { chemin: "(public)/page.tsx", contenu: "export default function P() {}" },
        { chemin: "lien/devis/[jeton]/page.tsx", contenu: "export default function P() {}" },
      ],
      [],
    ],
  ])("démonstration, %s", (_nom, sources, attendus) => {
    expect(problemesDesPages(sources)).toEqual(attendus);
  });
});

// Forme exacte de la route de la tâche quotidienne : un import, un seul
// export GET, égal à traiterTache. Tout le contrôle vit dans
// src/server/taches/quotidienne.ts (secret, liste fermée, réponses). Fiche :
// docs/features/tache-quotidienne.md, section 2.1, test 6.
const ROUTE_TACHES = join(APP, "api", "taches", "[tache]", "route.ts");
const FORME_ROUTE_TACHES = [
  'import { traiterTache } from "@/server/taches/quotidienne";',
  "export const GET = traiterTache;",
];

describe("route de la tâche quotidienne", () => {
  test("src/app/api/taches/[tache]/route.ts est parcourue par l'inventaire", async () => {
    const { parcourus } = await inventorier(APP, REGISTRE);

    expect(parcourus).toContain("api/taches/[tache]/route.ts");
  });

  test("forme exacte : un import, export const GET = traiterTache, commentaires mis à part", () => {
    const lignes = readFileSync(ROUTE_TACHES, "utf8")
      .split("\n")
      .map((ligne) => ligne.trim())
      .filter((ligne) => ligne !== "" && !ligne.startsWith("//"));

    expect(lignes).toEqual(FORME_ROUTE_TACHES);
  });

  test("le module n'exporte que GET, égal à traiterTache", async () => {
    const route = (await import(pathToFileURL(ROUTE_TACHES).href)) as Record<string, unknown>;
    const { traiterTache } = await import("../taches/quotidienne");

    expect(Object.keys(route)).toEqual(["GET"]);
    expect(route.GET).toBe(traiterTache);
  });
});

// Forme exacte de la route de /api/auth : un import, GET et POST égaux à
// traiterRequeteAuth. Tout le contrôle vit dans src/server/auth/
// (gestionnaire.ts lie points-entree.ts à Better Auth) : liste fermée,
// origine, validation, réponses normalisées. Fiche :
// docs/features/inscription.md, section 2.2.
const ROUTE_AUTH = join(APP, "api", "auth", "[...all]", "route.ts");
const FORME_ROUTE_AUTH = [
  'import { traiterRequeteAuth } from "@/server/auth/gestionnaire";',
  "export const GET = traiterRequeteAuth;",
  "export const POST = traiterRequeteAuth;",
];

describe("route de /api/auth", () => {
  test("src/app/api/auth/[...all]/route.ts est parcourue par l'inventaire", async () => {
    const { parcourus } = await inventorier(APP, REGISTRE);

    expect(parcourus).toContain("api/auth/[...all]/route.ts");
  });

  test("forme exacte : un import, GET et POST = traiterRequeteAuth, commentaires mis à part", () => {
    const lignes = readFileSync(ROUTE_AUTH, "utf8")
      .split("\n")
      .map((ligne) => ligne.trim())
      .filter((ligne) => ligne !== "" && !ligne.startsWith("//"));

    expect(lignes).toEqual(FORME_ROUTE_AUTH);
  });

  test("le module n'exporte que GET et POST, égaux à traiterRequeteAuth", async () => {
    const route = (await import(pathToFileURL(ROUTE_AUTH).href)) as Record<string, unknown>;
    const { traiterRequeteAuth } = await import("../auth/gestionnaire");

    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
    expect(route.GET).toBe(traiterRequeteAuth);
    expect(route.POST).toBe(traiterRequeteAuth);
  });
});
