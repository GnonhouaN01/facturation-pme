import Link from "next/link";

import {
  FormulaireCreationOrganisation,
  ListeOrganisations,
} from "@/components/compte/organisations";
import {
  lireComptePourPage,
  lireEtatDoubleAuth,
  lireOrganisations,
} from "@/server/actions/exposer";
import { TEXTES_COMPTE } from "@/textes/compte";

import { changerOrganisation, creerOrganisation } from "./actions";

// Page d'arrivée après la connexion (1.2, décision 2). Elle se protège
// elle-même : sans session vérifiée, la page « introuvable ». La 2.1 y
// ajoutera les organisations (UC-02, étape 4). Fiche :
// docs/features/connexion.md, sections 5.1 à 5.3. 1.4 : l'état de la double
// authentification et le lien vers sa page (docs/features/
// double-authentification.md, section 11). 1.5 : liens vers le profil et les
// sessions (docs/features/profil-sessions.md, section 9). 2.1 : la liste des
// organisations de l'utilisateur et la création, en tête (UC-02, étape 4 ;
// docs/features/organisations.md, section 9).
export default async function PageCompte() {
  const { etat, organisations } = await lireComptePourPage(async (compte) => ({
    etat: await lireEtatDoubleAuth(compte),
    organisations: await lireOrganisations(compte),
  }));
  const textes = TEXTES_COMPTE.compte;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {textes.titre}
      </h1>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.connecte}</p>
      <ListeOrganisations organisations={organisations} changer={changerOrganisation} />
      <FormulaireCreationOrganisation creer={creerOrganisation} />
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-[1.25rem] leading-7 font-semibold text-foreground">
            {textes.doubleAuthTitre}
          </h2>
          <span
            className={
              etat.actif
                ? "rounded-sm bg-succes-fond px-2 py-0.5 text-[0.8125rem] leading-5 font-semibold text-succes"
                : "rounded-sm bg-muted px-2 py-0.5 text-[0.8125rem] leading-5 font-semibold text-muted-foreground"
            }
          >
            {etat.actif ? textes.doubleAuthActive : textes.doubleAuthInactive}
          </span>
        </div>
        <Link
          href="/compte/double-authentification"
          className="inline-flex min-h-11 items-center self-start text-[0.9375rem] leading-6 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
        >
          {etat.actif ? textes.gerer : textes.activer}
        </Link>
      </section>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h2 className="font-heading text-[1.25rem] leading-7 font-semibold text-foreground">
          {textes.profilTitre}
        </h2>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.profilAide}</p>
        <Link
          href="/compte/profil"
          className="inline-flex min-h-11 items-center self-start text-[0.9375rem] leading-6 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
        >
          {textes.modifierProfil}
        </Link>
      </section>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h2 className="font-heading text-[1.25rem] leading-7 font-semibold text-foreground">
          {textes.sessionsTitre}
        </h2>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.sessionsAide}</p>
        <Link
          href="/compte/sessions"
          className="inline-flex min-h-11 items-center self-start text-[0.9375rem] leading-6 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
        >
          {textes.voirSessions}
        </Link>
      </section>
    </main>
  );
}
