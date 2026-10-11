import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, test } from "vitest";

import type { Resultat } from "@/server/actions/refus";
import { ROLES } from "@/server/autorisation/matrice";

import { TEXTES_COMMUNS } from "./commun";
import { TEXTES_ERREURS } from "./erreurs";
import { TEXTES_NAVIGATION } from "./navigation";
import { TEXTES_RESULTATS } from "./resultats";
import { TEXTES_SIMULATION } from "./simulation";

// Textes de l'interface (NF-01). Les messages liés à la sécurité reprennent
// mot pour mot le tableau « Ce que la sécurité impose à l'écran » de
// docs/DESIGN-SYSTEM.md, qui fait foi : ce test lit le fichier. Fiche :
// docs/features/socle-interface.md, section 11.1.

const DESIGN_SYSTEM = readFileSync(
  fileURLToPath(new URL("../../docs/DESIGN-SYSTEM.md", import.meta.url)),
  "utf8",
);

// Situation (première colonne) -> premier texte entre guillemets français de
// la règle. Lève si la section ou le tableau est introuvable.
function lireMessagesDeSecurite(texte: string): Map<string, string> {
  const debut = texte.indexOf("### Ce que la sécurité impose à l'écran");
  if (debut < 0) throw new Error("Section introuvable dans DESIGN-SYSTEM.md.");
  const fin = texte.indexOf("\n### ", debut + 1);
  const section = texte.slice(debut, fin < 0 ? undefined : fin);
  const messages = new Map<string, string>();
  for (const ligne of section.split("\n")) {
    const colonnes = ligne.split("|").map((colonne) => colonne.trim());
    if (colonnes.length < 4) continue;
    const [, situation, regle] = colonnes;
    const guillemets = /«\s*([^»]+?)\s*»/u.exec(regle ?? "");
    if (situation && guillemets?.[1]) messages.set(situation, guillemets[1]);
  }
  if (messages.size === 0) throw new Error("Tableau vide dans DESIGN-SYSTEM.md.");
  return messages;
}

const MESSAGES = lireMessagesDeSecurite(DESIGN_SYSTEM);

function message(situation: string): string {
  const valeur = MESSAGES.get(situation);
  if (valeur === undefined) throw new Error(`Situation absente de DESIGN-SYSTEM.md : ${situation}`);
  return valeur;
}

describe("messages de sécurité, mot pour mot", () => {
  test("le tableau de DESIGN-SYSTEM.md est lu", () => {
    expect(message("Accès refusé ou ressource absente")).toBe("Cette page est introuvable");
  });

  test("page refusée ou absente : « Cette page est introuvable »", () => {
    expect(TEXTES_ERREURS.introuvable).toBe(message("Accès refusé ou ressource absente"));
  });

  test("erreur inattendue, page et formulaire : « Une erreur est survenue. »", () => {
    expect(TEXTES_ERREURS.erreur).toBe(message("Erreur inattendue"));
    expect(TEXTES_RESULTATS.erreur).toBe(message("Erreur inattendue"));
  });

  test("action refusée dans un formulaire : « Cette action n'est pas disponible. » (décision 4)", () => {
    expect(TEXTES_RESULTATS.refuse).toBe(message("Action refusée dans un formulaire"));
  });

  test("bandeau de simulation : le texte de DESIGN-SYSTEM.md", () => {
    expect(TEXTES_SIMULATION.bandeau).toBe(message("Document produit en mode simulateur"));
  });
});

describe("textes fixés par la fiche", () => {
  test("textes communs", () => {
    expect(TEXTES_COMMUNS).toEqual({
      produit: "Facturation PME",
      description: "Devis, factures et suivi des paiements pour petites structures.",
      allerAuContenu: "Aller au contenu",
      menu: "Menu",
      revenirAccueil: "Revenir à l'accueil",
    });
  });

  test("textes des pages d'erreur", () => {
    expect(TEXTES_ERREURS.identifiantIncident).toBe("Identifiant de l'incident :");
    expect(TEXTES_ERREURS.recharger).toBe("Recharger la page");
  });

  test("libellés des résultats", () => {
    expect(TEXTES_RESULTATS).toEqual({
      connexion_requise: "Votre session a expiré. Connectez-vous à nouveau.",
      refuse: "Cette action n'est pas disponible.",
      trop_de_requetes: "Trop de tentatives. Patientez un instant, puis réessayez.",
      invalide: "Certains champs sont à corriger.",
      erreur: "Une erreur est survenue.",
    });
  });

  test("navigation : en 0.6, la seule entrée est « Tableau de bord »", () => {
    expect(TEXTES_NAVIGATION.organisationActive).toBe("Organisation active");
    expect(TEXTES_NAVIGATION.entrees).toEqual({ tableauDeBord: "Tableau de bord" });
    expect(TEXTES_NAVIGATION.nom.length).toBeGreaterThan(0);
  });

  test("libellés des quatre rôles, dans l'ordre de THREATS.md", () => {
    expect(TEXTES_NAVIGATION.roles).toEqual({
      proprietaire: "Propriétaire",
      comptable: "Comptable",
      commercial: "Commercial",
      lecteur: "Lecteur",
    });
  });
});

describe("clés exhaustives", () => {
  type Raison = Extract<Resultat<unknown>, { ok: false }>["raison"];

  // satisfies refuse à la compilation une raison oubliée ou en trop.
  const RAISONS = {
    connexion_requise: true,
    refuse: true,
    trop_de_requetes: true,
    invalide: true,
    erreur: true,
  } satisfies Record<Raison, true>;

  test("un libellé par raison de Resultat, ni plus ni moins", () => {
    expectTypeOf<keyof typeof TEXTES_RESULTATS>().toEqualTypeOf<Raison>();
    expect(Object.keys(TEXTES_RESULTATS).sort()).toEqual(Object.keys(RAISONS).sort());
  });

  test("un libellé par rôle de la matrice, ni plus ni moins", () => {
    expect(Object.keys(TEXTES_NAVIGATION.roles).sort()).toEqual([...ROLES].sort());
  });
});

// Tous les textes, à plat, avec leur chemin.
function aPlat(valeur: unknown, chemin: string): Array<[string, string]> {
  if (typeof valeur === "string") return [[chemin, valeur]];
  if (valeur && typeof valeur === "object") {
    return Object.entries(valeur).flatMap(([cle, sous]) => aPlat(sous, `${chemin}.${cle}`));
  }
  throw new Error(`${chemin} n'est ni un texte ni un objet de textes.`);
}

describe("voix de Signal (DESIGN-SYSTEM.md, « Voix »)", () => {
  const TOUS = (): Array<[string, string]> => [
    ...aPlat(TEXTES_COMMUNS, "commun"),
    ...aPlat(TEXTES_ERREURS, "erreurs"),
    ...aPlat(TEXTES_NAVIGATION, "navigation"),
    ...aPlat(TEXTES_RESULTATS, "resultats"),
    ...aPlat(TEXTES_SIMULATION, "simulation"),
  ];

  test("aucun texte vide, ni espace en tête, en fin ou doublée", () => {
    for (const [chemin, texte] of TOUS()) {
      expect(texte.length, chemin).toBeGreaterThan(0);
      expect(texte, chemin).toBe(texte.trim());
      expect(texte, chemin).not.toMatch(/\s{2,}/u);
    }
  });

  test("pas de point d'exclamation, pas d'emoji", () => {
    for (const [chemin, texte] of TOUS()) {
      expect(texte, chemin).not.toContain("!");
      expect(texte, chemin).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test("jamais « OK » ni « Valider » seuls", () => {
    for (const [chemin, texte] of TOUS()) {
      expect(texte, chemin).not.toMatch(/^(ok|valider)\.?$/iu);
    }
  });

  test("pas de jargon technique : ni « 404 », ni « erreur 500 », ni « exception »", () => {
    for (const [chemin, texte] of TOUS()) {
      expect(texte, chemin).not.toMatch(/\b(404|500)\b|exception/iu);
    }
  });
});
