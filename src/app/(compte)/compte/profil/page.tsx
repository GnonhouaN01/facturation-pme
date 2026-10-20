import { FormulaireMotDePasse, FormulaireNom } from "@/components/compte/formulaires-profil";
import { lireComptePourPage, lireProfil } from "@/server/actions/exposer";
import { TEXTES_COMPTE } from "@/textes/compte";

// Profil (1.5) : l'adresse en lecture seule, la correction du nom et le
// changement du mot de passe. Elle se protège elle-même : sans session
// vérifiée, la page « introuvable ». Elle ne lit que le nom et l'adresse de
// l'utilisateur de la session. Fiche : docs/features/profil-sessions.md,
// sections 4, 5 et 9.
export default async function PageProfil() {
  const profil = await lireComptePourPage(lireProfil);
  const textes = TEXTES_COMPTE.profil;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {textes.titre}
      </h1>
      <div className="flex flex-col gap-1">
        <p className="text-[0.875rem] leading-5 font-medium text-foreground">{textes.email}</p>
        <p className="text-[0.9375rem] leading-6 break-words text-muted-foreground">
          {profil.email}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireNom nom={profil.nom} />
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <FormulaireMotDePasse />
      </div>
    </main>
  );
}
