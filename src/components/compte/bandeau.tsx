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
