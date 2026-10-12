import type { ReactNode } from "react";

// En-tête d'une page de l'application : titre (titre-1) à gauche, actions à
// droite, qui passent dessous sur un écran étroit. Un seul titre-1 par écran.
// Fiche : docs/features/socle-interface.md, section 10.
export function EnTetePage({ titre, actions }: { titre: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-heading text-[2rem] leading-[2.375rem] font-semibold tracking-[-0.02em] text-foreground">
        {titre}
      </h1>
      {actions === undefined ? null : <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
