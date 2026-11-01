"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

import { appelerAuth } from "@/components/compte/appel-auth";
import { Bandeau, BandeauErreur } from "@/components/compte/bandeau";
import { Champ } from "@/components/compte/champ";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CODE_TOTP,
  LONGUEUR_MAX_MOT_DE_PASSE,
  normaliserCodeSecours,
} from "@/schemas/regles-compte";
import { TEXTES_CONFIRMATION } from "@/textes/confirmation";
import { TEXTES_RESULTATS } from "@/textes/resultats";

// Fenêtre de confirmation d'une action sensible (S-14, DESIGN-SYSTEM.md,
// « Action sensible ») : récapitulatif, mot de passe, et code de
// l'application ou de secours quand le second facteur est actif, avant le
// bouton d'action. Une saisie par validation, qui peut porter plusieurs
// changements (le récapitulatif les liste). Valider pose la preuve par
// /api/auth/verify-password (1.6), puis appelle executer, qui lance l'action.
// executer rend faux si l'action a reçu nouvelle_authentification_requise
// (preuve expirée entre les deux appels) : la fenêtre reste ouverte. Les
// champs sont vidés à la fermeture ; Annuler est le bouton par défaut. Livrée
// par la 2.2, reprise par la 2.4. Fiche :
// docs/features/parametres-organisation.md, section 7.

const TEXTES = TEXTES_CONFIRMATION;

export type LigneRecapitulatif = { libelle: string; valeur: string };

type Etat = {
  secours: boolean;
  envoi: boolean;
  motDePasse?: string;
  code?: string;
  general?: string;
  incident?: string | undefined;
  inattendue?: boolean;
};

export function ConfirmationIdentite({
  ouvert,
  fermer,
  declencheur,
  introduction,
  recapitulatif,
  libelleAction,
  codeExige,
  executer,
}: {
  ouvert: boolean;
  fermer: () => void;
  // Reçoit le focus à la fermeture.
  declencheur: RefObject<HTMLButtonElement | null>;
  introduction: string;
  recapitulatif: readonly LigneRecapitulatif[];
  libelleAction: string;
  codeExige: boolean;
  executer: () => Promise<boolean>;
}) {
  const [etat, setEtat] = useState<Etat>({ secours: false, envoi: false });
  const motDePasse = useRef<HTMLDivElement | null>(null);

  function changerOuverture(suivant: boolean) {
    if (suivant || etat.envoi) return;
    setEtat({ secours: false, envoi: false });
    fermer();
  }

  async function valider(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.envoi) return;
    const formulaire = evenement.currentTarget;
    const donnees = new FormData(formulaire);
    const saisieMotDePasse = String(donnees.get("motDePasse") ?? "");
    const saisieCode = String(donnees.get("code") ?? "").trim();
    const secours = etat.secours;
    const erreurs: Pick<Etat, "motDePasse" | "code"> = {};
    if (saisieMotDePasse === "" || saisieMotDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
      erreurs.motDePasse = TEXTES.motDePasseVide;
    }
    const code = !codeExige ? null : secours ? normaliserCodeSecours(saisieCode) : saisieCode;
    if (codeExige) {
      if (saisieCode === "") erreurs.code = TEXTES.codeVide;
      else if (code === null || (!secours && !CODE_TOTP.test(code))) {
        erreurs.code = TEXTES.codeIncorrect;
      }
    }
    if (Object.keys(erreurs).length > 0) {
      setEtat({ secours, envoi: false, ...erreurs });
      return;
    }

    setEtat({ secours, envoi: true });
    const reponse = await appelerAuth(
      "/verify-password",
      code === null ? { motDePasse: saisieMotDePasse } : { motDePasse: saisieMotDePasse, code },
    );
    if (!reponse.ok) {
      switch (reponse.raison) {
        case "mot_de_passe_incorrect":
          setEtat({ secours, envoi: false, motDePasse: TEXTES.motDePasseIncorrect });
          return;
        case "code_incorrect":
          setEtat({ secours, envoi: false, code: TEXTES.codeIncorrect });
          return;
        case "invalide":
        case "refuse":
        case "trop_de_requetes":
        case "connexion_requise":
          setEtat({ secours, envoi: false, general: TEXTES_RESULTATS[reponse.raison] });
          return;
        case "erreur":
          setEtat({ secours, envoi: false, inattendue: true, incident: reponse.incident });
          return;
        default:
          setEtat({ secours, envoi: false, inattendue: true });
          return;
      }
    }
    if (await executer()) {
      setEtat({ secours: false, envoi: false });
      return;
    }
    // Preuve expirée entre les deux appels : nouvelle saisie.
    formulaire.reset();
    setEtat({
      secours,
      envoi: false,
      general: TEXTES_RESULTATS.nouvelle_authentification_requise,
    });
  }

  return (
    <Dialog open={ouvert} onOpenChange={changerOuverture}>
      <DialogContent
        showCloseButton={false}
        initialFocus={() => motDePasse.current?.querySelector("input") ?? null}
        finalFocus={declencheur}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-lg bg-card p-6 sm:max-w-md"
      >
        <DialogTitle className="font-heading text-[1.25rem] leading-7 font-semibold text-foreground">
          {TEXTES.titre}
        </DialogTitle>
        <DialogDescription className="text-[0.9375rem] leading-6 text-muted-foreground">
          {introduction}
        </DialogDescription>
        {recapitulatif.length === 0 ? null : (
          <dl className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
            {recapitulatif.map((ligne) => (
              <div key={ligne.libelle} className="flex flex-col gap-0.5">
                <dt className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                  {ligne.libelle}
                </dt>
                <dd className="text-[0.9375rem] leading-6 break-words whitespace-pre-line text-foreground">
                  {ligne.valeur}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[0.9375rem] leading-6 text-foreground">
          {codeExige ? TEXTES.introduction : TEXTES.introductionSansCode}
        </p>
        <form noValidate onSubmit={valider} className="flex flex-col gap-5">
          {etat.general ? <Bandeau etat="danger">{etat.general}</Bandeau> : null}
          {etat.inattendue ? <BandeauErreur incident={etat.incident} /> : null}
          <div ref={motDePasse}>
            <Champ
              id="confirmation-mot-de-passe"
              nom="motDePasse"
              libelle={TEXTES.motDePasse}
              type="password"
              autoComplete="current-password"
              erreur={etat.motDePasse}
            />
          </div>
          {codeExige ? (
            <div className="flex flex-col gap-2">
              <Champ
                key={etat.secours ? "secours" : "application"}
                id="confirmation-code"
                nom="code"
                libelle={etat.secours ? TEXTES.secours : TEXTES.code}
                type="text"
                inputMode={etat.secours ? "text" : "numeric"}
                autoComplete={etat.secours ? "off" : "one-time-code"}
                erreur={etat.code}
              />
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => setEtat({ secours: !etat.secours, envoi: false })}
              >
                {etat.secours ? TEXTES.utiliserApplication : TEXTES.utiliserSecours}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={etat.envoi}
              onClick={() => changerOuverture(false)}
              className="w-full sm:w-auto"
            >
              {TEXTES.annuler}
            </Button>
            <Button type="submit" disabled={etat.envoi} className="w-full sm:w-auto">
              {etat.envoi ? TEXTES.verification : libelleAction}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
