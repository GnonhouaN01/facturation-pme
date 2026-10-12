import { TEXTES_COMMUNS } from "@/textes/commun";

// L'accueil, dans la zone publique : le nom du produit et sa présentation,
// sans bouton (aucune action n'existe avant le jalon 1). Décision 30.
// Fiche : docs/features/socle-interface.md, section 1.
export default function PageAccueil() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-12 md:px-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_COMMUNS.produit}
      </h1>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">
        {TEXTES_COMMUNS.description}
      </p>
    </main>
  );
}
