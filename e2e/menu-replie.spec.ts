import { type APIRequestContext, expect, test } from "@playwright/test";

// Repli du menu de la zone application (décision 36). Le résumé « Menu » ne
// disparaît, dès 768 px, que si le navigateur prend en charge
// ::details-content ; sans elle (Chrome 109, dernière version pour Windows 7
// et 8), il reste visible et un clic ouvre la navigation. Chromium récent ne
// permet pas de simuler l'absence de prise en charge : le test lit donc la
// feuille de style servie par le site construit et vérifie que chaque règle
// qui vise la classe de masquage du résumé est à l'intérieur de
// @supports selector(::details-content) et d'une requête de 48rem (768 px),
// et nulle part ailleurs. src/components/gabarits/menu-replie.test.tsx
// vérifie que le résumé porte cette classe, et aucune autre qui le masque.
// Fiche : docs/features/socle-interface.md, section 10.

const MASQUER_RESUME = "md:supports-[selector(::details-content)]:hidden";
const SUPPORTS = "@supports selector(::details-content)";
const BARRE_INVERSE = String.fromCharCode(92);

type Regle = { selecteur: string; corps: string; contexte: string[] };

// Découpe une feuille minifiée en règles de style, chacune avec ses
// at-règles englobantes (@layer, @media, @supports), de l'extérieur vers
// l'intérieur. Gère les échappements et les chaînes entre guillemets.
function regles(css: string): Regle[] {
  const pile: string[] = [];
  const resultat: Regle[] = [];
  let tampon = "";
  let guillemet: string | null = null;
  for (let rang = 0; rang < css.length; rang++) {
    const signe = css[rang] ?? "";
    if (signe === BARRE_INVERSE) {
      tampon += signe + (css[rang + 1] ?? "");
      rang++;
      continue;
    }
    if (guillemet !== null) {
      tampon += signe;
      if (signe === guillemet) guillemet = null;
      continue;
    }
    if (signe === '"' || signe === "'") {
      guillemet = signe;
      tampon += signe;
      continue;
    }
    const dansUneRegle = pile.length > 0 && !(pile.at(-1) ?? "").startsWith("@");
    if (signe === "{") {
      pile.push(tampon.trim());
      tampon = "";
    } else if (signe === "}") {
      const entete = pile.pop() ?? "";
      if (!entete.startsWith("@")) {
        resultat.push({ selecteur: entete, corps: tampon.trim(), contexte: [...pile] });
      }
      tampon = "";
    } else if (signe === ";" && !dansUneRegle) {
      // Instruction d'at-règle (@layer a, b; @import ...;) : hors d'une règle.
      tampon = "";
    } else {
      tampon += signe;
    }
  }
  return resultat;
}

function sansEchappement(selecteur: string): string {
  return selecteur.split(BARRE_INVERSE).join("");
}

async function feuillesServies(request: APIRequestContext): Promise<string[]> {
  const html = await (await request.get("/")).text();
  const adresses = [...html.matchAll(/<link[^>]*>/g)]
    .map((balise) => balise[0])
    .filter((balise) => balise.includes('rel="stylesheet"'))
    .map((balise) => /href="([^"]+)"/.exec(balise)?.[1] ?? "")
    .filter((adresse) => adresse.endsWith(".css"));
  expect(adresses.length).toBeGreaterThan(0);
  return Promise.all(adresses.map(async (adresse) => (await request.get(adresse)).text()));
}

test.describe("menu replié : masquage du résumé conditionné", () => {
  test("le découpage reconnaît règles, at-règles et échappements", () => {
    const essai =
      "@layer a,b;@layer a{.x{color:red}@media (width>=48rem){@supports selector(::details-content){.md" +
      BARRE_INVERSE +
      ":y{display:none}}}.z" +
      BARRE_INVERSE +
      '\'{content:"}"}}';

    expect(regles(essai)).toEqual([
      { selecteur: ".x", corps: "color:red", contexte: ["@layer a"] },
      {
        selecteur: ".md" + BARRE_INVERSE + ":y",
        corps: "display:none",
        contexte: ["@layer a", "@media (width>=48rem)", SUPPORTS],
      },
      { selecteur: ".z" + BARRE_INVERSE + "'", corps: 'content:"}"', contexte: ["@layer a"] },
    ]);
  });

  test("chaque règle de la classe de masquage est sous @supports et dès 48rem, nulle part ailleurs", async ({
    request,
  }) => {
    const toutes = (await feuillesServies(request)).flatMap(regles);
    // La feuille a bien été lue : elle contient des centaines de règles.
    expect(toutes.length).toBeGreaterThan(100);

    const visees = toutes.filter((regle) =>
      sansEchappement(regle.selecteur).includes(`.${MASQUER_RESUME}`),
    );

    expect(visees.length).toBeGreaterThan(0);
    for (const regle of visees) {
      expect(regle.corps.replace(/\s/g, "")).toContain("display:none");
      expect(regle.contexte).toContain(SUPPORTS);
      expect(regle.contexte.some((at) => at.startsWith("@media") && at.includes("48rem"))).toBe(
        true,
      );
    }
  });
});
