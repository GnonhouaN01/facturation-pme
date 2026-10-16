import { BoutonDeconnexion } from "@/components/compte/bouton-deconnexion";
import { lireComptePourPage } from "@/server/actions/exposer";
import { TEXTES_COMMUNS } from "@/textes/commun";

// Gabarit de la zone compte (1.2) : pages d'un utilisateur connecté, sans
// organisation. Il lit la session pour s'afficher (sans session : la page
// « introuvable », sans le gabarit ni le bouton de déconnexion), mais ne
// protège pas : chaque page appelle lireComptePourPage elle-même (test
// d'inventaire), un gabarit n'étant pas réexécuté à chaque navigation. Aucune métadonnée propre ni loading.tsx : le titre
// fuirait sur la page « introuvable », et notFound() répondrait 200. Fiche :
// docs/features/connexion.md, section 5.1.
export default async function LayoutCompte({ children }: { children: React.ReactNode }) {
  await lireComptePourPage(async () => null);
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 md:px-12">
        <p className="font-heading text-[1.125rem] leading-[1.625rem] font-semibold tracking-[-0.01em]">
          {TEXTES_COMMUNS.produit}
        </p>
        <BoutonDeconnexion />
      </header>
      {children}
    </div>
  );
}
