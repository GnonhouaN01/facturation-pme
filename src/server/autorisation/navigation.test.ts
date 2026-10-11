import { describe, expect, test } from "vitest";

import { TEXTES_NAVIGATION } from "@/textes/navigation";

import { DROITS, peut, ROLES } from "./matrice";
import {
  DROIT_GABARIT,
  ENTREES_NAVIGATION,
  entreesVisibles,
  type EntreeNavigation,
} from "./navigation";

// Entrées de la navigation filtrées par la matrice. Masquer une entrée n'est
// pas un contrôle d'accès : chaque page se protège (section 2.4). Fiche :
// docs/features/socle-interface.md, sections 2.4 et 10.

// Liste de démonstration : une entrée ouverte à tout membre, et une entrée
// par type de valeur de la matrice. Les droits choisis portent chacun la
// valeur visée pour au moins un rôle (vérifié ci-dessous).
const DEMO: readonly EntreeNavigation[] = [
  { chemin: "/ouverte", cle: "ouverte", droit: null },
  // oui pour les quatre rôles.
  { chemin: "/catalogue", cle: "catalogue", droit: "catalogue.voir" },
  // oui pour le Propriétaire, non pour les trois autres.
  { chemin: "/supprimer", cle: "supprimer", droit: "organisation.supprimer" },
  // portefeuille pour le Commercial.
  { chemin: "/clients", cle: "clients", droit: "clients.voir" },
  // lecture_portefeuille pour le Commercial.
  { chemin: "/factures", cle: "factures", droit: "factures.emises.voir" },
  // non pour le Commercial, oui pour les trois autres.
  { chemin: "/export", cle: "export", droit: "exports.csv" },
];

const chemins = (entrees: readonly EntreeNavigation[]) => entrees.map((entree) => entree.chemin);

describe("liste de démonstration", () => {
  test("chaque type de valeur de la matrice y figure", () => {
    const valeurs = new Set(
      DEMO.flatMap((entree) =>
        entree.droit === null ? [] : Object.values(DROITS[entree.droit]?.valeurs ?? {}),
      ),
    );

    expect([...valeurs].sort()).toEqual(["lecture_portefeuille", "non", "oui", "portefeuille"]);
  });
});

describe("entreesVisibles", () => {
  test.each([
    ["proprietaire", ["/ouverte", "/catalogue", "/supprimer", "/clients", "/factures", "/export"]],
    ["comptable", ["/ouverte", "/catalogue", "/clients", "/factures", "/export"]],
    // P* et L* donnent l'entrée : le portefeuille limite ce que la page montre.
    ["commercial", ["/ouverte", "/catalogue", "/clients", "/factures"]],
    ["lecteur", ["/ouverte", "/catalogue", "/clients", "/factures", "/export"]],
  ])("%s : les entrées attendues, dans l'ordre de la liste", (role, attendues) => {
    expect(chemins(entreesVisibles(role, DEMO))).toEqual(attendues);
  });

  test.each(ROLES)("%s : exactement les entrées sans droit ou permises par peut", (role) => {
    const attendues = DEMO.filter((entree) => entree.droit === null || peut(role, entree.droit));

    expect(entreesVisibles(role, DEMO)).toEqual(attendues);
  });

  test("renvoie les entrées elles-mêmes, sans modifier la liste reçue", () => {
    const copie = structuredClone(DEMO);

    const visibles = entreesVisibles("proprietaire", DEMO);

    expect(visibles).not.toBe(DEMO);
    visibles.forEach((entree, rang) => expect(entree).toBe(DEMO[rang]));
    expect(DEMO).toEqual(copie);
  });

  // T-51 : un rôle hors des quatre n'a aucun droit (Object.hasOwn de la
  // matrice), il ne voit que les entrées ouvertes à tout membre.
  test.each([
    "owner",
    "member",
    "admin",
    "",
    "Proprietaire",
    "proprietaire ",
    "comptable,proprietaire",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ])("rôle inconnu %j : les entrées sans droit seulement", (role) => {
    expect(chemins(entreesVisibles(role, DEMO))).toEqual(["/ouverte"]);
  });

  test("un droit inconnu de la matrice (« __proto__ ») : entrée masquée pour tous", () => {
    const piegee = [
      { chemin: "/piege", cle: "piege", droit: "__proto__" },
    ] as unknown as EntreeNavigation[];

    for (const role of ROLES) {
      expect(entreesVisibles(role, piegee)).toEqual([]);
    }
  });

  test("liste vide : aucune entrée", () => {
    expect(entreesVisibles("proprietaire", [])).toEqual([]);
  });

  test("sans liste : la liste livrée", () => {
    expect(entreesVisibles("lecteur")).toEqual(entreesVisibles("lecteur", ENTREES_NAVIGATION));
  });
});

describe("liste livrée (0.6)", () => {
  test("une seule entrée : « Tableau de bord », ouverte à tout membre", () => {
    expect(ENTREES_NAVIGATION).toEqual([
      { chemin: "/tableau-de-bord", cle: "tableauDeBord", droit: null },
    ]);
  });

  test("chaque clé désigne un libellé de src/textes/navigation.ts", () => {
    for (const entree of ENTREES_NAVIGATION) {
      expect(Object.hasOwn(TEXTES_NAVIGATION.entrees, entree.cle), entree.cle).toBe(true);
    }
  });

  test("chaque droit est null ou un droit de la matrice ; chemins uniques et absolus", () => {
    for (const entree of ENTREES_NAVIGATION) {
      if (entree.droit !== null) expect(Object.hasOwn(DROITS, entree.droit)).toBe(true);
      expect(entree.chemin).toMatch(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    }
    expect(new Set(chemins(ENTREES_NAVIGATION)).size).toBe(ENTREES_NAVIGATION.length);
  });

  test.each(ROLES)("%s voit « Tableau de bord »", (role) => {
    expect(chemins(entreesVisibles(role))).toEqual(["/tableau-de-bord"]);
  });
});

// Décision 3 : la matrice n'a pas de droit « être membre » ; le gabarit lit
// celui qui est accordé aux quatre rôles.
describe("droit lu par le gabarit", () => {
  test("organisation.membres.voir, accordé aux quatre rôles", () => {
    expect(DROIT_GABARIT).toBe("organisation.membres.voir");
    for (const role of ROLES) expect(peut(role, DROIT_GABARIT)).toBe(true);
  });
});
