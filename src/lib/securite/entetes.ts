// Politique de sécurité du contenu et autres en-têtes de sécurité (S-80,
// T-34, T-37). Fonctions pures, sans dépendance : next.config.ts les importe
// hors de Next.js, d'où leur place dans lib/ et non dans server/.
// Fiche : docs/features/socle-interface.md, sections 5.3, 5.5 et 6.

// Un nonce est du base64 : sans apostrophe, point-virgule, virgule ni
// espace, il ne peut ni sortir de sa valeur ni ajouter une directive (T-34).
const NONCE = /^[A-Za-z0-9+/]+={0,2}$/;

export function politiqueSecurite({
  nonce,
  developpement,
}: {
  nonce: string;
  developpement: boolean;
}): string {
  if (!NONCE.test(nonce)) throw new TypeError("Nonce invalide.");
  const source = `'nonce-${nonce}'`;

  // En développement, React utilise eval et le rechargement à chaud injecte
  // des styles en ligne (section 5.3). Un nonce rendrait 'unsafe-inline'
  // sans effet : style-src n'en porte pas en développement.
  const directives: [string, string[]][] = [
    ["default-src", ["'none'"]],
    [
      "script-src",
      ["'self'", source, "'strict-dynamic'", ...(developpement ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", developpement ? ["'self'", "'unsafe-inline'"] : ["'self'", source]],
    ["img-src", ["'self'"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([nom, valeurs]) => `${nom} ${valeurs.join(" ")}`).join("; ");
}

// En-têtes fixes, posés par next.config.ts sur toutes les réponses (section
// 6). La politique, qui dépend de la requête, est posée par src/proxy.ts.
// Referrer-Policy reste same-origin : no-referrer donnerait Origin: null aux
// actions serveur, que la chaîne de contrôles refuse.
export const ENTETES_SECURITE: readonly { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

// Un document client, servi sous /lien/, n'est jamais indexé.
export const ENTETES_LIENS: readonly { key: string; value: string }[] = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
