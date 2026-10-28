"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Bandeau } from "@/components/compte/bandeau";
import { useHydrate } from "@/components/compte/hydrate";
import { ConfirmationIdentite } from "@/components/confirmation/confirmation-identite";
import { Button } from "@/components/ui/button";
import { normaliserTexte, REGLES_TEXTE, texteValide } from "@/schemas/regles-parametres";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_PARAMETRES } from "@/textes/parametres";

import { AfficherEchec, appeler, Carte, echecDe, ZoneTexte, type Echec } from "./commun";

// Instructions de paiement (F-057, S-14, S-33, T-12) : les deux champs se
// valident ensemble, par une seule confirmation de l'identité (mot de passe
// et code). Le bouton n'envoie rien : il ouvre la fenêtre, qui pose la
// preuve puis appelle l'action. Fiche :
// docs/features/parametres-organisation.md, sections 6 à 8.

const TEXTES = TEXTES_PARAMETRES.instructions;

export type InstructionsAffichees = { mobileMoney: string | null; bancaire: string | null };
type Entree = { mobileMoney: string; bancaire: string };

export type ActionInstructions = (entree: Entree) => Promise<Resultat<{ modifiees: boolean }>>;

type Erreurs = { mobileMoney?: string; bancaire?: string };

export function InstructionsPaiement({
  instructions,
  codeExige,
  enregistrer,
}: {
  instructions: InstructionsAffichees;
  codeExige: boolean;
  enregistrer: ActionInstructions;
}) {
  const hydrate = useHydrate();
  const router = useRouter();
  const bouton = useRef<HTMLButtonElement | null>(null);
  const [saisie, setSaisie] = useState<Entree | null>(null);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [echec, setEchec] = useState<Echec | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  function ouvrir(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    setEchec(null);
    setSucces(null);
    const donnees = new FormData(evenement.currentTarget);
    const entree = {
      mobileMoney: String(donnees.get("mobileMoney") ?? ""),
      bancaire: String(donnees.get("bancaire") ?? ""),
    };
    const trouvees: Erreurs = {};
    if (!texteValide(entree.mobileMoney, REGLES_TEXTE.mobileMoney))
      trouvees.mobileMoney = TEXTES.erreur;
    if (!texteValide(entree.bancaire, REGLES_TEXTE.bancaire)) trouvees.bancaire = TEXTES.erreur;
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0) return;
    setSaisie(entree);
  }

  // Appelée par la fenêtre une fois la preuve posée. Faux : preuve expirée,
  // la fenêtre redemande l'identité.
  async function executer(): Promise<boolean> {
    if (saisie === null) return true;
    const resultat = await appeler(() => enregistrer(saisie));
    if (
      resultat !== null &&
      !resultat.ok &&
      resultat.raison === "nouvelle_authentification_requise"
    ) {
      return false;
    }
    setSaisie(null);
    if (resultat?.ok) {
      setSucces(resultat.donnees.modifiees ? TEXTES.succes : TEXTES.sansChangement);
      router.refresh();
    } else if (resultat !== null && resultat.raison === "invalide") {
      setErreurs({
        ...(resultat.champs.includes("mobileMoney") ? { mobileMoney: TEXTES.erreur } : {}),
        ...(resultat.champs.includes("bancaire") ? { bancaire: TEXTES.erreur } : {}),
      });
    } else {
      setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
    }
    return true;
  }

  const recapitulatif =
    saisie === null
      ? []
      : [
          {
            libelle: TEXTES.mobileMoney,
            valeur: normaliserTexte(saisie.mobileMoney) ?? TEXTES.vide,
          },
          { libelle: TEXTES.bancaire, valeur: normaliserTexte(saisie.bancaire) ?? TEXTES.vide },
        ];

  return (
    <Carte titre={TEXTES.titre}>
      <p className="rounded-md bg-attention-fond px-3 py-2 text-[0.875rem] leading-5 text-attention">
        {TEXTES.avertissement}
      </p>
      <AfficherEchec echec={echec} />
      {succes === null ? null : <Bandeau etat="succes">{succes}</Bandeau>}
      {hydrate ? (
        <form noValidate onSubmit={ouvrir} className="flex flex-col gap-5">
          <ZoneTexte
            id="instructions-mobile-money"
            nom="mobileMoney"
            libelle={TEXTES.mobileMoney}
            aide={TEXTES.mobileMoneyAide}
            lignes={3}
            valeurInitiale={instructions.mobileMoney ?? ""}
            erreur={erreurs.mobileMoney}
          />
          <ZoneTexte
            id="instructions-bancaire"
            nom="bancaire"
            libelle={TEXTES.bancaire}
            aide={TEXTES.bancaireAide}
            lignes={4}
            valeurInitiale={instructions.bancaire ?? ""}
            erreur={erreurs.bancaire}
          />
          <Button
            ref={bouton}
            type="submit"
            variant="outline"
            className="w-full sm:w-auto sm:self-start"
          >
            {TEXTES.enregistrer}
          </Button>
        </form>
      ) : (
        <noscript>
          <Bandeau etat="danger">{TEXTES_PARAMETRES.sansJavaScript}</Bandeau>
        </noscript>
      )}
      <ConfirmationIdentite
        ouvert={saisie !== null}
        fermer={() => setSaisie(null)}
        declencheur={bouton}
        introduction={TEXTES.confirmation}
        recapitulatif={recapitulatif}
        libelleAction={TEXTES.enregistrer}
        codeExige={codeExige}
        executer={executer}
      />
    </Carte>
  );
}
