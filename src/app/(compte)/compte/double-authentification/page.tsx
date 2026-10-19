import { GestionDoubleAuth } from "@/components/compte/gestion-double-auth";
import { lireComptePourPage, lireEtatDoubleAuth } from "@/server/actions/exposer";
import { TEXTES_COMPTE } from "@/textes/compte";

// Activation et gestion de la double authentification (UC-04, 1.4). Elle se
// protège elle-même : sans session vérifiée, la page « introuvable ». Elle ne
// lit que l'état du second facteur de l'utilisateur de la session. Fiche :
// docs/features/double-authentification.md, section 11.
export default async function PageDoubleAuthentification() {
  const etat = await lireComptePourPage(lireEtatDoubleAuth);
  const textes = TEXTES_COMPTE.doubleAuth;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {textes.titre}
      </h1>
      <div className="flex flex-col gap-2">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.introduction}</p>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textes.obligatoire}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <GestionDoubleAuth
          initial={{
            actif: etat.actif,
            codesRestants: etat.codesRestants,
            roleExigeant: etat.roleExigeant,
          }}
        />
      </div>
    </main>
  );
}
