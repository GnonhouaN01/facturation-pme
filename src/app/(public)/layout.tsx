import Link from "next/link";

import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_DONNEES_PERSONNELLES } from "@/textes/donnees-personnelles";

// Gabarit de la zone publique : en-tête au nom du produit (display, graisse
// 600), contenu, pied de page. Ne lit jamais la session. Le pied de page
// mène aux données personnelles (docs/features/donnees-personnelles.md,
// section 4).
// Fiche : docs/features/socle-interface.md, sections 1 et 10.
export default function LayoutPublic({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b border-border bg-card px-4 py-4 md:px-12">
        <p className="font-heading text-[1.125rem] leading-[1.625rem] font-semibold tracking-[-0.01em]">
          {TEXTES_COMMUNS.produit}
        </p>
      </header>
      {children}
      <footer className="flex flex-col gap-1 border-t border-border px-4 py-6 text-[0.8125rem] leading-5 text-muted-foreground md:flex-row md:items-center md:justify-between md:px-12">
        <p>{TEXTES_COMMUNS.produit}</p>
        <Link
          href="/donnees-personnelles"
          className="inline-flex min-h-11 items-center self-start rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid md:self-auto"
        >
          {TEXTES_DONNEES_PERSONNELLES.liens.piedDePage}
        </Link>
      </footer>
    </div>
  );
}
