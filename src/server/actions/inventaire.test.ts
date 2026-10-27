import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { declarerAction, estDeclaration, estDeclarationCompte } from "./action";
import { declarationExposee } from "./exposer";
import { REGISTRE, REGISTRE_COMPTE } from "./registre";

// Les deux registres (2.1 : actions de compte, docs/features/organisations.md,
// section 3), parcourus ensemble : noms uniques sur les deux.
const REGISTRES: readonly unknown[] = [...REGISTRE, ...REGISTRE_COMPTE];

function estMarquee(valeur: unknown): boolean {
  return estDeclaration(valeur) || estDeclarationCompte(valeur);
}

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
  // 1.1 : la route de /api/auth charge server/auth/gestionnaire.ts, qui lit
  // la production dans la configuration d'envoi ; aucun appel n'est fait.
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
    gmail: null,
  },
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
    if (!estMarquee(declaration)) {
      problemes.push(`registre[${rang}] : déclaration non marquée par declarerAction`);
      return;
    }
    const { nom } = declaration as { nom: string };
    if (vus.has(nom)) problemes.push(`registre : nom en double ${nom}`);
    vus.add(nom);
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
      } else if (!estMarquee(declaration)) {
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
    const { parcourus, problemes } = await inventorier(APP, REGISTRES);

    expect(parcourus).toContain("layout.tsx");
    // 0.6, PR 3 (modifié, signalé) : l'accueil est déplacé dans la zone
    // publique (docs/features/socle-interface.md, section 1).
    expect(parcourus).toContain("(public)/page.tsx");
    expect(problemes).toEqual([]);
  });

  test("le registre : déclarations marquées, noms uniques", () => {
    expect(problemesDuRegistre(REGISTRES)).toEqual([]);
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

  test("action de compte exposée et inscrite (2.1) : aucun problème ; absente : refusée", async () => {
    const { demoCompte } = await import("../../../tests/fixtures/inventaire/declarations");

    expect((await demo("compte", [demoCompte])).problemes).toEqual([]);
    expect((await demo("compte")).problemes).toEqual([
      "essai/actions.ts : agirCompte est absent du registre",
    ]);
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

// Zone (compte) de la 1.2 : pages d'un utilisateur connecté, sans
// organisation. Chaque page.tsx appelle lireComptePourPage elle-même (le
// gabarit ne protège pas) ; aucune métadonnée propre ni loading.* dans la
// zone (le titre fuirait sur la page « introuvable », et notFound()
// répondrait 200). Même contrôle textuel que pour (app)/. Fiche :
// docs/features/connexion.md, section 5.1, test 12.
const ZONE_COMPTE = "(compte)/";
const APPEL_LIRE_COMPTE = /\blireComptePourPage\s*(<[^>]*>)?\s*\(/;
const CHARGEMENT = /^loading\.(ts|tsx|js|jsx|mjs|mts)$/;
const METADONNEES =
  /\bexport\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b|const\s+generateMetadata\b)/;

function problemesDeLaZoneCompte(sources: readonly Source[]): string[] {
  const problemes: string[] = [];
  for (const { chemin, contenu } of sources) {
    if (!chemin.startsWith(ZONE_COMPTE)) continue;
    const nom = chemin.split("/").at(-1) ?? "";
    const code = sansCommentaires(contenu);
    if (PAGE.test(nom) && !APPEL_LIRE_COMPTE.test(code)) {
      problemes.push(`${chemin} : page de la zone compte sans lireComptePourPage`);
    }
    if (CHARGEMENT.test(nom)) problemes.push(`${chemin} : loading interdit dans la zone compte`);
    if (METADONNEES.test(code))
      problemes.push(`${chemin} : métadonnées propres dans la zone compte`);
  }
  return problemes;
}

describe("pages de la zone compte (1.2)", () => {
  test("dépôt : /compte existe, et chaque page de (compte)/ appelle lireComptePourPage", () => {
    const sources = sourcesDeApp();

    expect(sources.map(({ chemin }) => chemin)).toContain("(compte)/compte/page.tsx");
    expect(sources.map(({ chemin }) => chemin)).toContain("(compte)/layout.tsx");
    expect(problemesDeLaZoneCompte(sources)).toEqual([]);
  });

  // 1.4 : la page d'activation et de gestion de la double authentification
  // (docs/features/double-authentification.md, section 11, test 18).
  test("dépôt : /compte/double-authentification existe dans la zone compte et appelle lireComptePourPage", () => {
    const sources = sourcesDeApp();
    expect(sources.map(({ chemin }) => chemin)).toContain(
      "(compte)/compte/double-authentification/page.tsx",
    );
    expect(problemesDeLaZoneCompte(sources)).toEqual([]);
  });

  // 1.5 : le profil et les sessions (docs/features/profil-sessions.md,
  // section 9, test 11).
  test.each(["(compte)/compte/profil/page.tsx", "(compte)/compte/sessions/page.tsx"])(
    "dépôt : %s existe dans la zone compte et appelle lireComptePourPage",
    (page) => {
      const sources = sourcesDeApp();
      expect(sources.map(({ chemin }) => chemin)).toContain(page);
      expect(problemesDeLaZoneCompte(sources)).toEqual([]);
    },
  );

  test.each<[string, Source[], string[]]>([
    [
      "page qui appelle lireComptePourPage",
      [
        {
          chemin: "(compte)/compte/page.tsx",
          contenu: "const c = await lireComptePourPage(async (compte) => compte);",
        },
      ],
      [],
    ],
    [
      "page sans lireComptePourPage",
      [{ chemin: "(compte)/compte/page.tsx", contenu: "export default function P() {}" }],
      ["(compte)/compte/page.tsx : page de la zone compte sans lireComptePourPage"],
    ],
    [
      "lirePourPage au lieu de lireComptePourPage",
      [
        {
          chemin: "(compte)/compte/page.tsx",
          contenu: `await lirePourPage("organisation.membres.voir", lire);`,
        },
      ],
      ["(compte)/compte/page.tsx : page de la zone compte sans lireComptePourPage"],
    ],
    [
      "appel seulement dans un commentaire",
      [
        {
          chemin: "(compte)/compte/page.tsx",
          contenu: "// lireComptePourPage(lire)\nexport default function P() {}",
        },
      ],
      ["(compte)/compte/page.tsx : page de la zone compte sans lireComptePourPage"],
    ],
    [
      "loading.tsx dans la zone",
      [{ chemin: "(compte)/compte/loading.tsx", contenu: "export default () => null;" }],
      ["(compte)/compte/loading.tsx : loading interdit dans la zone compte"],
    ],
    [
      "métadonnées propres",
      [
        {
          chemin: "(compte)/compte/page.tsx",
          contenu:
            'export const metadata = { title: "Compte" };\nawait lireComptePourPage(async () => null);',
        },
        {
          chemin: "(compte)/layout.tsx",
          contenu: "export async function generateMetadata() { return {}; }",
        },
      ],
      [
        "(compte)/compte/page.tsx : métadonnées propres dans la zone compte",
        "(compte)/layout.tsx : métadonnées propres dans la zone compte",
      ],
    ],
    [
      "hors de la zone : non concernés",
      [
        { chemin: "(public)/connexion/page.tsx", contenu: "export default function P() {}" },
        { chemin: "(compte)/compte/bouton.tsx", contenu: "export function B() {}" },
      ],
      [],
    ],
  ])("démonstration, %s", (_nom, sources, attendus) => {
    expect(problemesDeLaZoneCompte(sources)).toEqual(attendus);
  });
});

// Correctif de la 1.2 : chaque page de la connexion et de l'inscription
// appelle redirigerSiConnecte (un utilisateur connecté va sur /compte), sauf
// « Adresse vérifiée », qui s'adresse justement à l'utilisateur dont la
// vérification vient d'ouvrir la session. Fiche : docs/features/connexion.md,
// section 5.2. Modifié en 1.3 : « mot de passe oublié » rejoint la liste
// (docs/features/mot-de-passe.md, section 7, test 17).
const PAGES_SANS_SESSION = /^\(public\)\/(connexion|inscription|mot-de-passe-oublie)(\/|$)/;
const EXCEPTIONS_REDIRECTION = new Set(["(public)/inscription/verifiee/page.tsx"]);
const APPEL_REDIRIGER = /\bredirigerSiConnecte\s*\(/;

function problemesDeRedirection(sources: readonly Source[]): string[] {
  return sources
    .filter(({ chemin }) => PAGES_SANS_SESSION.test(chemin))
    .filter(({ chemin }) => PAGE.test(chemin.split("/").at(-1) ?? ""))
    .filter(({ chemin }) => !EXCEPTIONS_REDIRECTION.has(chemin))
    .filter(({ contenu }) => !APPEL_REDIRIGER.test(sansCommentaires(contenu)))
    .map(({ chemin }) => `${chemin} : page sans redirigerSiConnecte`);
}

describe("pages de connexion et d'inscription : utilisateur connecté redirigé (correctif 1.2)", () => {
  test("dépôt : chaque page concernée appelle redirigerSiConnecte", () => {
    const sources = sourcesDeApp();
    const concernees = sources
      .map(({ chemin }) => chemin)
      .filter(
        (chemin) => PAGES_SANS_SESSION.test(chemin) && PAGE.test(chemin.split("/").at(-1) ?? ""),
      )
      .sort();

    expect(concernees).toEqual([
      "(public)/connexion/nouveau-lien/page.tsx",
      "(public)/connexion/page.tsx",
      "(public)/inscription/envoyee/page.tsx",
      "(public)/inscription/page.tsx",
      "(public)/inscription/verifiee/page.tsx",
      "(public)/mot-de-passe-oublie/page.tsx",
    ]);
    expect(problemesDeRedirection(sources)).toEqual([]);
  });

  test.each<[string, Source[], string[]]>([
    [
      "page qui appelle redirigerSiConnecte",
      [{ chemin: "(public)/connexion/page.tsx", contenu: "await redirigerSiConnecte();" }],
      [],
    ],
    [
      "page sans l'appel",
      [
        {
          chemin: "(public)/inscription/envoyee/page.tsx",
          contenu: "export default function P() {}",
        },
      ],
      ["(public)/inscription/envoyee/page.tsx : page sans redirigerSiConnecte"],
    ],
    [
      "appel seulement dans un commentaire",
      [{ chemin: "(public)/connexion/page.tsx", contenu: "// redirigerSiConnecte()" }],
      ["(public)/connexion/page.tsx : page sans redirigerSiConnecte"],
    ],
    [
      "« Adresse vérifiée », l'accueil et la zone par lien : non concernés",
      [
        { chemin: "(public)/inscription/verifiee/page.tsx", contenu: "" },
        { chemin: "(public)/page.tsx", contenu: "" },
        { chemin: "lien/verification/page.tsx", contenu: "" },
      ],
      [],
    ],
  ])("démonstration, %s", (_nom, sources, attendus) => {
    expect(problemesDeRedirection(sources)).toEqual(attendus);
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

// 1.3 : les pages ouvertes par un lien d'email ne lisent jamais la session
// (zone par lien, docs/features/inscription.md, section 4.3) : ni
// redirection, ni lecture. Fiche : docs/features/mot-de-passe.md, section 3.4,
// test 17.
const LECTURES_DE_SESSION =
  /\b(redirigerSiConnecte|lireSession|lirePourPage|lireComptePourPage|getSession)\b|next\/headers/;

describe("zone par lien : aucune lecture de session (1.3)", () => {
  test("lien/verification et lien/reinitialisation existent et ne lisent pas la session", () => {
    const pages = sourcesDeApp().filter(({ chemin }) =>
      /^lien\/(verification|reinitialisation)\/page\.tsx$/.test(chemin),
    );
    expect(pages.map(({ chemin }) => chemin).sort()).toEqual([
      "lien/reinitialisation/page.tsx",
      "lien/verification/page.tsx",
    ]);
    for (const { chemin, contenu } of pages) {
      expect(LECTURES_DE_SESSION.test(sansCommentaires(contenu)), chemin).toBe(false);
    }
  });
});
