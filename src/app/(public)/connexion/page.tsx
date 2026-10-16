import Link from "next/link";

import { FormulaireConnexion } from "@/components/compte/formulaire-connexion";
import { TEXTES_COMPTE } from "@/textes/compte";
import { redirigerSiConnecte } from "@/server/actions/exposer";

// Connexion (UC-02), dans la zone publique : ne lit jamais la session ; un
// utilisateur déjà connecté voit le formulaire. L'aide sur la confirmation de
// l'adresse est fixe, affichée quel que soit le résultat (T-07). Fiche :
// docs/features/connexion.md, sections 2.1 et 5.2.

const TEXTES = TEXTES_COMPTE.connexion;
const LIEN =
  "inline-flex min-h-11 items-center rounded-md text-[0.9375rem] leading-6 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

export default async function PageConnexion() {
  // Utilisateur connecté : /compte (correctif de la 1.2).
  await redirigerSiConnecte();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES.titre}
      </h1>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireConnexion />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">
          {TEXTES.aideConfirmation}
        </p>
        <Link href="/connexion/nouveau-lien" className={`self-start ${LIEN}`}>
          {TEXTES.nouveauLien}
        </Link>
        <Link href="/inscription" className={`self-start ${LIEN}`}>
          {TEXTES.creerCompte}
        </Link>
      </div>
    </main>
  );
}
