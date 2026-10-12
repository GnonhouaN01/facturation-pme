import { EnTetePage } from "@/components/gabarits/en-tete-page";
import { lirePourPage } from "@/server/actions/exposer";
import { DROIT_GABARIT } from "@/server/autorisation/navigation";
import { TEXTES_NAVIGATION } from "@/textes/navigation";

// Page vide du tableau de bord, que la 7.1 remplira. Elle se protège
// elle-même par lirePourPage, même sans rien lire : le gabarit ne protège pas
// (section 2.3). Aucune métadonnée propre : le titre de l'onglet d'une page
// refusée doit rester celui d'une adresse inexistante (S-02).
// Fiche : docs/features/socle-interface.md, sections 1 et 2.3.
export default async function PageTableauDeBord() {
  await lirePourPage(DROIT_GABARIT, async () => null);
  return <EnTetePage titre={TEXTES_NAVIGATION.entrees.tableauDeBord} />;
}
