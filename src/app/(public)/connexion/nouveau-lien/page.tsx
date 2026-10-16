import { FormulaireRenvoi } from "@/components/compte/formulaire-renvoi";
import { TEXTES_COMPTE } from "@/textes/compte";
import { redirigerSiConnecte } from "@/server/actions/exposer";

// Renvoi du lien de confirmation depuis la connexion (UC-01, 4a) : la même
// réponse pour toute adresse (T-07). Fiche : docs/features/connexion.md,
// section 2.3.
export default async function PageNouveauLien() {
  // Utilisateur connecté : /compte (correctif de la 1.2).
  await redirigerSiConnecte();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_COMPTE.renvoi.titre}
      </h1>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireRenvoi sansTitre />
      </div>
    </main>
  );
}
