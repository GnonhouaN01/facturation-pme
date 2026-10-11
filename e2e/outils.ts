import type { Page } from "@playwright/test";

// Outils communs aux tests des en-têtes et des pages d'erreur.
// Fiche : docs/features/socle-interface.md, sections 5.3 et 6.

// Directives de la politique de production, sans le nonce.
export const POLITIQUE_PRODUCTION: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'none'"],
  "script-src": ["'self'", "'nonce-*'", "'strict-dynamic'"],
  "style-src": ["'self'", "'nonce-*'"],
  "img-src": ["'self'"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

export const ENTETES_SECTION_6: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export function directives(politique: string): Map<string, string[]> {
  const resultat = new Map<string, string[]>();
  for (const morceau of politique.split(";")) {
    const [nom, ...valeurs] = morceau.trim().split(/\s+/);
    if (nom) resultat.set(nom, valeurs);
  }
  return resultat;
}

// Nonce de la politique ; lève s'il n'y en a pas, ou si script-src et
// style-src en portent deux différents.
export function nonceDe(politique: string | undefined): string {
  const trouves = [...(politique ?? "").matchAll(/'nonce-([^']*)'/g)].map((t) => t[1] ?? "");
  const uniques = new Set(trouves);
  if (uniques.size !== 1) throw new Error(`nonces trouvés : ${trouves.length}`);
  return trouves[0] ?? "";
}

// La politique, nonce remplacé par « * », pour la comparer à POLITIQUE_PRODUCTION.
export function sansNonce(politique: string | undefined): Record<string, string[]> {
  return Object.fromEntries(
    [...directives((politique ?? "").replace(/'nonce-[^']*'/g, "'nonce-*'"))].map(
      ([nom, valeurs]) => [nom, valeurs],
    ),
  );
}

declare global {
  interface Window {
    __violations: { directive: string; bloque: string }[];
    __attaque: string[];
  }
}

// Avant tout script de la page, note chaque violation de la politique et
// prépare le témoin des attaques. Un script d'initialisation de Playwright
// n'est pas soumis à la politique.
export async function observerViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__violations = [];
    window.__attaque = [];
    document.addEventListener("securitypolicyviolation", (evenement) => {
      window.__violations.push({
        directive: evenement.effectiveDirective,
        bloque: evenement.blockedURI,
      });
    });
  });
}

export async function violations(page: Page) {
  return page.evaluate(() => window.__violations);
}

export async function attaques(page: Page) {
  return page.evaluate(() => window.__attaque);
}
