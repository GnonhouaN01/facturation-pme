import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_ERREURS } from "@/textes/erreurs";

// La même page, statut 404, pour une adresse inexistante, une page de
// l'application sans session et une ressource refusée ou absente : aucun
// texte ne varie selon la cause (S-02, T-30). Fiche :
// docs/features/socle-interface.md, section 3.
export default function PageIntrouvable() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 p-4 text-center md:p-12">
      <h1 className="font-heading text-[2rem] leading-[2.375rem] font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_ERREURS.introuvable}
      </h1>
      <Link href="/" className={buttonVariants()}>
        {TEXTES_COMMUNS.revenirAccueil}
      </Link>
    </main>
  );
}
