import Link from "next/link";

import { FormulaireInscription } from "@/components/compte/formulaire-inscription";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_DONNEES_PERSONNELLES } from "@/textes/donnees-personnelles";
import { redirigerSiConnecte } from "@/server/actions/exposer";

// Inscription (UC-01, étapes 1 à 3), dans la zone publique : ne lit jamais
// la session. Fiche : docs/features/inscription.md, section 5.1. Lien vers
// les données personnelles sous le formulaire
// (docs/features/donnees-personnelles.md, section 4).
const LIEN =
  "inline-flex min-h-11 items-center rounded-md text-[0.9375rem] leading-6 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

export default async function PageInscription() {
  // Utilisateur connecté : /compte (correctif de la 1.2).
  await redirigerSiConnecte();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
          {TEXTES_COMPTE.inscription.titre}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">
          {TEXTES_COMPTE.inscription.introduction}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <FormulaireInscription />
        </div>
        <Link href="/donnees-personnelles" className={`self-start ${LIEN}`}>
          {TEXTES_DONNEES_PERSONNELLES.liens.inscription}
        </Link>
      </div>
    </main>
  );
}
