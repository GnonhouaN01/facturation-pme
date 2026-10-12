import { TEXTES_SIMULATION } from "@/textes/simulation";

// Bandeau permanent en haut du contenu de chaque page de l'application : la
// production utilise le simulateur de certification (DESIGN.md, section 4.4).
// Texte d'attention sur son fond, rayon-md, sans bordure latérale.
// Fiche : docs/features/socle-interface.md, section 10.
export function BandeauSimulation() {
  return (
    <p className="rounded-md bg-attention-fond px-4 py-3 text-[0.9375rem] leading-6 font-medium text-attention">
      {TEXTES_SIMULATION.bandeauApplication}
    </p>
  );
}
