import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, test } from "vitest";

import nextConfig from "../../../next.config";
import { ENTETES_SECURITE, politiqueSecurite } from "./entetes";

// Politique de sécurité du contenu et autres en-têtes (S-80, T-34, T-37).
// Fiche : docs/features/socle-interface.md, sections 5.3 et 6.

// 16 octets en base64 : 24 caractères, dont deux de remplissage.
const NONCE = "q83vEjRWeJA0Ulh4mrzN7w==";

type Directives = Map<string, string[]>;

// Découpe une politique en directives : nom → valeurs, dans l'ordre. Lève
// sur une directive en double, que le navigateur ignorerait en silence.
function directives(politique: string): Directives {
  const resultat: Directives = new Map();
  for (const morceau of politique.split(";")) {
    const [nom, ...valeurs] = morceau.trim().split(/\s+/);
    if (!nom) continue;
    if (resultat.has(nom)) throw new Error(`directive en double : ${nom}`);
    resultat.set(nom, valeurs);
  }
  return resultat;
}

const PRODUCTION: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'none'"],
  "script-src": ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"],
  "style-src": ["'self'", `'nonce-${NONCE}'`],
  "img-src": ["'self'"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

const DEVELOPPEMENT: Readonly<Record<string, readonly string[]>> = {
  ...PRODUCTION,
  "script-src": ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", "'unsafe-eval'"],
  "style-src": ["'self'", "'unsafe-inline'"],
};

describe("politiqueSecurite, en production", () => {
  const politique = politiqueSecurite({ nonce: NONCE, developpement: false });
  const lues = directives(politique);

  test("exactement les dix directives de la section 5.3", () => {
    expect([...lues.keys()].sort()).toEqual(Object.keys(PRODUCTION).sort());
  });

  test.each(Object.entries(PRODUCTION))("%s : %j", (nom, valeurs) => {
    expect(lues.get(nom)).toEqual(valeurs);
  });

  test("aucun mot-clé unsafe-, ni joker, ni schéma ouvert", () => {
    expect(politique).not.toMatch(/unsafe-/);
    expect(politique).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(politique).not.toMatch(/(^|\s)(https?|data|blob):(\s|;|$)/);
  });

  test("aucune directive non retenue (upgrade-insecure-requests, report-to, Trusted Types)", () => {
    for (const nom of [
      "upgrade-insecure-requests",
      "report-to",
      "report-uri",
      "require-trusted-types-for",
    ]) {
      expect(lues.has(nom), nom).toBe(false);
    }
  });

  test("aucune adresse de Vercel ni de Google", () => {
    expect(politique).not.toMatch(/vercel|google|gstatic/i);
  });

  test("le nonce figure dans script-src et style-src, et nulle part ailleurs", () => {
    const porteurs = [...lues].filter(([, valeurs]) => valeurs.includes(`'nonce-${NONCE}'`));
    expect(porteurs.map(([nom]) => nom).sort()).toEqual(["script-src", "style-src"]);
  });

  test("un autre nonce donne la même politique, avec ce nonce", () => {
    const autre = "AAAAAAAAAAAAAAAAAAAAAA==";
    expect(politiqueSecurite({ nonce: autre, developpement: false })).toBe(
      politique.replaceAll(NONCE, autre),
    );
  });

  test("la politique tient sur une ligne", () => {
    expect(politique).not.toMatch(/[\r\n]/);
  });
});

describe("politiqueSecurite, en développement", () => {
  const lues = directives(politiqueSecurite({ nonce: NONCE, developpement: true }));

  test("exactement les mêmes directives qu'en production", () => {
    expect([...lues.keys()].sort()).toEqual(Object.keys(PRODUCTION).sort());
  });

  test.each(Object.entries(DEVELOPPEMENT))("%s : %j", (nom, valeurs) => {
    expect(lues.get(nom)).toEqual(valeurs);
  });
});

const ATTENDUS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

describe("ENTETES_SECURITE", () => {
  test("la liste exacte de la section 6, au format de next.config.ts", () => {
    expect(Object.fromEntries(ENTETES_SECURITE.map(({ key, value }) => [key, value]))).toEqual(
      ATTENDUS,
    );
    expect(ENTETES_SECURITE).toHaveLength(Object.keys(ATTENDUS).length);
  });

  test("Referrer-Policy n'est pas no-referrer, qui rendrait Origin: null sur les actions", () => {
    const valeur = ENTETES_SECURITE.find(({ key }) => key === "Referrer-Policy")?.value;
    expect(valeur).toBe("same-origin");
  });

  test("ni X-Robots-Tag (réservé à /lien/), ni Content-Security-Policy (posée par le proxy)", () => {
    const noms = ENTETES_SECURITE.map(({ key }) => key.toLowerCase());
    expect(noms).not.toContain("x-robots-tag");
    expect(noms).not.toContain("content-security-policy");
  });
});

describe("next.config.ts", () => {
  async function entetes(url: string): Promise<Headers> {
    const reponse = await unstable_getResponseFromNextConfig({ url, nextConfig });
    return reponse.headers;
  }

  test("poweredByHeader est à false", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  test.each([
    "https://facturation.exemple.ci/",
    "https://facturation.exemple.ci/adresse-inexistante",
    "https://facturation.exemple.ci/_next/static/chunks/essai.js",
    "https://facturation.exemple.ci/favicon.ico",
    "https://facturation.exemple.ci/lien/devis/jeton",
  ])("%s : les en-têtes de la section 6", async (url) => {
    const recus = await entetes(url);
    for (const [nom, valeur] of Object.entries(ATTENDUS)) {
      expect(recus.get(nom), nom).toBe(valeur);
    }
  });

  test.each([
    "https://facturation.exemple.ci/lien",
    "https://facturation.exemple.ci/lien/devis/jeton",
    "https://facturation.exemple.ci/lien/facture/jeton/pdf",
  ])("%s : X-Robots-Tag noindex, nofollow", async (url) => {
    expect((await entetes(url)).get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  test.each([
    "https://facturation.exemple.ci/",
    "https://facturation.exemple.ci/liens",
    "https://facturation.exemple.ci/tableau-de-bord",
    "https://facturation.exemple.ci/autre/lien/devis",
  ])("%s : pas de X-Robots-Tag", async (url) => {
    expect((await entetes(url)).get("X-Robots-Tag")).toBeNull();
  });

  test("aucune politique de sécurité du contenu fixe : elle dépend de la requête", async () => {
    expect((await entetes("https://facturation.exemple.ci/")).get("Content-Security-Policy")).toBe(
      null,
    );
  });
});
