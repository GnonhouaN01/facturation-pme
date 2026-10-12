"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { EntreeNavigation } from "@/server/autorisation/navigation";
import { TEXTES_NAVIGATION } from "@/textes/navigation";

// Navigation principale. Les entrées arrivent déjà filtrées par la matrice,
// côté serveur (entreesVisibles) : une entrée refusée n'atteint jamais le
// navigateur. L'entrée active est celle dont le chemin est exactement
// l'adresse courante ; elle se distingue par le fond, la couleur et la graisse
// du texte, et par aria-current. Une sous-page (/clients/123) n'active pas
// son entrée (« Limites connues »). Fiche : docs/features/socle-interface.md,
// sections 2.4 et 10.

const LIBELLES: Readonly<Record<string, string>> = TEXTES_NAVIGATION.entrees;

function libelle(cle: string): string {
  const trouve = Object.hasOwn(LIBELLES, cle) ? LIBELLES[cle] : undefined;
  if (trouve === undefined) throw new Error("Entrée de navigation sans libellé.");
  return trouve;
}

export function Navigation({ entrees }: { entrees: readonly EntreeNavigation[] }) {
  const adresse = usePathname();
  return (
    <nav aria-label={TEXTES_NAVIGATION.nom}>
      <ul className="flex flex-col gap-0.5">
        {entrees.map((entree) => {
          const active = entree.chemin === adresse;
          return (
            <li key={entree.chemin}>
              <Link
                href={entree.chemin}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 py-2.5 text-[0.9375rem] leading-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
                  active
                    ? "bg-accent font-semibold text-primary"
                    : "font-medium text-foreground hover:bg-muted",
                )}
              >
                {libelle(entree.cle)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
