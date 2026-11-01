"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Bandeau } from "@/components/compte/bandeau";
import { Champ } from "@/components/compte/champ";
import { useHydrate } from "@/components/compte/hydrate";
import { Button } from "@/components/ui/button";
import {
  formaterTaux,
  REGLES_TEXTE,
  TAUX_MAX_PAR_ORGANISATION,
  tauxEnCentiemes,
  texteValide,
} from "@/schemas/regles-parametres";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_PARAMETRES } from "@/textes/parametres";

import { AfficherEchec, appeler, Carte, echecDe, type Echec } from "./commun";

// Taux de TVA (UC-07 étape 2) : tableau des taux, désactivation et
// réactivation (jamais de suppression), ajout. Le doublon et le plafond sont
// signalés ici, à partir de la liste affichée ; le serveur les refuse aussi.
// Fiche : docs/features/parametres-organisation.md, sections 4 et 8.

const TEXTES = TEXTES_PARAMETRES.taux;

export type TauxAffiche = { id: string; libelle: string; tauxCentiemes: number; actif: boolean };

export type ActionAjoutTaux = (entree: {
  libelle: string;
  taux: string;
}) => Promise<Resultat<null>>;
export type ActionEtatTaux = (entree: {
  tauxId: string;
  actif: boolean;
}) => Promise<Resultat<null>>;

type Erreurs = { libelle?: string; taux?: string };

const CELLULE = "px-3 py-2.5 align-middle";
const ENTETE =
  "px-3 py-2 text-left text-[0.75rem] leading-4 font-semibold tracking-[0.04em] uppercase text-muted-foreground";

export function TauxTva({
  taux,
  ajouter,
  changerEtat,
}: {
  taux: readonly TauxAffiche[];
  ajouter: ActionAjoutTaux;
  changerEtat: ActionEtatTaux;
}) {
  const hydrate = useHydrate();
  const router = useRouter();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [echec, setEchec] = useState<Echec | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  async function basculer(ligne: TauxAffiche) {
    if (envoi !== null) return;
    setEnvoi(ligne.id);
    setEchec(null);
    setSucces(null);
    const resultat = await appeler(() => changerEtat({ tauxId: ligne.id, actif: !ligne.actif }));
    setEnvoi(null);
    if (resultat?.ok) {
      setSucces(TEXTES.etatModifie);
      router.refresh();
      return;
    }
    setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
  }

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoi !== null) return;
    setEchec(null);
    setSucces(null);
    const donnees = new FormData(evenement.currentTarget);
    const libelle = String(donnees.get("libelle") ?? "");
    const saisie = String(donnees.get("taux") ?? "");
    const trouvees: Erreurs = {};
    if (libelle.trim() === "" || !texteValide(libelle, REGLES_TEXTE.libelleTaux)) {
      trouvees.libelle = TEXTES.erreurLibelle;
    }
    const centiemes = tauxEnCentiemes(saisie);
    if (centiemes === null) trouvees.taux = TEXTES.erreurTaux;
    else if (taux.some((ligne) => ligne.tauxCentiemes === centiemes))
      trouvees.taux = TEXTES.doublon;
    else if (taux.length >= TAUX_MAX_PAR_ORGANISATION) trouvees.taux = TEXTES.plafond;
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0) return;

    const formulaire = evenement.currentTarget;
    setEnvoi("ajout");
    const resultat = await appeler(() => ajouter({ libelle, taux: saisie }));
    setEnvoi(null);
    if (resultat?.ok) {
      formulaire.reset();
      setSucces(TEXTES.succes);
      router.refresh();
      return;
    }
    if (resultat !== null && resultat.raison === "invalide") {
      setErreurs({
        ...(resultat.champs.includes("libelle") ? { libelle: TEXTES.erreurLibelle } : {}),
        ...(resultat.champs.includes("taux") ? { taux: TEXTES.erreurTaux } : {}),
      });
      return;
    }
    setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
  }

  return (
    <Carte titre={TEXTES.titre} aide={TEXTES.aide}>
      <AfficherEchec echec={echec} />
      {succes === null ? null : <Bandeau etat="succes">{succes}</Bandeau>}
      {taux.length === 0 ? (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.aucun}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[28rem] border-collapse text-[0.9375rem] leading-6">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className={ENTETE}>
                  {TEXTES.libelle}
                </th>
                <th scope="col" className={`${ENTETE} text-right`}>
                  {TEXTES.taux}
                </th>
                <th scope="col" className={ENTETE}>
                  {TEXTES.etat}
                </th>
                <th scope="col" className={ENTETE}>
                  {TEXTES.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {taux.map((ligne) => (
                <tr key={ligne.id} className="border-t border-border">
                  <th scope="row" className={`${CELLULE} text-left font-normal break-words`}>
                    {ligne.libelle}
                  </th>
                  <td className={`${CELLULE} text-right font-mono`}>
                    {formaterTaux(ligne.tauxCentiemes)}
                  </td>
                  <td className={CELLULE}>
                    <span
                      className={
                        ligne.actif
                          ? "rounded-sm bg-succes-fond px-2 py-0.5 text-[0.8125rem] leading-5 font-semibold text-succes"
                          : "rounded-sm bg-muted px-2 py-0.5 text-[0.8125rem] leading-5 font-semibold text-muted-foreground"
                      }
                    >
                      {ligne.actif ? TEXTES.actif : TEXTES.desactive}
                    </span>
                  </td>
                  <td className={CELLULE}>
                    {hydrate ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={envoi !== null}
                        aria-label={[
                          ligne.actif ? TEXTES.desactiver : TEXTES.reactiver,
                          ligne.libelle,
                        ].join(" ")}
                        onClick={() => void basculer(ligne)}
                      >
                        {ligne.actif ? TEXTES.desactiver : TEXTES.reactiver}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hydrate ? (
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
          <h3 className="text-[0.9375rem] leading-6 font-semibold text-foreground">
            {TEXTES.ajouterTitre}
          </h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <Champ
              id="taux-libelle"
              nom="libelle"
              libelle={TEXTES.libelle}
              type="text"
              autoComplete="off"
              erreur={erreurs.libelle}
            />
            <Champ
              id="taux-valeur"
              nom="taux"
              libelle={TEXTES.taux}
              type="text"
              inputMode="text"
              autoComplete="off"
              erreur={erreurs.taux}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={envoi !== null}
            className="w-full sm:w-auto sm:self-start"
          >
            {envoi === "ajout" ? TEXTES_PARAMETRES.enregistrement : TEXTES.ajouter}
          </Button>
        </form>
      ) : (
        <noscript>
          <Bandeau etat="danger">{TEXTES_PARAMETRES.sansJavaScript}</Bandeau>
        </noscript>
      )}
    </Carte>
  );
}
