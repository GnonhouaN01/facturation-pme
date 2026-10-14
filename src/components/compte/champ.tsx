// Champ de formulaire selon Signal (DESIGN-SYSTEM.md, « Composants ») :
// libellé toujours visible au-dessus, fond surface, bordure ligne-forte,
// hauteur de 44 px, anneau de focus accent. En erreur : bordure danger,
// message sous le champ, relié par aria-describedby (comme l'aide).
// Fiche : docs/features/inscription.md, section 5.1.

type Proprietes = {
  id: string;
  nom: string;
  libelle: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  aide?: string;
  erreur?: string | null;
  desactive?: boolean;
};

export function Champ({
  id,
  nom,
  libelle,
  type,
  autoComplete,
  aide,
  erreur,
  desactive,
}: Proprietes) {
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [aide ? idAide : null, erreur ? idErreur : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.875rem] leading-5 font-medium text-foreground">
        {libelle}
      </label>
      <input
        id={id}
        name={nom}
        type={type}
        autoComplete={autoComplete}
        disabled={desactive}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={decrit || undefined}
        className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-[0.9375rem] leading-6 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring disabled:opacity-50 aria-invalid:border-destructive"
      />
      {aide ? (
        <p id={idAide} className="text-[0.8125rem] leading-5 text-muted-foreground">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p id={idErreur} className="text-[0.8125rem] leading-5 text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
