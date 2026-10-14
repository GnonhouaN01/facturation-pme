import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_COMPTE } from "@/textes/compte";

// Fin de UC-01 : l'adresse est vérifiée, la session ouverte. La page ne lit
// pas la session : elle ne dit rien de plus à qui l'ouvrirait directement.
// Fiche : docs/features/inscription.md, section 5.1.
export default function PageInscriptionVerifiee() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_COMPTE.verifiee.titre}
      </h1>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">
        {TEXTES_COMPTE.verifiee.message}
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline", className: "self-start" })}>
        {TEXTES_COMMUNS.revenirAccueil}
      </Link>
    </main>
  );
}
