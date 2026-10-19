// Le code QR de l'activation (1.4), tracé par React depuis la matrice calculée
// sur le serveur : un rectangle d'un module par 1, dans un seul chemin, avec
// une marge de 4 modules. Fond blanc et modules noirs quel que soit le thème :
// l'appareil photo d'un téléphone lit mal un code inversé. Ni attribut style
// (règle P), ni contenu injecté (règle O), ni image distante. Une matrice hors
// forme ne trace rien. Fiche : docs/features/double-authentification.md,
// section 11.3.

const MARGE = 4;
const LIGNE = /^[01]+$/u;

export function CodeQr({ lignes, libelle }: { lignes: readonly string[]; libelle: string }) {
  const taille = lignes.length;
  if (taille === 0 || lignes.some((ligne) => ligne.length !== taille || !LIGNE.test(ligne))) {
    return null;
  }
  const cote = taille + 2 * MARGE;
  let chemin = "";
  lignes.forEach((ligne, y) => {
    for (let x = 0; x < ligne.length; x += 1) {
      if (ligne[x] === "1") chemin += `M${x + MARGE} ${y + MARGE}h1v1h-1z`;
    }
  });
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${cote} ${cote}`}
      role="img"
      aria-label={libelle}
      shapeRendering="crispEdges"
      className="h-auto w-full max-w-60 rounded-md border border-border"
    >
      <rect width={cote} height={cote} fill="#ffffff" />
      <path d={chemin} fill="#000000" />
    </svg>
  );
}
