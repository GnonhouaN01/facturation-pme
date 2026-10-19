"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  CODE_TOTP,
  LONGUEUR_MAX_MOT_DE_PASSE,
  normaliserCodeSecours,
} from "@/schemas/regles-compte";
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
// Double authentification (1.4) : si le compte a un second facteur, le
// formulaire laisse place à l'étape du code (code de l'application ou code
// de secours, UC-02, étape 3 et erreurs 3a, 3b). Une connexion expirée
// ramène au mot de passe. Fiche : docs/features/double-authentification.md,
// section 4.

const TEXTES = TEXTES_COMPTE.connexion;

type Etat =
  | { etape: "saisie"; email?: string; motDePasse?: string; general?: string }
  | { etape: "inattendue"; incident?: string | undefined }
  | { etape: "envoi" }
  | { etape: "code"; secours: boolean; erreur?: string; envoi?: boolean };

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
      if (reponse.etape === "code") {
        setEtat({ etape: "code", secours: false });
        return;
      }
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

  async function verifier(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.etape !== "code" || etat.envoi) return;
    const saisie = String(new FormData(evenement.currentTarget).get("code") ?? "").trim();
    const code = etat.secours ? normaliserCodeSecours(saisie) : saisie;
    if (code === null || code === "" || (!etat.secours && !CODE_TOTP.test(code))) {
      setEtat({ ...etat, erreur: saisie === "" ? TEXTES.codeVide : TEXTES.codeIncorrect });
      return;
    }
    const secours = etat.secours;
    setEtat({ etape: "code", secours, envoi: true });
    const point = secours ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp";
    const reponse = await appelerAuth(point, { code });
    if (reponse.ok) {
      router.push("/compte");
      return;
    }
    switch (reponse.raison) {
      case "code_incorrect":
        setEtat({ etape: "code", secours, erreur: TEXTES.codeIncorrect });
        return;
      case "connexion_expiree":
        setEtat({ etape: "saisie", general: TEXTES.connexionExpiree });
        return;
      case "trop_de_requetes":
      case "invalide":
        setEtat({ etape: "code", secours, erreur: TEXTES_RESULTATS[reponse.raison] });
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

  if (etat.etape === "code") {
    return (
      <form noValidate onSubmit={verifier} className="flex flex-col gap-5">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">
          {TEXTES.introductionCode}
        </p>
        {etat.erreur ? <Bandeau etat="danger">{etat.erreur}</Bandeau> : null}
        <Champ
          key={etat.secours ? "secours" : "application"}
          id="connexion-code"
          nom="code"
          libelle={etat.secours ? TEXTES.secoursLibelle : TEXTES.codeLibelle}
          type="text"
          inputMode={etat.secours ? "text" : "numeric"}
          autoComplete={etat.secours ? "off" : "one-time-code"}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" disabled={etat.envoi === true} className="w-full sm:w-auto">
            {etat.envoi ? TEXTES.verificationEnCours : TEXTES.verifier}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => setEtat({ etape: "code", secours: !etat.secours })}
          >
            {etat.secours ? TEXTES.utiliserApplication : TEXTES.utiliserSecours}
          </Button>
        </div>
      </form>
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
