"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Bandeau } from "@/components/compte/bandeau";
import { Champ } from "@/components/compte/champ";
import { useHydrate } from "@/components/compte/hydrate";
import { Button } from "@/components/ui/button";
import { raisonSocialeValide } from "@/schemas/regles-organisation";
import { lireDelai, REGLES_TEXTE, texteValide } from "@/schemas/regles-parametres";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_PARAMETRES } from "@/textes/parametres";

import { AfficherEchec, appeler, Carte, echecDe, ZoneTexte, type Echec } from "./commun";

// Fiche de l'organisation (F-011, UC-07 étape 1) : une seule validation pour
// tous les champs, seul bouton principal de l'écran. Le serveur refait
// chaque contrôle ; ici, les mêmes règles avant l'envoi. Fiche :
// docs/features/parametres-organisation.md, sections 3 et 8.

const TEXTES = TEXTES_PARAMETRES.fiche;

export type FicheAffichee = {
  raisonSociale: string;
  adresse: string | null;
  ncc: string | null;
  rccm: string | null;
  regimeImposition: string | null;
  mentionsLegales: string | null;
  validiteDevisJours: number;
  echeanceFactureJours: number;
};

export type EntreeFiche = {
  raisonSociale: string;
  adresse: string;
  ncc: string;
  rccm: string;
  regimeImposition: string;
  mentionsLegales: string;
  validiteDevisJours: number;
  echeanceFactureJours: number;
};

export type ActionFiche = (entree: EntreeFiche) => Promise<Resultat<null>>;

type Erreurs = Partial<Record<keyof EntreeFiche, string>>;

function lire(donnees: FormData, nom: string): string {
  return String(donnees.get(nom) ?? "");
}

// Contrôles du navigateur, mêmes règles que le schéma du serveur.
function controler(donnees: FormData): { entree: EntreeFiche | null; erreurs: Erreurs } {
  const erreurs: Erreurs = {};
  const raisonSociale = lire(donnees, "raisonSociale");
  if (!raisonSocialeValide(raisonSociale)) erreurs.raisonSociale = TEXTES.erreurRaisonSociale;
  const textes = {
    adresse: REGLES_TEXTE.adresse,
    ncc: REGLES_TEXTE.ncc,
    rccm: REGLES_TEXTE.rccm,
    regimeImposition: REGLES_TEXTE.regimeImposition,
    mentionsLegales: REGLES_TEXTE.mentionsLegales,
  } as const;
  for (const [nom, regle] of Object.entries(textes)) {
    if (!texteValide(lire(donnees, nom), regle)) {
      erreurs[nom as keyof typeof textes] =
        nom === "ncc" || nom === "rccm" ? TEXTES.erreurIdentifiant : TEXTES.erreurTexte;
    }
  }
  const validite = lireDelai(lire(donnees, "validiteDevisJours"));
  const echeance = lireDelai(lire(donnees, "echeanceFactureJours"));
  if (validite === null) erreurs.validiteDevisJours = TEXTES.erreurDelai;
  if (echeance === null) erreurs.echeanceFactureJours = TEXTES.erreurDelai;
  if (Object.keys(erreurs).length > 0 || validite === null || echeance === null) {
    return { entree: null, erreurs };
  }
  return {
    entree: {
      raisonSociale,
      adresse: lire(donnees, "adresse"),
      ncc: lire(donnees, "ncc"),
      rccm: lire(donnees, "rccm"),
      regimeImposition: lire(donnees, "regimeImposition"),
      mentionsLegales: lire(donnees, "mentionsLegales"),
      validiteDevisJours: validite,
      echeanceFactureJours: echeance,
    },
    erreurs,
  };
}

// Champs du serveur en erreur (chemins de Zod) traduits en messages.
function erreursDuServeur(champs: readonly string[]): Erreurs {
  const erreurs: Erreurs = {};
  for (const champ of champs) {
    if (champ === "raisonSociale") erreurs.raisonSociale = TEXTES.erreurRaisonSociale;
    else if (champ === "ncc" || champ === "rccm") erreurs[champ] = TEXTES.erreurIdentifiant;
    else if (champ === "validiteDevisJours" || champ === "echeanceFactureJours") {
      erreurs[champ] = TEXTES.erreurDelai;
    } else if (champ === "adresse" || champ === "regimeImposition" || champ === "mentionsLegales") {
      erreurs[champ] = TEXTES.erreurTexte;
    }
  }
  return erreurs;
}

export function FormulaireFiche({
  fiche,
  enregistrer,
}: {
  fiche: FicheAffichee;
  enregistrer: ActionFiche;
}) {
  const hydrate = useHydrate();
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [echec, setEchec] = useState<Echec | null>(null);
  const [succes, setSucces] = useState(false);

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoi) return;
    setEchec(null);
    setSucces(false);
    const { entree, erreurs: trouvees } = controler(new FormData(evenement.currentTarget));
    setErreurs(trouvees);
    if (entree === null) return;
    setEnvoi(true);
    const resultat = await appeler(() => enregistrer(entree));
    setEnvoi(false);
    if (resultat?.ok) {
      setSucces(true);
      router.refresh();
      return;
    }
    if (resultat !== null && resultat.raison === "invalide") {
      setErreurs(erreursDuServeur(resultat.champs));
      return;
    }
    setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
  }

  return (
    <Carte titre={TEXTES.titre} aide={TEXTES.aide}>
      {hydrate ? (
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
          <AfficherEchec echec={echec} />
          <Champ
            id="fiche-raison-sociale"
            nom="raisonSociale"
            libelle={TEXTES.raisonSociale}
            type="text"
            autoComplete="organization"
            valeurInitiale={fiche.raisonSociale}
            erreur={erreurs.raisonSociale}
          />
          <ZoneTexte
            id="fiche-adresse"
            nom="adresse"
            libelle={TEXTES.adresse}
            lignes={3}
            valeurInitiale={fiche.adresse ?? ""}
            erreur={erreurs.adresse}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Champ
              id="fiche-ncc"
              nom="ncc"
              libelle={TEXTES.ncc}
              type="text"
              autoComplete="off"
              aide={TEXTES.facultatif}
              valeurInitiale={fiche.ncc ?? ""}
              erreur={erreurs.ncc}
            />
            <Champ
              id="fiche-rccm"
              nom="rccm"
              libelle={TEXTES.rccm}
              type="text"
              autoComplete="off"
              aide={TEXTES.facultatif}
              valeurInitiale={fiche.rccm ?? ""}
              erreur={erreurs.rccm}
            />
          </div>
          <Champ
            id="fiche-regime"
            nom="regimeImposition"
            libelle={TEXTES.regime}
            type="text"
            autoComplete="off"
            valeurInitiale={fiche.regimeImposition ?? ""}
            erreur={erreurs.regimeImposition}
          />
          <ZoneTexte
            id="fiche-mentions"
            nom="mentionsLegales"
            libelle={TEXTES.mentions}
            aide={TEXTES.mentionsAide}
            lignes={4}
            valeurInitiale={fiche.mentionsLegales ?? ""}
            erreur={erreurs.mentionsLegales}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Champ
              id="fiche-validite"
              nom="validiteDevisJours"
              libelle={TEXTES.validite}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aide={TEXTES.delaiAide}
              valeurInitiale={String(fiche.validiteDevisJours)}
              erreur={erreurs.validiteDevisJours}
            />
            <Champ
              id="fiche-echeance"
              nom="echeanceFactureJours"
              libelle={TEXTES.echeance}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aide={TEXTES.delaiAide}
              valeurInitiale={String(fiche.echeanceFactureJours)}
              erreur={erreurs.echeanceFactureJours}
            />
          </div>
          {succes ? <Bandeau etat="succes">{TEXTES.succes}</Bandeau> : null}
          <Button type="submit" disabled={envoi} className="w-full sm:w-auto sm:self-start">
            {envoi ? TEXTES_PARAMETRES.enregistrement : TEXTES.enregistrer}
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
