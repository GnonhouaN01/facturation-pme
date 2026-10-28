"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Bandeau } from "@/components/compte/bandeau";
import { useHydrate } from "@/components/compte/hydrate";
import { Button } from "@/components/ui/button";
import { analyserLogo, encoderBase64 } from "@/lib/image/logo";
import { TAILLE_MAX_LOGO, type TypeLogo } from "@/schemas/regles-parametres";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_PARAMETRES } from "@/textes/parametres";

import { AfficherEchec, appeler, Carte, echecDe, type Echec } from "./commun";

// Logo (S-53, T-60, UC-07 1a) : le fichier est lu dans le navigateur, son
// type réel vérifié sur ses octets, puis envoyé en base64 ; le serveur refait
// le contrôle. L'aperçu est servi par la route /parametres/logo, réservée aux
// membres (politique img-src 'self', sans data:). Fiche :
// docs/features/parametres-organisation.md, sections 5 et 8.

const TEXTES = TEXTES_PARAMETRES.logo;

export type ActionLogo = (entree: { contenu: string }) => Promise<Resultat<null>>;
export type ActionRetraitLogo = (entree: Record<string, never>) => Promise<Resultat<null>>;

// version : change à chaque modification des paramètres, pour que le
// navigateur recharge l'aperçu.
export type LogoAffiche = { type: TypeLogo; version: string } | null;

export function Logo({
  logo,
  enregistrer,
  retirer,
}: {
  logo: LogoAffiche;
  enregistrer: ActionLogo;
  retirer: ActionRetraitLogo;
}) {
  const hydrate = useHydrate();
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [echec, setEchec] = useState<Echec | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  async function terminer(resultat: Resultat<null> | null, message: string) {
    setEnvoi(false);
    if (resultat?.ok) {
      setSucces(message);
      router.refresh();
      return;
    }
    if (resultat !== null && resultat.raison === "invalide") {
      setErreur(TEXTES.erreur);
      return;
    }
    setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
  }

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoi) return;
    setEchec(null);
    setSucces(null);
    const fichier = new FormData(evenement.currentTarget).get("logo");
    if (!(fichier instanceof File) || fichier.size < 1 || fichier.size > TAILLE_MAX_LOGO) {
      setErreur(TEXTES.erreur);
      return;
    }
    const octets = new Uint8Array(await fichier.arrayBuffer());
    if (analyserLogo(octets) === null) {
      setErreur(TEXTES.erreur);
      return;
    }
    setErreur(null);
    setEnvoi(true);
    await terminer(
      await appeler(() => enregistrer({ contenu: encoderBase64(octets) })),
      TEXTES.succes,
    );
  }

  async function retirerLogo() {
    if (envoi) return;
    setEchec(null);
    setSucces(null);
    setErreur(null);
    setEnvoi(true);
    await terminer(await appeler(() => retirer({})), TEXTES.retire);
  }

  return (
    <Carte titre={TEXTES.titre}>
      <AfficherEchec echec={echec} />
      {succes === null ? null : <Bandeau etat="succes">{succes}</Bandeau>}
      {logo === null ? (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.aucun}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap gap-x-1 text-[0.9375rem] leading-6 text-foreground">
            <span>{TEXTES.enregistre}</span>
            <span>{TEXTES.types[logo.type]}</span>
          </p>
          {/* Servi par notre route : next/image passerait par son optimiseur. */}
          <img
            src={`/parametres/logo?v=${encodeURIComponent(logo.version)}`}
            alt={TEXTES.apercu}
            className="max-h-24 max-w-full self-start rounded-md border border-border bg-card object-contain p-2"
          />
        </div>
      )}
      {hydrate ? (
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="logo-fichier"
              className="text-[0.875rem] leading-5 font-medium text-foreground"
            >
              {TEXTES.fichier}
            </label>
            <input
              id="logo-fichier"
              name="logo"
              type="file"
              accept="image/png,image/jpeg"
              aria-invalid={erreur ? true : undefined}
              aria-describedby={
                erreur ? "logo-fichier-aide logo-fichier-erreur" : "logo-fichier-aide"
              }
              className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-[0.9375rem] leading-6 text-foreground file:mr-3 file:min-h-8 file:rounded-sm file:border file:border-input file:bg-card file:px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring aria-invalid:border-destructive"
            />
            <p id="logo-fichier-aide" className="text-[0.8125rem] leading-5 text-muted-foreground">
              {TEXTES.aide}
            </p>
            {erreur ? (
              <p id="logo-fichier-erreur" className="text-[0.8125rem] leading-5 text-destructive">
                {erreur}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="outline" disabled={envoi} className="w-full sm:w-auto">
              {envoi ? TEXTES_PARAMETRES.enregistrement : TEXTES.enregistrer}
            </Button>
            {logo === null ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={envoi}
                className="w-full sm:w-auto"
                onClick={() => void retirerLogo()}
              >
                {TEXTES.retirer}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <noscript>
          <Bandeau etat="danger">{TEXTES_PARAMETRES.sansJavaScript}</Bandeau>
        </noscript>
      )}
    </Carte>
  );
}
