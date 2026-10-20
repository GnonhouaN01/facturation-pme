"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  LONGUEUR_MAX_MOT_DE_PASSE,
  LONGUEUR_MAX_NOM,
  LONGUEUR_MIN_MOT_DE_PASSE,
} from "@/schemas/regles-compte";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth, type ReponseAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Les deux formulaires de /compte/profil (1.5) : corriger son nom (report de
// la 1.3, décision B) et changer son mot de passe depuis la session (S-17).
// Le serveur refait chaque contrôle ; ici, seules les longueurs sont
// vérifiées avant l'envoi. Aucun appel avant un clic. Après un changement du
// mot de passe, la réponse a posé le cookie de la session neuve : le
// navigateur reste connecté. Fiche : docs/features/profil-sessions.md,
// sections 4, 5 et 9.

const TEXTES = TEXTES_COMPTE.profil;
const TITRE_2 = "font-heading text-[1.25rem] leading-7 font-semibold text-foreground";

type Etat =
  | { etape: "saisie"; erreur?: string; general?: string }
  | { etape: "inattendue"; incident?: string | undefined }
  | { etape: "envoi" }
  | { etape: "fait" };

function etatDe(reponse: Exclude<ReponseAuth, { ok: true }>): Etat {
  switch (reponse.raison) {
    case "mot_de_passe_incorrect":
      return { etape: "saisie", general: TEXTES.motDePasseIncorrect };
    case "mot_de_passe_trop_court":
      return { etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropCourt };
    case "mot_de_passe_compromis":
      return { etape: "saisie", general: TEXTES_COMPTE.erreurs.motDePasseCompromis };
    case "trop_de_requetes":
    case "invalide":
    case "refuse":
    case "connexion_requise":
      return { etape: "saisie", general: TEXTES_RESULTATS[reponse.raison] };
    case "erreur":
      return { etape: "inattendue", incident: reponse.incident };
    default:
      return { etape: "inattendue" };
  }
}

function lire(evenement: FormEvent<HTMLFormElement>, nom: string): string {
  return String(new FormData(evenement.currentTarget).get(nom) ?? "");
}

function Resultat({ etat, succes }: { etat: Etat; succes: string }) {
  if (etat.etape === "fait") return <Bandeau etat="succes">{succes}</Bandeau>;
  if (etat.etape === "inattendue") return <BandeauErreur incident={etat.incident} />;
  if (etat.etape === "saisie" && etat.general)
    return <Bandeau etat="danger">{etat.general}</Bandeau>;
  return null;
}

export function FormulaireNom({ nom }: { nom: string }) {
  const hydrate = useHydrate();
  const [etat, setEtat] = useState<Etat>({ etape: "saisie" });

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.etape === "envoi") return;
    const saisi = lire(evenement, "nom").trim();
    if (saisi === "" || saisi.length > LONGUEUR_MAX_NOM) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.nom });
      return;
    }
    setEtat({ etape: "envoi" });
    const reponse = await appelerAuth("/update-user", { nom: saisi });
    setEtat(reponse.ok ? { etape: "fait" } : etatDe(reponse));
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
      <h2 className={TITRE_2}>{TEXTES.nomTitre}</h2>
      <Resultat etat={etat} succes={TEXTES.nomEnregistre} />
      <Champ
        id="profil-nom"
        nom="nom"
        libelle={TEXTES.nom}
        type="text"
        autoComplete="name"
        valeurInitiale={nom}
        erreur={saisie?.erreur}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={etat.etape === "envoi"}
        className="w-full sm:w-auto sm:self-start"
      >
        {etat.etape === "envoi" ? TEXTES.envoiEnCours : TEXTES.enregistrerNom}
      </Button>
    </form>
  );
}

export function FormulaireMotDePasse() {
  const hydrate = useHydrate();
  const [etat, setEtat] = useState<Etat>({ etape: "saisie" });

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (etat.etape === "envoi") return;
    const formulaire = evenement.currentTarget;
    const motDePasseActuel = lire(evenement, "motDePasseActuel");
    const nouveauMotDePasse = lire(evenement, "nouveauMotDePasse");
    if (motDePasseActuel === "") {
      setEtat({ etape: "saisie", general: TEXTES_COMPTE.erreurs.motDePasse });
      return;
    }
    if (nouveauMotDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropCourt });
      return;
    }
    if (nouveauMotDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE) {
      setEtat({ etape: "saisie", erreur: TEXTES_COMPTE.erreurs.motDePasseTropLong });
      return;
    }
    setEtat({ etape: "envoi" });
    const reponse = await appelerAuth("/change-password", { motDePasseActuel, nouveauMotDePasse });
    if (reponse.ok) {
      formulaire.reset();
      setEtat({ etape: "fait" });
      return;
    }
    setEtat(etatDe(reponse));
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
      <div className="flex flex-col gap-2">
        <h2 className={TITRE_2}>{TEXTES.motDePasseTitre}</h2>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.motDePasseAide}</p>
      </div>
      <Resultat etat={etat} succes={TEXTES.motDePasseChange} />
      <Champ
        id="profil-mot-de-passe-actuel"
        nom="motDePasseActuel"
        libelle={TEXTES.motDePasseActuel}
        type="password"
        autoComplete="current-password"
      />
      <Champ
        id="profil-nouveau-mot-de-passe"
        nom="nouveauMotDePasse"
        libelle={TEXTES.nouveauMotDePasse}
        type="password"
        autoComplete="new-password"
        aide={TEXTES_COMPTE.reinitialisation.regleMotDePasse}
        erreur={saisie?.erreur}
      />
      <Button
        type="submit"
        disabled={etat.etape === "envoi"}
        className="w-full sm:w-auto sm:self-start"
      >
        {etat.etape === "envoi" ? TEXTES.envoiEnCours : TEXTES.changer}
      </Button>
    </form>
  );
}
