// Gabarit de la zone des pages par lien (client final, sans compte) : le
// contenu seul, sans navigation ni lien vers l'application. Ne lit jamais la
// session : la page ne révèle rien du membre qui l'ouvrirait. Aucune page
// avant la 4.5, qui ajoutera l'en-tête au nom de l'organisation émettrice et
// lien/not-found.tsx. Fiche : docs/features/socle-interface.md, sections 1 et 10.
export default function LayoutLien({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-1 flex-col">{children}</div>;
}
