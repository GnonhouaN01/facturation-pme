import { TEXTES_COMMUNS } from "@/textes/commun";

// Gabarit de la zone publique : en-tête au nom du produit (display, graisse
// 600), contenu, pied de page. Ne lit jamais la session.
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
      <footer className="border-t border-border px-4 py-6 text-[0.8125rem] leading-5 text-muted-foreground md:px-12">
        <p>{TEXTES_COMMUNS.produit}</p>
      </footer>
    </div>
  );
}
