import { GabaritApplication } from "@/components/gabarits/gabarit-application";
import { lirePourPage } from "@/server/actions/exposer";
import { DROIT_GABARIT, lireGabarit } from "@/server/autorisation/navigation";
import { lireNomOrganisationActive } from "@/server/services/organisations";

// Gabarit de la zone application. Il lit le rôle et les entrées par
// lirePourPage, pour l'affichage seulement : il ne protège pas, chaque page
// appelle lirePourPage elle-même (section 2.3). Le droit lu est
// organisation.membres.voir : la matrice n'a pas de droit « être membre », et
// celui-ci est accordé aux quatre rôles (décision 3). Sans session, sans
// adhésion ou sans droit : la page « introuvable », comme une adresse
// inexistante (S-02, décision 1). Aucun loading.tsx dans (app)/ : notFound()
// y répondrait 200. Fiche : docs/features/socle-interface.md, sections 2 et 10.
// 2.1 : le nom de l'organisation active, lu dans la transaction de la chaîne
// (RR-8, docs/features/organisations.md, section 5).
export default async function LayoutApplication({ children }: { children: React.ReactNode }) {
  const { role, entrees, organisation } = await lirePourPage(DROIT_GABARIT, async (ctx) => ({
    ...(await lireGabarit(ctx)),
    organisation: await lireNomOrganisationActive(ctx.tx),
  }));
  return (
    <GabaritApplication role={role} entrees={entrees} organisation={organisation ?? undefined}>
      {children}
    </GabaritApplication>
  );
}
