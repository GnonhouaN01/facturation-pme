import type { NextConfig } from "next";

import { ENTETES_LIENS, ENTETES_SECURITE } from "./src/lib/securite/entetes";

// En-têtes de sécurité sur toutes les réponses, fichiers statiques et 404
// compris. La politique de sécurité du contenu est posée par src/proxy.ts.
// Fiche : docs/features/socle-interface.md, section 6.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: [...ENTETES_SECURITE] },
      { source: "/lien/:chemin*", headers: [...ENTETES_LIENS] },
    ];
  },
};

export default nextConfig;
