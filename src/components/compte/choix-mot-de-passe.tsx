"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  JETON_REINITIALISATION,
  LONGUEUR_MAX_MOT_DE_PASSE,
  LONGUEUR_MIN_MOT_DE_PASSE,
} from "@/schemas/regles-compte";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";

// Page /lien/reinitialisation#<jeton> (UC-03, étapes 3 et 4). Comme la
// vérification de l'adresse : le jeton n'est que dans le fragment, que le
// navigateur n'envoie jamais au serveur ; il est lu ici, effacé aussitôt de
// la barre d'adresse et de l'historique, vérifié dans sa forme, puis envoyé
// dans le corps du POST par le bouton, jamais automatiquement (un robot de
// messagerie qui ouvre le lien ne consomme rien). Lien absent, mal formé,
// expiré ou déjà utilisé : « Ce lien n'est plus valable » et une nouvelle
// demande (3a). Sans JavaScript : un message fixe. Fiche :
// docs/features/mot-de-passe.md, sections 3.4 et 7.

const TEXTES = TEXTES_COMPTE.reinitialisation;
const TITRE =
  "font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground";
const LIEN =
  "inline-flex min-h-11 items-center self-start rounded-md text-[0.9375rem] leading-6 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

// Jeton lu du fragment : une chaîne, null (absent ou mal formé). Lu une fois
// par fragment, puis effacé ; un nouveau fragment (hashchange) est relu.
let jetonLu: string | null | undefined;

function lireFragment(): string | null {
  if (jetonLu === undefined || window.location.hash !== "") {
    const brut = window.location.hash.slice(1);
    if (window.location.hash !== "") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
    jetonLu = JETON_REINITIALISATION.test(brut) ? brut : null;
  }
  return jetonLu;
}

function suivreFragment(rappel: () => void): () => void {
  window.addEventListener("hashchange", rappel);
  return () => window.removeEventListener("hashchange", rappel);
}

type Etat =
  | { etape: "saisie"; erreur?: string; general?: string; incident?: string | undefined }
  | { etape: "inattendue"; incident?: string | undefined }
  | { etape: "envoi" }
  | { etape: "invalide" }
  | { etape: "modifie" };

export function ChoixMotDePasse() {
  // undefined : rendu du serveur, avant la lecture du fragment.
  const jeton = useSyncExternalStore(suivreFragment, lireFragment, () => undefined);
  const [etat, setEtat] = useState<Etat>({ etape: "saisie" });

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!jeton || etat.etape === "envoi") return;
    const motDePasse = String(new FormData(evenement.currentTarget).get("motDePasse") ?? "");
    if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropCourt });
      return;
    }
    if (motDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropLong });
      return;
    }
    setEtat({ etape: "envoi" });
    const reponse = await appelerAuth("/reset-password", { jeton, motDePasse });
    if (reponse.ok) {
      setEtat({ etape: "modifie" });
      return;
    }
    switch (reponse.raison) {
      case "lien_invalide":
        setEtat({ etape: "invalide" });
        return;
      case "mot_de_passe_trop_court":
        setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropCourt });
        return;
      case "mot_de_passe_compromis":
        setEtat({ etape: "saisie", general: TEXTES_COMPTE.erreurs.motDePasseCompromis });
        return;
      case "trop_de_requetes":
      case "invalide":
      case "refuse":
        setEtat({ etape: "saisie", general: TEXTES_RESULTATS[reponse.raison] });
        return;
      case "erreur":
        setEtat({ etape: "inattendue", incident: reponse.incident });
        return;
      default:
        setEtat({ etape: "inattendue" });
    }
  }

  if (jeton === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className={TITRE}>{TEXTES.titre}</h1>
        <noscript>
          <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
        </noscript>
      </div>
    );
  }

  if (jeton === null || etat.etape === "invalide") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className={TITRE}>{TEXTES.lienInvalide}</h1>
        <Link href="/mot-de-passe-oublie" className={LIEN}>
          {TEXTES.nouveauLien}
        </Link>
      </div>
    );
  }

  if (etat.etape === "modifie") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className={TITRE}>{TEXTES.modifie}</h1>
        <Bandeau etat="succes">{TEXTES.confirmation}</Bandeau>
        <Link href="/connexion" className={LIEN}>
          {TEXTES.seConnecter}
        </Link>
      </div>
    );
  }

  const saisie = etat.etape === "saisie" ? etat : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className={TITRE}>{TEXTES.titre}</h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.message}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
          {saisie?.general ? <Bandeau etat="danger">{saisie.general}</Bandeau> : null}
          {etat.etape === "inattendue" ? <BandeauErreur incident={etat.incident} /> : null}
          <Champ
            id="reinitialisation-mot-de-passe"
            nom="motDePasse"
            libelle={TEXTES.motDePasse}
            type="password"
            autoComplete="new-password"
            aide={TEXTES.regleMotDePasse}
            erreur={saisie?.erreur}
          />
          <Button
            type="submit"
            disabled={etat.etape === "envoi"}
            className="w-full sm:w-auto sm:self-start"
          >
            {etat.etape === "envoi" ? TEXTES.enregistrementEnCours : TEXTES.enregistrer}
          </Button>
        </form>
      </div>
    </div>
  );
}
