import { FormulaireOubli } from "@/components/compte/formulaire-oubli";
import { TEXTES_COMPTE } from "@/textes/compte";
import { redirigerSiConnecte } from "@/server/actions/exposer";

// Mot de passe oublié (UC-03, étapes 1 et 2), dans la zone publique : la même
// confirmation pour toute adresse (T-07). Fiche :
// docs/features/mot-de-passe.md, section 7.

const TEXTES = TEXTES_COMPTE.motDePasseOublie;

export default async function PageMotDePasseOublie() {
  // Utilisateur connecté : /compte (comme les pages de la connexion).
  await redirigerSiConnecte();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
          {TEXTES.titre}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.introduction}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireOubli />
      </div>
    </main>
  );
}
