"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { TEXTES_COMMUNS } from "@/textes/commun";
import { TEXTES_ERREURS } from "@/textes/erreurs";

// Contenu des pages « erreur » (error.tsx et global-error.tsx) : le texte
// fixe, l'identifiant de l'incident s'il existe, et les deux actions. Ne
// reçoit que le digest, jamais l'erreur : ni message, ni nom, ni pile, ni
// cause ne peuvent s'afficher (S-85, T-35). Une erreur d'un composant client
// n'a pas de digest : pas d'identifiant (décision 6).
// Fiche : docs/features/socle-interface.md, section 4.
export function Incident({ digest, retry }: { digest: string | undefined; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 p-4 text-center md:p-12">
      <h1 className="font-heading text-[2rem] leading-[2.375rem] font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_ERREURS.erreur}
      </h1>
      {digest === undefined ? null : (
        <p className="flex flex-wrap justify-center gap-x-1 text-muted-foreground">
          <span>{TEXTES_ERREURS.identifiantIncident}</span>
          <span className="font-mono text-foreground select-all">{digest}</span>
        </p>
      )}
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Button onClick={() => retry()}>{TEXTES_ERREURS.recharger}</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {TEXTES_COMMUNS.revenirAccueil}
        </Link>
      </div>
    </main>
  );
}
