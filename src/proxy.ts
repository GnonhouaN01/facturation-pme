import { NextResponse, type NextRequest } from "next/server";

import { politiqueSecurite } from "@/lib/securite/entetes";

// Tire un nonce à chaque requête et pose la politique de sécurité du contenu
// sur la requête, où Next.js la lit pendant le rendu pour ajouter le nonce à
// ses scripts, et sur la réponse (S-80, T-34). N'importe pas server/env.ts
// (règle S) : une variable invalide ne fait pas échouer le proxy.
// Fiche : docs/features/socle-interface.md, sections 5.2 et 5.5.

function tirerNonce(): string {
  const octets = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...octets));
}

export function proxy(requete: NextRequest) {
  // Seule lecture de process.env hors de src/server/env.ts (CLAUDE.md,
  // règle 12, décision 11).
  const developpement = process.env.NODE_ENV === "development";
  const politique = politiqueSecurite({ nonce: tirerNonce(), developpement });

  // Une politique reçue du client est remplacée. Next.js lit le nonce dans
  // content-security-policy, à défaut dans sa variante report-only : celle-ci
  // est retirée.
  const entetes = new Headers(requete.headers);
  entetes.delete("content-security-policy-report-only");
  entetes.set("content-security-policy", politique);

  const reponse = NextResponse.next({ request: { headers: entetes } });
  reponse.headers.set("Content-Security-Policy", politique);
  return reponse;
}

// Toutes les adresses sauf les fichiers compilés et l'icône. /_next/image
// n'est plus exclu : l'optimiseur est fermé (next.config.ts), sa page
// « introuvable » porte la politique comme toute autre. Les requêtes de
// préchargement ne sont pas exclues : une page ne doit jamais partir sans
// politique, et un en-tête next-router-prefetch envoyé par un client ne doit
// pas faire sauter le proxy.
export const config = {
  matcher: ["/((?!_next/static/|favicon\\.ico$).*)"],
};
