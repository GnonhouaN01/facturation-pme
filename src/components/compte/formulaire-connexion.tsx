"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { LONGUEUR_MAX_MOT_DE_PASSE } from "@/schemas/regles-compte";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Formulaire de connexion (UC-02, étapes 1, 2 et 4) : email et mot de passe,
// envoyés en JSON à /api/auth/sign-in/email. Un échec affiche le même
// message pour une adresse inconnue, un mauvais mot de passe et un compte non
// vérifié (T-07, DESIGN-SYSTEM.md « Connexion échouée »). Un succès mène à
// /compte. Sans JavaScript, aucun champ
// (useHydrate). Fiche : docs/features/connexion.md, sections 2.1 et 5.2.

const TEXTES = TEXTES_COMPTE.connexion;

type Etat =
  | { etape: "saisie"; email?: string; motDePasse?: string; general?: string }
  | { etape: "inattendue"; incident?: string | undefined }
  | { etape: "envoi" };

export function FormulaireConnexion() {
  const hydrate = useHydrate();
  const router = useRouter();
  const [etat, setEtat] = useState<Etat>({ etape: "saisie" });

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.etape === "envoi") return;
    const donnees = new FormData(evenement.currentTarget);
    const email = String(donnees.get("email") ?? "").trim();
    const motDePasse = String(donnees.get("motDePasse") ?? "");

    const erreurs: { email?: string; motDePasse?: string } = {};
    if (!/^[^@\s]+@[^@\s]+$/u.test(email)) erreurs.email = TEXTES_COMPTE.erreurs.email;
    if (motDePasse === "") erreurs.motDePasse = TEXTES_COMPTE.erreurs.motDePasse;
    else if (motDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
      erreurs.motDePasse = TEXTES_COMPTE.erreurs.motDePasseTropLong;
    }
    if (Object.keys(erreurs).length > 0) {
      setEtat({ etape: "saisie", ...erreurs });
      return;
    }

    setEtat({ etape: "envoi" });
    const reponse = await appelerAuth("/sign-in/email", { email, motDePasse });
    if (reponse.ok) {
      // La page de compte, jamais visitée dans cette session, est rendue par
      // le serveur avec le nouveau cookie.
      router.push("/compte");
      return;
    }
    switch (reponse.raison) {
      case "identifiants_incorrects":
        setEtat({ etape: "saisie", general: TEXTES.identifiantsIncorrects });
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

  if (!hydrate) {
    return (
      <noscript>
        <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
      </noscript>
    );
  }

  const saisie = etat.etape === "saisie" ? etat : null;
  return (
    <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
      {saisie?.general ? <Bandeau etat="danger">{saisie.general}</Bandeau> : null}
      {etat.etape === "inattendue" ? <BandeauErreur incident={etat.incident} /> : null}
      <Champ
        id="connexion-email"
        nom="email"
        libelle={TEXTES.email}
        type="email"
        autoComplete="email"
        erreur={saisie?.email}
      />
      <Champ
        id="connexion-mot-de-passe"
        nom="motDePasse"
        libelle={TEXTES.motDePasse}
        type="password"
        autoComplete="current-password"
        erreur={saisie?.motDePasse}
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
