"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Demande de réinitialisation du mot de passe (UC-03, étapes 1 et 2). La
// confirmation est la même pour toute adresse, avec ou sans compte (T-07) ;
// seules une limite atteinte et une erreur se distinguent. Sans JavaScript :
// un message fixe, aucun champ. Fiche : docs/features/mot-de-passe.md,
// section 7.

const TEXTES = TEXTES_COMPTE.motDePasseOublie;

type Etat =
  | {
      etape: "saisie";
      erreur?: string;
      general?: string;
      inattendue?: { incident?: string | undefined };
    }
  | { etape: "envoi" }
  | { etape: "envoye" };

export function FormulaireOubli() {
  const hydrate = useHydrate();
  const [etat, setEtat] = useState<Etat>({ etape: "saisie" });

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.etape === "envoi") return;
    const email = String(new FormData(evenement.currentTarget).get("email") ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+$/u.test(email)) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.email });
      return;
    }
    setEtat({ etape: "envoi" });
    const reponse = await appelerAuth("/request-password-reset", { email });
    if (reponse.ok) {
      setEtat({ etape: "envoye" });
      return;
    }
    if (
      reponse.raison === "trop_de_requetes" ||
      reponse.raison === "invalide" ||
      reponse.raison === "refuse"
    ) {
      setEtat({ etape: "saisie", general: TEXTES_RESULTATS[reponse.raison] });
      return;
    }
    setEtat({
      etape: "saisie",
      inattendue: { incident: reponse.raison === "erreur" ? reponse.incident : undefined },
    });
  }

  if (!hydrate) {
    return (
      <noscript>
        <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
      </noscript>
    );
  }

  if (etat.etape === "envoye") return <Bandeau etat="succes">{TEXTES.confirmation}</Bandeau>;

  return (
    <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
      {etat.etape === "saisie" && etat.general ? (
        <Bandeau etat="danger">{etat.general}</Bandeau>
      ) : null}
      {etat.etape === "saisie" && etat.inattendue ? (
        <BandeauErreur incident={etat.inattendue.incident} />
      ) : null}
      <Champ
        id="oubli-email"
        nom="email"
        libelle={TEXTES.email}
        type="email"
        autoComplete="email"
        erreur={etat.etape === "saisie" ? etat.erreur : null}
      />
      <Button
        type="submit"
        disabled={etat.etape === "envoi"}
        className="w-full sm:w-auto sm:self-start"
      >
        {etat.etape === "envoi" ? TEXTES.envoiEnCours : TEXTES.envoyer}
      </Button>
    </form>
  );
}
