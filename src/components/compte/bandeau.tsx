import { TEXTES_ERREURS } from "@/textes/erreurs";

// Erreur inattendue d'un formulaire de compte (DESIGN-SYSTEM.md, « Erreur
// inattendue ») : le texte fixe, suivi de l'identifiant d'incident quand le
// serveur en a donné un (déjà vérifié au format UUID par appelerAuth). Aucun
// détail technique. Fiche : docs/features/connexion.md, section 6.
export function BandeauErreur({ incident }: { incident?: string | undefined }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-md bg-danger-fond px-3 py-2 text-[0.875rem] leading-5 text-destructive"
    >
      <p>{TEXTES_ERREURS.erreur}</p>
      {incident === undefined ? null : (
        <p className="flex flex-wrap gap-x-1">
          <span>{TEXTES_ERREURS.identifiantIncident}</span>
          <span className="font-mono select-all">{incident}</span>
        </p>
      )}
    </div>
  );
}

// Bandeau de résultat d'un formulaire de compte (DESIGN-SYSTEM.md,
// « Bandeau ») : fond d'état, texte d'état, sans bordure latérale. Lu par
// les lecteurs d'écran dès qu'il apparaît.
export function Bandeau({ etat, children }: { etat: "danger" | "succes"; children: string }) {
  return etat === "danger" ? (
    <p
      role="alert"
      className="rounded-md bg-danger-fond px-3 py-2 text-[0.875rem] leading-5 text-destructive"
    >
      {children}
    </p>
  ) : (
    <p
      role="status"
      className="rounded-md bg-succes-fond px-3 py-2 text-[0.875rem] leading-5 text-succes"
    >
      {children}
    </p>
  );
}
