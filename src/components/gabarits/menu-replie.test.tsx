import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { TEXTES_COMMUNS } from "@/textes/commun";

import { GabaritApplication } from "./gabarit-application";

// Le résumé « Menu » du gabarit n'est masqué, dès 768 px, que si le
// navigateur prend en charge ::details-content : sans elle, la navigation
// resterait cachée dans un details fermé, sans moyen de l'ouvrir (Chrome 109,
// dernière version pour Windows 7 et 8). Ce test vérifie la classe portée par
// le résumé ; e2e/menu-replie.spec.ts vérifie, dans la feuille construite,
// que cette classe n'agit que sous @supports. Fiche :
// docs/features/socle-interface.md, section 10, décision 36.

vi.mock("next/navigation", () => ({ usePathname: () => "/tableau-de-bord" }));

// La seule classe qui masque le résumé.
const MASQUER_RESUME = "md:supports-[selector(::details-content)]:hidden";

const ROLE = "lecteur";

function classesDuResume(): string[] {
  const html = renderToStaticMarkup(
    <GabaritApplication role={ROLE} entrees={[]}>
      {TEXTES_COMMUNS.produit}
    </GabaritApplication>,
  );
  const resumes = [...html.matchAll(/<summary\b[^>]*\bclass="([^"]*)"/g)];
  expect(resumes).toHaveLength(1);
  return (resumes[0]?.[1] ?? "").split(/\s+/).filter((classe) => classe !== "");
}

describe("résumé « Menu » du gabarit", () => {
  test("masqué dès 768 px seulement sous @supports selector(::details-content)", () => {
    expect(classesDuResume()).toContain(MASQUER_RESUME);
  });

  test("aucune autre classe ne le masque, ni ne le retire de l'affichage", () => {
    // Classes qui donnent display:none au résumé lui-même. Celle qui masque
    // le marqueur (::-webkit-details-marker) vise un pseudo-élément, pas le
    // résumé.
    const masquantes = classesDuResume().filter(
      (classe) =>
        /(^|:)(hidden|sr-only|invisible)$/.test(classe) && !classe.includes("details-marker"),
    );

    expect(masquantes).toEqual([MASQUER_RESUME]);
  });
});
