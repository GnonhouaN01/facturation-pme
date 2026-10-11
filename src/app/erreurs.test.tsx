import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_ERREURS } from "@/textes/erreurs";

import PageErreur from "./error";
import ErreurGlobale from "./global-error";

// Les pages « erreur » n'affichent jamais le message, le nom, la pile ni la
// cause d'une erreur : elles ne lisent que digest (S-85, T-35).
// Fiche : docs/features/socle-interface.md, sections 4.1 et 4.3 (niveau 1).

// next/font/google n'est transformé que par le compilateur de Next.js : sous
// Vitest, chaque police de src/app/polices.ts, que global-error.tsx importe,
// devient un objet de classes vides. Vitest exige que chaque nom importé
// soit une clé de l'objet renvoyé : les trois polices sont nommées.
vi.mock("next/font/google", () => {
  const police = () => ({ className: "", variable: "", style: { fontFamily: "" } });
  return { Space_Grotesk: police, DM_Sans: police, DM_Mono: police };
});

const DIGEST = "1f0c6a52-7b9e-4c1d-9a3e-5b8f2d4c6e10";

// Marqueurs qu'aucune page d'erreur ne doit contenir.
const MARQUEURS = [
  "SELECT",
  "postgresql://",
  "mot-de-passe-secret",
  "/home/",
  "node_modules",
  "DATABASE_URL",
  "Variables d'environnement",
  "victime@exemple.ci",
  "ErreurPiegee",
  "CauseSecrete",
] as const;

class ErreurPiegee extends Error {
  override name = "ErreurPiegee";
}

function erreurChargee(digest?: string): Error & { digest?: string } {
  const cause = Object.assign(
    new Error("CauseSecrete : postgresql://app_facturation:mot-de-passe-secret@localhost/x"),
    { code: "28P01" },
  );
  const erreur = new ErreurPiegee(
    "Variables d'environnement invalides :\n- DATABASE_URL : SELECT * FROM member WHERE email = 'victime@exemple.ci'",
    { cause },
  );
  erreur.stack = `ErreurPiegee: DATABASE_URL\n    at lire (/home/vercel/node_modules/pg/lib/client.js:1:1)`;
  return digest === undefined ? erreur : Object.assign(erreur, { digest });
}

// Enveloppe qui note chaque propriété lue : seule digest est permise.
function espionner(erreur: Error & { digest?: string }) {
  const lues = new Set<string>();
  const espion = new Proxy(erreur, {
    get(cible, propriete, recepteur) {
      if (typeof propriete === "string") lues.add(propriete);
      return Reflect.get(cible, propriete, recepteur) as unknown;
    },
  });
  return { espion, lues };
}

const PAGES = [
  ["error.tsx", PageErreur],
  ["global-error.tsx", ErreurGlobale],
] as const;

function rendre(Page: (typeof PAGES)[number][1], error: Error & { digest?: string }): string {
  const sansEffet = () => undefined;
  return renderToString(<Page error={error} retry={sansEffet} />);
}

// Texte visible : balises retirées, entités courantes décodées. &amp; en
// dernier : décodé avant les autres, « &amp;nbsp; » deviendrait « &nbsp; »,
// puis une espace (double décodage).
function texte(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe.each(PAGES)("%s", (_nom, Page) => {
  test("avec digest : le texte fixe, l'identifiant et les actions", () => {
    const visible = texte(rendre(Page, erreurChargee(DIGEST)));

    expect(visible).toContain(TEXTES_ERREURS.erreur);
    expect(visible).toContain(`${TEXTES_ERREURS.identifiantIncident} ${DIGEST}`);
    expect(visible).toContain(TEXTES_ERREURS.recharger);
    expect(visible).toContain(TEXTES_COMMUNS.revenirAccueil);
  });

  test("sans digest (erreur d'un composant client) : le texte fixe, sans identifiant", () => {
    const visible = texte(rendre(Page, erreurChargee()));

    expect(visible).toContain(TEXTES_ERREURS.erreur);
    expect(visible).not.toContain(TEXTES_ERREURS.identifiantIncident);
    expect(visible).toContain(TEXTES_ERREURS.recharger);
  });

  test.each([DIGEST, undefined])("digest %s : aucun marqueur dans le HTML", (digest) => {
    const html = rendre(Page, erreurChargee(digest));

    for (const marqueur of MARQUEURS) {
      expect(html, marqueur).not.toContain(marqueur);
    }
    expect(html).not.toMatch(/\bat \S+ \(/);
  });

  test.each([DIGEST, undefined])("digest %s : seule la propriété digest est lue", (digest) => {
    const { espion, lues } = espionner(erreurChargee(digest));

    rendre(Page, espion);

    for (const interdite of ["message", "name", "stack", "cause", "code", "toString"]) {
      expect(lues.has(interdite), interdite).toBe(false);
    }
  });

  test("le digest est échappé comme du texte", () => {
    const html = rendre(Page, erreurChargee(`<img src=x onerror="alert(1)">`));

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("aucun « 404 » ni texte en anglais de Next.js", () => {
    const visible = texte(rendre(Page, erreurChargee(DIGEST)));

    expect(visible).not.toMatch(/\b(404|500)\b/);
    expect(visible).not.toMatch(/Application error|Something went wrong|Try again/i);
  });

  test("aucun attribut style (règle P, politique de sécurité du contenu)", () => {
    expect(rendre(Page, erreurChargee(DIGEST))).not.toMatch(/\sstyle="/);
  });
});

describe("global-error.tsx", () => {
  test("porte son propre document, en français", () => {
    const html = rendre(ErreurGlobale, erreurChargee(DIGEST));

    expect(html).toMatch(/^<html[^>]*\slang="fr"/i);
    expect(html).toContain("<body");
  });
});
