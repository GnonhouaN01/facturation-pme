"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { LONGUEUR_MAX_MOT_DE_PASSE, LONGUEUR_MIN_MOT_DE_PASSE } from "@/schemas/regles-compte";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth, type ReponseAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Formulaire d'inscription (UC-01, étapes 1 à 3) : nom, email, mot de passe,
// envoyés en JSON à /api/auth/sign-up/email. Le serveur refait toutes les
// vérifications ; celles d'ici n'évitent qu'un aller-retour. La réponse ne
// dit jamais si l'adresse a un compte (T-07) : un succès mène toujours à
// « Vérifiez votre boîte ». Sans JavaScript, aucun champ (useHydrate).
// Fiche : docs/features/inscription.md, section 5.1.

// inattendue : erreur du serveur, affichée avec son identifiant d'incident
// (1.2, docs/features/connexion.md, section 6).
type Erreurs = {
  nom?: string;
  email?: string;
  motDePasse?: string;
  generale?: string;
  inattendue?: { incident?: string | undefined };
};

const TEXTES = TEXTES_COMPTE.inscription;

function erreursLocales(nom: string, email: string, motDePasse: string): Erreurs {
  const erreurs: Erreurs = {};
  if (nom.trim() === "") erreurs.nom = TEXTES_COMPTE.erreurs.nom;
  if (!/^[^@\s]+@[^@\s]+$/u.test(email.trim())) erreurs.email = TEXTES_COMPTE.erreurs.email;
  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    erreurs.motDePasse = TEXTES_COMPTE.erreurs.motDePasseTropCourt;
  } else if (motDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
    erreurs.motDePasse = TEXTES_COMPTE.erreurs.motDePasseTropLong;
  }
  return erreurs;
}

function erreursServeur(reponse: Exclude<ReponseAuth, { ok: true }>): Erreurs {
  switch (reponse.raison) {
    case "mot_de_passe_trop_court":
      return { motDePasse: TEXTES_COMPTE.erreurs.motDePasseTropCourt };
    case "mot_de_passe_compromis":
      return { motDePasse: TEXTES_COMPTE.erreurs.motDePasseCompromis };
    case "invalide":
      return { generale: TEXTES_RESULTATS.invalide };
    case "trop_de_requetes":
      return { generale: TEXTES_RESULTATS.trop_de_requetes };
    case "refuse":
      return { generale: TEXTES_RESULTATS.refuse };
    case "erreur":
      return { inattendue: { incident: reponse.incident } };
    default:
      return { inattendue: {} };
  }
}

export function FormulaireInscription() {
  const hydrate = useHydrate();
  const router = useRouter();
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoi) return;
    const donnees = new FormData(evenement.currentTarget);
    const nom = String(donnees.get("nom") ?? "");
    const email = String(donnees.get("email") ?? "").trim();
    const motDePasse = String(donnees.get("motDePasse") ?? "");

    const locales = erreursLocales(nom, email, motDePasse);
    setErreurs(locales);
    if (Object.keys(locales).length > 0) return;

    setEnvoi(true);
    const reponse = await appelerAuth("/sign-up/email", { nom, email, motDePasse });
    if (reponse.ok) {
      router.push("/inscription/envoyee");
      return;
    }
    setErreurs(erreursServeur(reponse));
    setEnvoi(false);
  }

  if (!hydrate) {
    return (
      <noscript>
        <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
      </noscript>
    );
  }

  return (
    <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
      {erreurs.generale ? <Bandeau etat="danger">{erreurs.generale}</Bandeau> : null}
      {erreurs.inattendue ? <BandeauErreur incident={erreurs.inattendue.incident} /> : null}
      <Champ
        id="inscription-nom"
        nom="nom"
        libelle={TEXTES.nom}
        type="text"
        autoComplete="name"
        erreur={erreurs.nom}
      />
      <Champ
        id="inscription-email"
        nom="email"
        libelle={TEXTES.email}
        type="email"
        autoComplete="email"
        erreur={erreurs.email}
      />
      <Champ
        id="inscription-mot-de-passe"
        nom="motDePasse"
        libelle={TEXTES.motDePasse}
        type="password"
        autoComplete="new-password"
        aide={TEXTES.regleMotDePasse}
        erreur={erreurs.motDePasse}
      />
      <Button type="submit" disabled={envoi} className="w-full sm:w-auto sm:self-start">
        {envoi ? TEXTES.envoiEnCours : TEXTES.envoyer}
      </Button>
    </form>
  );
}
