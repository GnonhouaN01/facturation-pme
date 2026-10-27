import { type BlocDonnees, TEXTES_DONNEES_PERSONNELLES } from "@/textes/donnees-personnelles";

// Données personnelles (information des personnes, loi n° 2013-450), dans la
// zone publique : contenu fixe, ne lit jamais la session ; un utilisateur
// connecté la lit aussi. Aucune ressource externe : les deux liens hors de
// l'application (email, site de l'ARTCI) ne chargent rien. Fiche :
// docs/features/donnees-personnelles.md, section 4.

const TEXTES = TEXTES_DONNEES_PERSONNELLES;
const CORPS = "text-[0.9375rem] leading-6 text-foreground";
const LIEN =
  "inline-flex min-h-11 items-center self-start rounded-md text-[0.9375rem] leading-6 font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

function Bloc({ bloc }: { bloc: BlocDonnees }) {
  switch (bloc.type) {
    case "paragraphe":
      return <p className={CORPS}>{bloc.texte}</p>;
    case "liste":
      return (
        <ul className={`flex list-disc flex-col gap-2 pl-5 ${CORPS}`}>
          {bloc.elements.map((element) => (
            <li key={element}>{element}</li>
          ))}
        </ul>
      );
    case "lien":
      return (
        <a href={bloc.adresse} className={LIEN}>
          {bloc.libelle}
        </a>
      );
    case "traitement":
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
          <h3 className="font-heading text-[1.0625rem] leading-6 font-semibold break-all text-foreground">
            {bloc.titre}
          </h3>
          <dl className="flex flex-col gap-3">
            {bloc.lignes.map(([terme, valeur]) => (
              <div key={terme} className="flex flex-col gap-1">
                <dt className="text-[0.75rem] leading-4 font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  {terme}
                </dt>
                <dd className={CORPS}>{valeur}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
  }
}

export default function PageDonneesPersonnelles() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 md:px-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
          {TEXTES.titre}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.introduction}</p>
        <p className="text-[0.8125rem] leading-5 text-muted-foreground">{TEXTES.miseAJour}</p>
      </div>
      {TEXTES.sections.map((section) => (
        <section key={section.titre} className="flex flex-col gap-4">
          <h2 className="font-heading text-[1.25rem] leading-7 font-semibold text-foreground">
            {section.titre}
          </h2>
          {section.blocs.map((bloc, rang) => (
            <Bloc key={rang} bloc={bloc} />
          ))}
        </section>
      ))}
    </main>
  );
}
