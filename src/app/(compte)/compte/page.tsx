import { lireComptePourPage } from "@/server/actions/exposer";
import { TEXTES_COMPTE } from "@/textes/compte";

// Page d'arrivée après la connexion (1.2, décision 2). Elle se protège
// elle-même : sans session vérifiée, la page « introuvable ». Elle ne lit
// rien d'autre en 1.2 ; la 2.1 y ajoutera les organisations (UC-02,
// étape 4). Fiche : docs/features/connexion.md, sections 5.1 à 5.3.
export default async function PageCompte() {
  await lireComptePourPage(async () => null);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {TEXTES_COMPTE.compte.titre}
      </h1>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">
        {TEXTES_COMPTE.compte.connecte}
      </p>
    </main>
  );
}
