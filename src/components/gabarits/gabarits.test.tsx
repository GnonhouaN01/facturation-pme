import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ROLES } from "@/server/autorisation/matrice";
import { entreesVisibles, type EntreeNavigation } from "@/server/autorisation/navigation";
import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_NAVIGATION } from "@/textes/navigation";
import { TEXTES_SIMULATION } from "@/textes/simulation";

import { BandeauSimulation } from "./bandeau-simulation";
import { GabaritApplication } from "./gabarit-application";
import { Navigation } from "./navigation";

// Le gabarit de l'application, rendu en chaîne par react-dom/server, sans
// navigateur ni session (voie B, décision 27). Ce que la page connectée donne
// à voir dans un navigateur (largeurs, cibles, focus) est repris par la 1.2.
// Fiche : docs/features/socle-interface.md, sections 2.4 et 10.

// L'adresse courante, lue par la navigation pour marquer l'entrée active.
vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
const adresse = vi.mocked(usePathname);

// Libellés de démonstration : en 0.6, seul « Tableau de bord » existe. Les
// libellés livrés restent présents.
vi.mock("@/textes/navigation", async (importOriginal) => {
  const { TEXTES_NAVIGATION: livres } =
    await importOriginal<typeof import("@/textes/navigation")>();
  return {
    TEXTES_NAVIGATION: {
      ...livres,
      entrees: {
        ...livres.entrees,
        demoOuverte: "Démo ouverte",
        demoCatalogue: "Démo catalogue",
        demoSupprimer: "Démo supprimer",
        demoClients: "Démo clients",
        demoFactures: "Démo factures",
        demoExport: "Démo export",
      },
    },
  };
});

// Une entrée sans droit, et une par type de valeur de la matrice (comme
// src/server/autorisation/navigation.test.ts).
const DEMO: readonly EntreeNavigation[] = [
  { chemin: "/ouverte", cle: "demoOuverte", droit: null },
  { chemin: "/catalogue", cle: "demoCatalogue", droit: "catalogue.voir" },
  { chemin: "/supprimer", cle: "demoSupprimer", droit: "organisation.supprimer" },
  { chemin: "/clients", cle: "demoClients", droit: "clients.voir" },
  { chemin: "/factures", cle: "demoFactures", droit: "factures.emises.voir" },
  { chemin: "/export", cle: "demoExport", droit: "exports.csv" },
];

const ORDRE_PAR_ROLE = {
  proprietaire: [
    "Démo ouverte",
    "Démo catalogue",
    "Démo supprimer",
    "Démo clients",
    "Démo factures",
    "Démo export",
  ],
  comptable: ["Démo ouverte", "Démo catalogue", "Démo clients", "Démo factures", "Démo export"],
  commercial: ["Démo ouverte", "Démo catalogue", "Démo clients", "Démo factures"],
  lecteur: ["Démo ouverte", "Démo catalogue", "Démo clients", "Démo factures", "Démo export"],
} as const;

const CONTENU = "Contenu de la page de démonstration";

beforeEach(() => {
  adresse.mockReset();
  adresse.mockReturnValue("/ouverte");
});

const rendre = (element: ReactElement) => renderToStaticMarkup(element);

// Entités produites par React dans un texte ou un attribut. &amp; en dernier,
// pour ne pas décoder deux fois.
function decoder(html: string): string {
  return html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

function texte(html: string): string {
  return decoder(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Textes de chaque nœud, balises retirées : un texte exact se cherche dans
// cette liste, et non par inclusion.
function noeudsDeTexte(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((morceau) => decoder(morceau).trim())
    .filter((morceau) => morceau !== "");
}

type Lien = { attributs: string; texte: string };

function liens(html: string): Lien[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\b[^>]*>/gi)].map(
    ([, attributs, contenu]) => ({
      attributs: attributs ?? "",
      texte: texte(contenu ?? ""),
    }),
  );
}

// Les éléments nav dont le nom accessible est celui de la navigation.
function navigations(html: string): string[] {
  return [...html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav\b[^>]*>/gi)]
    .filter(([, attributs]) =>
      decoder(attributs ?? "").includes(`aria-label="${TEXTES_NAVIGATION.nom}"`),
    )
    .map(([tout]) => tout);
}

function uneNavigation(html: string): string {
  const trouvees = navigations(html);
  expect(trouvees).toHaveLength(1);
  return trouvees[0] ?? "";
}

const ACTIF = 'aria-current="page"';

// Premier élément focalisable au clavier, dans l'ordre du document : lien
// avec adresse, bouton, résumé de details, champ, ou tabindex positif ou nul.
function premierFocalisable(html: string): { balise: string; suite: string } | undefined {
  const motif =
    /<(a|button|summary|input|select|textarea)\b[^>]*>|<[a-z][a-z0-9-]*\b[^>]*\btabindex="(?!-)[^"]*"[^>]*>/gi;
  for (const trouve of html.matchAll(motif)) {
    const balise = trouve[0];
    if (/^<a\b/i.test(balise) && !/\bhref=/.test(balise)) continue;
    if (/\bdisabled\b/.test(balise)) continue;
    return { balise, suite: html.slice((trouve.index ?? 0) + balise.length) };
  }
  return undefined;
}

function gabarit(role: (typeof ROLES)[number], organisation?: string): string {
  return rendre(
    <GabaritApplication
      role={role}
      entrees={entreesVisibles(role, DEMO)}
      {...(organisation === undefined ? {} : { organisation })}
    >
      {CONTENU}
    </GabaritApplication>,
  );
}

describe("bandeau de simulation", () => {
  test("le texte exact de l'application, pas celui d'un document", () => {
    const html = rendre(<BandeauSimulation />);

    expect(noeudsDeTexte(html)).toEqual([TEXTES_SIMULATION.bandeauApplication]);
    expect(texte(html)).not.toContain(TEXTES_SIMULATION.bandeau);
  });

  test.each(ROLES)("%s : présent une fois dans le gabarit, avant le contenu", (role) => {
    const visible = texte(gabarit(role));

    expect(visible.split(TEXTES_SIMULATION.bandeauApplication)).toHaveLength(2);
    expect(visible.indexOf(TEXTES_SIMULATION.bandeauApplication)).toBeLessThan(
      visible.indexOf(CONTENU),
    );
  });
});

describe("navigation", () => {
  test.each(ROLES)("%s : les entrées permises, dans l'ordre de la liste", (role) => {
    const html = rendre(<Navigation entrees={entreesVisibles(role, DEMO)} />);

    expect(liens(uneNavigation(html)).map((lien) => lien.texte)).toEqual(ORDRE_PAR_ROLE[role]);
  });

  test.each(ROLES)("%s : la même navigation dans le gabarit", (role) => {
    const nav = uneNavigation(gabarit(role));

    expect(liens(nav).map((lien) => lien.texte)).toEqual(ORDRE_PAR_ROLE[role]);
  });

  test("chaque lien vise le chemin de son entrée", () => {
    const html = rendre(<Navigation entrees={DEMO} />);

    expect(
      liens(uneNavigation(html)).map((lien) => /\bhref="([^"]*)"/.exec(lien.attributs)?.[1]),
    ).toEqual(DEMO.map((entree) => entree.chemin));
  });

  test.each(DEMO.map((entree) => [entree.chemin] as const))(
    "adresse %s : aria-current sur cette entrée, et sur elle seule",
    (chemin) => {
      adresse.mockReturnValue(chemin);

      const tous = liens(uneNavigation(rendre(<Navigation entrees={DEMO} />)));
      const actifs = tous.filter((lien) => lien.attributs.includes(ACTIF));

      expect(actifs).toHaveLength(1);
      expect(actifs[0]?.attributs).toContain(`href="${chemin}"`);
      // Les autres n'ont aucun attribut aria-current, pas même « false ».
      for (const lien of tous.filter((l) => !l.attributs.includes(ACTIF))) {
        expect(lien.attributs).not.toContain("aria-current");
      }
    },
  );

  test.each(["/autre", "/", "/clients-archives", "/ouvertes"])(
    "adresse %s, hors de la liste : aucune entrée active",
    (chemin) => {
      adresse.mockReturnValue(chemin);

      expect(rendre(<Navigation entrees={DEMO} />)).not.toContain("aria-current");
    },
  );

  test("une seule navigation nommée, même avec le menu replié sous 768 px", () => {
    expect(navigations(gabarit("proprietaire"))).toHaveLength(1);
  });
});

describe("rôle de l'utilisateur", () => {
  test.each(ROLES)("%s : son libellé, et aucun autre", (role) => {
    const visible = texte(gabarit(role));

    expect(visible).toContain(TEXTES_NAVIGATION.roles[role]);
    for (const autre of ROLES.filter((r) => r !== role)) {
      expect(visible).not.toContain(TEXTES_NAVIGATION.roles[autre]);
    }
  });
});

describe("lien d'évitement", () => {
  test.each(ROLES)("%s : premier élément focalisable, vers le contenu principal", (role) => {
    const html = gabarit(role);

    const premier = premierFocalisable(html);
    expect(premier?.balise).toMatch(/^<a\b/);
    expect(texte(premier?.suite.split("</a>")[0] ?? "")).toBe(TEXTES_COMMUNS.allerAuContenu);
    const cible = /\bhref="#([^"]+)"/.exec(premier?.balise ?? "")?.[1];
    expect(cible).toBeTruthy();
    // La cible est l'élément main, unique, qui porte le contenu.
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<main\\b[^>]*\\bid="${cible}"`));
    const main = html.slice(html.indexOf("<main"));
    expect(texte(main)).toContain(CONTENU);
  });
});

// S-51 : un nom d'organisation est une donnée saisie par un membre ; il
// s'affiche comme du texte. Le bloc « Organisation active » est absent du
// gabarit en 0.6 (section 10, arrive avec la 2.1) : le composant accepte le
// nom en propriété facultative, que le gabarit de la 0.6 ne passe pas.
describe("nom de l'organisation", () => {
  const PIEGE = `<script>alert("x")</script><img src=x onerror='alert(1)'> "Ets Koné & Fils"`;

  test("échappé : aucune balise produite, le texte affiché à l'identique", () => {
    const html = gabarit("proprietaire", PIEGE);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`alert("x")`);
    expect(html).toContain("&lt;script&gt;");
    expect(noeudsDeTexte(html)).toContain(PIEGE);
    expect(texte(html)).toContain(TEXTES_NAVIGATION.organisationActive);
  });

  test("sans nom (0.6) : ni le bloc, ni son libellé", () => {
    expect(texte(gabarit("proprietaire"))).not.toContain(TEXTES_NAVIGATION.organisationActive);
  });
});
