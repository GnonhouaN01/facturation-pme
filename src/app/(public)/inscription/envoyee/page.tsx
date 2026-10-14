import { FormulaireRenvoi } from "@/components/compte/formulaire-renvoi";
import { TEXTES_COMPTE } from "@/textes/compte";

// Après l'inscription : le même message pour toute adresse (T-07), et le
// renvoi du lien (UC-01, 4a). Aucune adresse dans l'adresse de la page.
// Fiche : docs/features/inscription.md, section 5.1.
export default function PageInscriptionEnvoyee() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
          {TEXTES_COMPTE.envoyee.titre}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">
          {TEXTES_COMPTE.envoyee.message}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireRenvoi />
      </div>
    </main>
  );
}
