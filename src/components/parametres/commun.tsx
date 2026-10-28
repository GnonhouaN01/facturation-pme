"use client";

import type { ReactNode } from "react";

import { Bandeau, BandeauErreur } from "@/components/compte/bandeau";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_RESULTATS } from "@/textes/resultats";

// Éléments partagés par les cartes de /parametres (2.2) : carte, zone de
// texte sur plusieurs lignes, échec d'une action. Signal : carte en surface,
// bordure ligne, pas d'ombre ; champ de 44 px au moins, libellé visible,
// erreur reliée au champ. Fiche : docs/features/parametres-organisation.md,
// section 8.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const TITRE_2 = "font-heading text-[1.25rem] leading-7 font-semibold text-foreground";
export const AIDE = "text-[0.875rem] leading-5 text-muted-foreground";

export function Carte({
  titre,
  aide,
  children,
}: {
  titre: string;
  aide?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-col gap-1">
        <h2 className={TITRE_2}>{titre}</h2>
        {aide === undefined ? null : <p className={AIDE}>{aide}</p>}
      </div>
      {children}
    </section>
  );
}

export type Echec = { general?: string; incident?: string | undefined; inattendue?: boolean };

export function echecDe(resultat: Exclude<Resultat<unknown>, { ok: true }>): Echec {
  if (resultat.raison === "erreur") {
    return {
      inattendue: true,
      incident: UUID.test(resultat.incident) ? resultat.incident : undefined,
    };
  }
  return { general: TEXTES_RESULTATS[resultat.raison] };
}

// Un appel d'action qui lève (réseau coupé, réponse illisible) : erreur
// inattendue, sans incident.
export async function appeler<T>(appel: () => Promise<Resultat<T>>): Promise<Resultat<T> | null> {
  try {
    return await appel();
  } catch {
    return null;
  }
}

export function AfficherEchec({ echec }: { echec: Echec | null }) {
  if (echec === null) return null;
  if (echec.inattendue) return <BandeauErreur incident={echec.incident} />;
  return echec.general ? <Bandeau etat="danger">{echec.general}</Bandeau> : null;
}

// Zone de texte sur plusieurs lignes, mêmes règles que Champ
// (src/components/compte/champ.tsx).
export function ZoneTexte({
  id,
  nom,
  libelle,
  aide,
  erreur,
  valeurInitiale,
  lignes,
}: {
  id: string;
  nom: string;
  libelle: string;
  aide?: string;
  erreur?: string | null;
  valeurInitiale: string;
  lignes: number;
}) {
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [aide ? idAide : null, erreur ? idErreur : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.875rem] leading-5 font-medium text-foreground">
        {libelle}
      </label>
      <textarea
        id={id}
        name={nom}
        rows={lignes}
        defaultValue={valeurInitiale}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={decrit || undefined}
        className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2.5 text-[0.9375rem] leading-6 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring aria-invalid:border-destructive"
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
