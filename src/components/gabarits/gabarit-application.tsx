import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { BoutonDeconnexion } from "@/components/compte/bouton-deconnexion";
import type { EntreeNavigation } from "@/server/autorisation/navigation";
import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_NAVIGATION } from "@/textes/navigation";

import { BandeauSimulation } from "./bandeau-simulation";
import { Navigation } from "./navigation";

// Gabarit de la zone application (section 10, d'après la maquette) : lien
// d'évitement, barre latérale de 240 px à gauche dès 768 px (au-dessus du
// contenu en dessous, navigation repliée dans un details natif « Menu »),
// bandeau de simulation en haut du contenu. N'affiche que ce qu'il reçoit :
// les entrées sont filtrées et le rôle lu côté serveur, par (app)/layout.tsx.
// Le nom de l'organisation est facultatif : absent en 0.6, il arrive avec la
// 2.1 ; il s'affiche comme du texte, échappé par React (S-51).
// Fiche : docs/features/socle-interface.md, sections 2.4, 2.6 et 10.

type Role = keyof typeof TEXTES_NAVIGATION.roles;

const ID_CONTENU = "contenu";

const FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

export function GabaritApplication({
  role,
  entrees,
  organisation,
  children,
}: {
  role: Role;
  entrees: readonly EntreeNavigation[];
  organisation?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-1 flex-col md:flex-row">
      <a
        href={`#${ID_CONTENU}`}
        className={`sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-10 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-card focus-visible:px-3 focus-visible:font-semibold focus-visible:text-primary ${FOCUS}`}
      >
        {TEXTES_COMMUNS.allerAuContenu}
      </a>
      <aside className="flex flex-col gap-4 border-b border-border bg-card p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:gap-6 md:overflow-y-auto md:border-r md:border-b-0 md:px-4 md:py-6">
        <p className="px-3 font-heading text-[1.125rem] leading-[1.625rem] font-semibold tracking-[-0.01em]">
          {TEXTES_COMMUNS.produit}
        </p>
        {organisation === undefined ? null : (
          <div className="flex flex-col px-3">
            <span className="text-[0.75rem] leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {TEXTES_NAVIGATION.organisationActive}
            </span>
            <span className="text-[0.9375rem] leading-6 font-semibold break-words">
              {organisation}
            </span>
          </div>
        )}
        {/* Sous 768 px, la navigation se replie dans un details natif, sans
            script ni style en ligne. Dès 768 px, si le navigateur prend en
            charge ::details-content, le contenu reste affiché, ouvert ou non,
            et le résumé disparaît. Sans elle (Chrome 109, dernière version
            pour Windows 7 et 8), le résumé reste visible à toutes les
            largeurs, et un clic ouvre la navigation : son masquage n'existe
            que sous @supports (décision 36, e2e/menu-replie.spec.ts). */}
        <details className="md:details-content:block md:details-content:[content-visibility:visible]">
          <summary
            className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-[0.9375rem] leading-6 font-medium hover:bg-muted md:supports-[selector(::details-content)]:hidden [&::-webkit-details-marker]:hidden ${FOCUS}`}
          >
            <Menu aria-hidden="true" className="size-5" strokeWidth={1.5} />
            {TEXTES_COMMUNS.menu}
          </summary>
          <div className="pt-2 md:pt-0">
            <Navigation entrees={entrees} />
          </div>
        </details>
        <div className="flex flex-col gap-3 border-t border-border px-3 pt-3 md:mt-auto">
          <span className="text-[0.8125rem] leading-5 text-muted-foreground">
            {TEXTES_NAVIGATION.roles[role]}
          </span>
          {/* 1.2 : déconnexion (docs/features/connexion.md, section 5.2). */}
          <BoutonDeconnexion />
        </div>
      </aside>
      <main
        id={ID_CONTENU}
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-12 outline-none md:px-12 md:pt-8"
      >
        <BandeauSimulation />
        {children}
      </main>
    </div>
  );
}
