import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

import { TEXTES_COMMUNS } from "../src/textes/commun";
import { TEXTES_ERREURS } from "../src/textes/erreurs";
import {
  attaques,
  ENTETES_SECTION_6,
  nonceDe,
  observerViolations,
  POLITIQUE_PRODUCTION,
  sansNonce,
  violations,
} from "./outils";

// Politique de sécurité du contenu et en-têtes, sur le site construit
// (S-80, T-34, T-37). Fiche : docs/features/socle-interface.md, sections 5 et 6.

const PAGES_HTML = [
  ["l'accueil", "/", 200],
  ["une adresse inexistante", "/adresse-inexistante", 404],
] as const;

test.describe("politique de sécurité du contenu", () => {
  for (const [nom, chemin, statut] of PAGES_HTML) {
    test(`${nom} : la politique de la section 5.3, avec un nonce de 16 octets`, async ({
      request,
    }) => {
      const reponse = await request.get(chemin);
      expect(reponse.status()).toBe(statut);

      const politique = reponse.headers()["content-security-policy"];
      expect(sansNonce(politique)).toEqual(POLITIQUE_PRODUCTION);
      expect(politique).not.toMatch(/unsafe-/);

      const nonce = nonceDe(politique);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
      expect(Buffer.from(nonce, "base64").toString("base64")).toBe(nonce);
    });

    test(`${nom} : le nonce change d'une requête à l'autre`, async ({ request }) => {
      const premiere = await request.get(chemin);
      const seconde = await request.get(chemin);

      expect(nonceDe(premiere.headers()["content-security-policy"])).not.toBe(
        nonceDe(seconde.headers()["content-security-policy"]),
      );
    });

    test(`${nom} : chaque script du HTML porte le nonce de la réponse`, async ({ request }) => {
      const reponse = await request.get(chemin);
      const nonce = nonceDe(reponse.headers()["content-security-policy"]);
      const balises = (await reponse.text()).match(/<script\b[^>]*>/gi) ?? [];

      expect(balises.length).toBeGreaterThan(0);
      for (const balise of balises) {
        expect(balise).toContain(`nonce="${nonce}"`);
      }
    });

    test(`${nom} : aucune violation au chargement`, async ({ page }) => {
      await observerViolations(page);
      await page.goto(chemin);
      await page.waitForLoadState("networkidle");

      expect(await violations(page)).toEqual([]);
    });
  }

  test("deux visites de l'accueil dans le navigateur : deux nonces (rendu dynamique)", async ({
    page,
  }) => {
    const premiere = await page.goto("/");
    const seconde = await page.reload();

    expect(nonceDe(premiere?.headers()["content-security-policy"])).not.toBe(
      nonceDe(seconde?.headers()["content-security-policy"]),
    );
  });
});

test.describe("en-têtes forgés par le client", () => {
  const FORGE = randomBytes(16).toString("base64");

  for (const [nom, entetes] of [
    [
      "Content-Security-Policy",
      { "Content-Security-Policy": `script-src * 'unsafe-inline' 'nonce-${FORGE}'` },
    ],
    ["x-nonce", { "x-nonce": FORGE }],
    ["next-router-prefetch", { "next-router-prefetch": "1" }],
    ["requête RSC de préchargement", { rsc: "1", "next-router-prefetch": "1" }],
    [
      "les trois ensemble",
      {
        "Content-Security-Policy": `script-src 'nonce-${FORGE}'`,
        "x-nonce": FORGE,
        "next-router-prefetch": "1",
      },
    ],
  ] as const) {
    test(`${nom} : la politique reçue est celle du serveur, avec son nonce`, async ({
      request,
    }) => {
      const reponse = await request.get("/", { headers: entetes });
      const politique = reponse.headers()["content-security-policy"];

      expect(sansNonce(politique)).toEqual(POLITIQUE_PRODUCTION);
      expect(nonceDe(politique)).not.toBe(FORGE);
      expect(await reponse.text()).not.toContain(FORGE);
    });
  }
});

// Simule un script de l'application : un <script> portant le nonce de la
// réponse, inséré en tête du document de l'accueil par Playwright. Rien
// n'est ajouté dans src/ pour les besoins du test.
async function injecterScriptDeLaPage(page: Page, code: string): Promise<void> {
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const reponse = await route.fetch();
      const nonce = nonceDe(reponse.headers()["content-security-policy"]);
      const html = await reponse.text();
      const corps = html.replace("<head>", `<head><script nonce="${nonce}">${code}</script>`);
      if (corps === html) throw new Error("balise <head> introuvable dans l'accueil");
      await route.fulfill({ response: reponse, body: corps });
    },
  );
}

test.describe("attaques dans le navigateur (T-34)", () => {
  test.beforeEach(async ({ page }) => {
    await observerViolations(page);
  });

  // Limite connue, section 5.4 : 'strict-dynamic' fait confiance à tout script
  // non inséré par l'analyseur, même en ligne et sans nonce. Un script ajouté
  // au DOM par un script autorisé s'exécute donc, sans violation. Le test
  // l'atteste ; s'il échoue, la politique a changé et la fiche est à revoir.
  test("limite connue (section 5.4) : un script en ligne ajouté au DOM par un script autorisé s'exécute, sans violation", async ({
    page,
  }) => {
    await injecterScriptDeLaPage(
      page,
      `const script = document.createElement("script");
      script.textContent = "window.__attaque.push('script ajouté au DOM')";
      document.head.append(script);`,
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(await attaques(page)).toEqual(["script ajouté au DOM"]);
    expect(await violations(page)).toEqual([]);
  });

  test("gestionnaire onerror en ligne : non exécuté, violation observée", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      const conteneur = document.createElement("div");
      conteneur.innerHTML = `<img src="/image-inexistante.png" onerror="window.__attaque.push('onerror')">`;
      document.body.append(conteneur);
    });

    await expect
      .poll(async () => (await violations(page)).map((v) => v.directive))
      .toContain("script-src-attr");
    expect(await attaques(page)).toEqual([]);
  });

  test("URL javascript: : non exécutée, violation observée", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      const lien = document.createElement("a");
      lien.href = "javascript:window.__attaque.push('javascript:')";
      document.body.append(lien);
      lien.click();
    });

    await expect.poll(() => violations(page)).not.toEqual([]);
    expect(await attaques(page)).toEqual([]);
  });

  // Les essais partent d'un script de la page qui porte le nonce de la
  // réponse : page.evaluate passe par le protocole DevTools, que Chromium
  // exempte de la règle sur eval (constaté le 2026-10-12). setTimeout avec
  // une chaîne ne lève pas : la chaîne n'est simplement pas exécutée.
  for (const [nom, code, refus] of [
    [
      "eval",
      `try { eval("window.__attaque.push('eval')"); window.__essai = "exécuté"; }
      catch (erreur) { window.__essai = erreur.name; }`,
      "EvalError",
    ],
    [
      "new Function",
      `try { new Function("window.__attaque.push('Function')")(); window.__essai = "exécuté"; }
      catch (erreur) { window.__essai = erreur.name; }`,
      "EvalError",
    ],
    [
      "setTimeout avec une chaîne",
      `try { setTimeout("window.__attaque.push('setTimeout')", 0); window.__essai = "programmé"; }
      catch (erreur) { window.__essai = erreur.name; }`,
      "programmé",
    ],
  ] as const) {
    test(`${nom}, depuis un script de la page : refusé, violation observée`, async ({ page }) => {
      await injecterScriptDeLaPage(page, code);

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      expect(await page.evaluate(() => (window as { __essai?: string }).__essai)).toBe(refus);
      await expect
        .poll(() => violations(page))
        .toContainEqual({ directive: "script-src", bloque: "eval" });
      expect(await attaques(page)).toEqual([]);
    });
  }

  // Injection dans le HTML rendu par le serveur (XSS stockée) : les balises
  // sont insérées par l'analyseur, cas que 'strict-dynamic' ne laisse pas
  // passer. Un script externe ajouté par JavaScript, lui, passerait :
  // 'strict-dynamic' fait confiance à tout script non inséré par l'analyseur
  // (section 5.4).
  test("HTML injecté dans la réponse : script en ligne, nonce forgé, script d'une autre origine, onerror : rien ne s'exécute", async ({
    page,
  }) => {
    const demandes: string[] = [];
    await page.route("https://attaquant.exemple/**", async (route) => {
      demandes.push(route.request().url());
      await route.fulfill({
        contentType: "text/javascript",
        body: "window.__attaque.push('script d\\'une autre origine')",
      });
    });
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().resourceType() !== "document") return route.continue();
        const reponse = await route.fetch();
        const injection = [
          `<script>window.__attaque.push("script en ligne")</script>`,
          `<script nonce="${randomBytes(16).toString("base64")}">window.__attaque.push("nonce forgé")</script>`,
          `<script src="https://attaquant.exemple/charge.js"></script>`,
          `<img src="/image-inexistante.png" onerror="window.__attaque.push('onerror')">`,
        ].join("");
        const corps = (await reponse.text()).replace("</body>", `${injection}</body>`);
        await route.fulfill({ response: reponse, body: corps });
      },
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect.poll(async () => (await violations(page)).length).toBeGreaterThanOrEqual(4);
    expect(await attaques(page)).toEqual([]);
    expect(demandes).toEqual([]);
  });

  // L'autre origine est un vrai serveur sur 127.0.0.1, port éphémère, fermé
  // à la fin du test. Une page fournie par route.fulfill est vue par
  // Chromium comme publique : il refuse alors qu'elle charge localhost
  // (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS), même avec la permission
  // local-network-access, et le test passerait sans nos en-têtes. Constaté
  // le 2026-10-12, Playwright 1.63.
  test("affichage dans un cadre depuis une autre origine : bloqué", async ({ page, baseURL }) => {
    const cible = `${baseURL}/`;
    const serveur = createServer((_requete, reponse) => {
      reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      reponse.end(`<!doctype html><title>Autre site</title><iframe src="${cible}"></iframe>`);
    });
    await new Promise<void>((pret) => serveur.listen(0, "127.0.0.1", pret));
    try {
      const { port } = serveur.address() as AddressInfo;
      const autreOrigine = `http://127.0.0.1:${port}/`;
      expect(new URL(autreOrigine).origin).not.toBe(new URL(cible).origin);

      // Preuve que le document du cadre a été servi : le blocage vient de
      // ses en-têtes, pas du réseau.
      const reponseCadre = page.waitForResponse(
        (reponse) => reponse.url() === cible && reponse.frame() !== page.mainFrame(),
      );

      await page.goto(autreOrigine);
      expect((await reponseCadre).status()).toBe(200);
      await page.waitForLoadState("load");

      const cadre = page.frames().find((frame) => frame !== page.mainFrame());
      expect(cadre).toBeDefined();
      const contenu = await cadre?.evaluate(() => document.documentElement.innerHTML);
      expect(contenu).not.toContain(TEXTES_COMMUNS.produit);
    } finally {
      serveur.closeAllConnections();
      await new Promise<void>((ferme) => serveur.close(() => ferme()));
    }
  });
});

test.describe("autres en-têtes (section 6)", () => {
  async function fichierStatique(request: APIRequestContext) {
    const html = await (await request.get("/")).text();
    const trouve = /<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/i.exec(html);
    if (!trouve?.[1]) throw new Error("aucun fichier de /_next/static dans l'accueil");
    return trouve[1];
  }

  for (const [nom, chemin] of [
    ["l'accueil", "/"],
    ["une adresse inexistante", "/adresse-inexistante"],
    ["favicon.ico", "/favicon.ico"],
    ["une adresse sous /lien/", "/lien/devis/jeton-inexistant"],
  ] as const) {
    test(`${nom} : valeurs exactes, sans X-Powered-By`, async ({ request }) => {
      const recus = (await request.get(chemin)).headers();

      for (const [entete, valeur] of Object.entries(ENTETES_SECTION_6)) {
        expect(recus[entete], entete).toBe(valeur);
      }
      expect(recus["x-powered-by"]).toBeUndefined();
    });
  }

  test("un fichier de /_next/static : valeurs exactes, sans X-Powered-By", async ({ request }) => {
    const reponse = await request.get(await fichierStatique(request));
    expect(reponse.status()).toBe(200);

    const recus = reponse.headers();
    for (const [entete, valeur] of Object.entries(ENTETES_SECTION_6)) {
      expect(recus[entete], entete).toBe(valeur);
    }
    expect(recus["x-powered-by"]).toBeUndefined();
  });

  for (const [nom, chemin] of PAGES_HTML) {
    test(`${nom} : Cache-Control privé, sans stockage`, async ({ request }) => {
      const cache = (await request.get(chemin)).headers()["cache-control"] ?? "";

      expect(cache).toMatch(/\bprivate\b/);
      expect(cache).toMatch(/\bno-store\b/);
    });
  }

  test("l'accueil : pas de X-Robots-Tag", async ({ request }) => {
    expect((await request.get("/")).headers()["x-robots-tag"]).toBeUndefined();
  });

  test("/lien/devis/<jeton aléatoire> : introuvable, non indexé, sans cookie", async ({
    request,
  }) => {
    const jeton = randomBytes(32).toString("base64url");
    const reponse = await request.get(`/lien/devis/${jeton}`);
    const recus = reponse.headers();

    expect(reponse.status()).toBe(404);
    expect(await reponse.text()).toContain(TEXTES_ERREURS.introuvable);
    expect(recus["x-robots-tag"]).toBe("noindex, nofollow");
    expect(recus["referrer-policy"]).toBe("same-origin");
    expect(recus["set-cookie"]).toBeUndefined();
    expect(sansNonce(recus["content-security-policy"])).toEqual(POLITIQUE_PRODUCTION);
  });
});

test.describe("polices", () => {
  for (const [nom, chemin] of PAGES_HTML) {
    test(`${nom} : aucune requête vers Google`, async ({ page }) => {
      const hors: string[] = [];
      page.on("request", (requete) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(requete.url())) hors.push(requete.url());
      });

      await page.goto(chemin);
      await page.waitForLoadState("networkidle");

      expect(hors).toEqual([]);
    });
  }
});
