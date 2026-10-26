import {
  getRedirectUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";

// Le proxy tire un nonce à chaque requête et pose la politique de sécurité
// du contenu sur la requête (lue par Next.js pendant le rendu) et sur la
// réponse (S-80, T-34). Fiche : docs/features/socle-interface.md, section 5.5.
//
// Next.js 16.3.8 n'exporte pas unstable_doesProxyMatch : le sélecteur se
// vérifie par unstable_doesMiddlewareMatch (next/experimental/testing/server),
// qui prend la même configuration (fiche, décision 19).

const BASE = "https://facturation.exemple.ci";

// Le proxy lit process.env.NODE_ENV : chaque cas recharge le module après
// avoir fixé la valeur, qu'elle soit lue au chargement ou à l'appel.
async function chargerProxy(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("./proxy");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function appeler(chemin = "/", entetes: Record<string, string> = {}, nodeEnv = "production") {
  const { proxy } = await chargerProxy(nodeEnv);
  return proxy(new NextRequest(`${BASE}${chemin}`, { headers: entetes }));
}

function nonceDe(politique: string | null): string {
  const trouve = /'nonce-([^']*)'/.exec(politique ?? "");
  if (!trouve?.[1]) throw new Error("politique sans nonce");
  return trouve[1];
}

// Politique transmise à Next.js pour le rendu : NextResponse.next({ request })
// la porte dans x-middleware-request-<nom>, et liste le nom dans
// x-middleware-override-headers.
function politiqueDeLaRequete(reponse: Response): string | null {
  const remplaces = (reponse.headers.get("x-middleware-override-headers") ?? "").split(",");
  if (!remplaces.includes("content-security-policy")) return null;
  return reponse.headers.get("x-middleware-request-content-security-policy");
}

describe("sélecteur du proxy", () => {
  async function passe(url: string, headers: Record<string, string> = {}): Promise<boolean> {
    const { config } = await chargerProxy("production");
    return unstable_doesMiddlewareMatch({ config, url, headers });
  }

  test.each([
    "/",
    "/adresse-inexistante",
    "/tableau-de-bord",
    "/lien/devis/jeton",
    "/api/auth/session",
    "/_next/data/essai.json",
    "/favicon.ico.html",
    "/_next/staticx",
    // Optimiseur d'images fermé (images.unoptimized) : sa page « introuvable »
    // porte la politique comme toute autre page.
    "/_next/image?url=%2Fx.png&w=64&q=75",
    "/_next/image",
  ])("%s : le proxy s'exécute", async (chemin) => {
    expect(await passe(chemin)).toBe(true);
  });

  test.each(["/_next/static/chunks/essai.js", "/favicon.ico"])("%s : exclu", async (chemin) => {
    expect(await passe(chemin)).toBe(false);
  });

  test.each([
    ["next-router-prefetch", { "next-router-prefetch": "1" }],
    ["purpose: prefetch", { purpose: "prefetch" }],
    ["requête RSC", { rsc: "1" }],
    ["requête RSC de préchargement", { rsc: "1", "next-router-prefetch": "1" }],
  ])("%s : le proxy s'exécute quand même", async (_nom, entetes) => {
    expect(await passe("/", entetes)).toBe(true);
  });
});

describe("politique posée par le proxy", () => {
  test("même politique sur la réponse et sur la requête, avec le même nonce", async () => {
    const reponse = await appeler();

    const surReponse = reponse.headers.get("content-security-policy");
    expect(surReponse).not.toBeNull();
    expect(politiqueDeLaRequete(reponse)).toBe(surReponse);
  });

  test("la réponse laisse passer la requête : ni redirection, ni réécriture", async () => {
    const reponse = await appeler();

    expect(getRedirectUrl(reponse)).toBeNull();
    expect(isRewrite(reponse)).toBe(false);
    expect(reponse.headers.get("x-middleware-next")).toBe("1");
  });

  test("le nonce fait 16 octets, en base64", async () => {
    const nonce = nonceDe((await appeler()).headers.get("content-security-policy"));
    const octets = Buffer.from(nonce, "base64");

    expect(octets).toHaveLength(16);
    expect(octets.toString("base64")).toBe(nonce);
  });

  test("le nonce change à chaque requête", async () => {
    const { proxy } = await chargerProxy("production");
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const reponse = proxy(new NextRequest(`${BASE}/`));
      nonces.add(nonceDe((await reponse).headers.get("content-security-policy")));
    }
    expect(nonces.size).toBe(100);
  });

  test("NODE_ENV=production : politique de production, sans unsafe-", async () => {
    const politique = (await appeler()).headers.get("content-security-policy");

    expect(politique).not.toMatch(/unsafe-/);
    expect(politique).toMatch(/style-src 'self' 'nonce-/);
  });

  test("NODE_ENV=development : unsafe-eval et styles en ligne", async () => {
    const politique = (await appeler("/", {}, "development")).headers.get(
      "content-security-policy",
    );

    expect(politique).toMatch(/script-src [^;]*'unsafe-eval'/);
    expect(politique).toMatch(/style-src 'self' 'unsafe-inline'/);
  });

  test.each(["test", "", "Development", "developpement"])(
    "NODE_ENV=%j : politique de production",
    async (nodeEnv) => {
      const politique = (await appeler("/", {}, nodeEnv)).headers.get("content-security-policy");
      expect(politique).not.toMatch(/unsafe-/);
    },
  );
});

describe("en-têtes forgés par le client (T-34)", () => {
  const FORGE = "Zm9yZ2UtcGFyLWxlLWNsaWVudA==";
  const POLITIQUE_FORGEE = `script-src * 'unsafe-inline' 'nonce-${FORGE}'; frame-ancestors *`;

  test("une politique reçue sur la requête est remplacée, sur la requête comme sur la réponse", async () => {
    const reponse = await appeler("/", { "content-security-policy": POLITIQUE_FORGEE });

    for (const politique of [
      reponse.headers.get("content-security-policy"),
      politiqueDeLaRequete(reponse),
    ]) {
      expect(politique).not.toContain(FORGE);
      expect(politique).not.toMatch(/unsafe-|\*/);
      expect(politique).toContain("frame-ancestors 'none'");
    }
  });

  // Next.js lit le nonce dans content-security-policy, à défaut dans
  // content-security-policy-report-only (app-render.js) : la première doit
  // toujours être posée sur la requête.
  test("Content-Security-Policy-Report-Only reçu : Next.js lit la politique du serveur", async () => {
    const reponse = await appeler("/", {
      "content-security-policy-report-only": POLITIQUE_FORGEE,
    });

    expect(politiqueDeLaRequete(reponse)).toMatch(/'nonce-/);
    expect(politiqueDeLaRequete(reponse)).not.toContain(FORGE);
    expect(reponse.headers.get("content-security-policy")).not.toContain(FORGE);
    expect(reponse.headers.get("content-security-policy-report-only")).toBeNull();
  });

  test("x-nonce reçu : le nonce de la politique n'est pas celui fourni", async () => {
    const reponse = await appeler("/", { "x-nonce": FORGE });

    expect(nonceDe(reponse.headers.get("content-security-policy"))).not.toBe(FORGE);
    expect(nonceDe(politiqueDeLaRequete(reponse))).not.toBe(FORGE);
  });

  test("next-router-prefetch reçu : la politique est posée quand même", async () => {
    const reponse = await appeler("/", { "next-router-prefetch": "1", rsc: "1" });

    expect(reponse.headers.get("content-security-policy")).toMatch(/'nonce-/);
    expect(politiqueDeLaRequete(reponse)).toMatch(/'nonce-/);
  });
});
