"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Renvoi du lien de vérification (UC-01, erreur 4a). La confirmation est la
// même pour toute adresse, qu'un compte attende ou non sa vérification
// (T-07) ; seules une limite atteinte et une erreur se distinguent. Sans
// JavaScript, rien n'est affiché : la page qui l'accueille porte déjà son
// message. Fiche : docs/features/inscription.md, sections 4.4 et 5.1.

const TEXTES = TEXTES_COMPTE.renvoi;

// inattendue : erreur du serveur, avec son identifiant d'incident (1.2).
type Etat =
  | {
      etape: "saisie";
      erreur?: string;
      general?: string;
      inattendue?: { incident?: string | undefined };
    }
  | { etape: "envoi" }
  | { etape: "envoye" };

// sansTitre : la page qui l'accueille porte déjà le titre (/connexion/nouveau-lien).
export function FormulaireRenvoi({ sansTitre = false }: { sansTitre?: boolean }) {
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
    const reponse = await appelerAuth("/send-verification-email", { email });
    if (reponse.ok) {
      setEtat({ etape: "envoye" });
      return;
    }
    if (reponse.raison === "trop_de_requetes" || reponse.raison === "invalide") {
      setEtat({ etape: "saisie", general: TEXTES_RESULTATS[reponse.raison] });
      return;
    }
    setEtat({
      etape: "saisie",
      inattendue: { incident: reponse.raison === "erreur" ? reponse.incident : undefined },
    });
  }

  if (!hydrate) return null;

  return (
    <section
      aria-labelledby={sansTitre ? undefined : "renvoi-titre"}
      aria-label={sansTitre ? TEXTES.titre : undefined}
      className="flex flex-col gap-4"
    >
      {sansTitre ? null : (
        <h2
          id="renvoi-titre"
          className="font-heading text-[1.125rem] leading-[1.625rem] font-semibold text-foreground"
        >
          {TEXTES.titre}
        </h2>
      )}
      {etat.etape === "envoye" ? (
        <Bandeau etat="succes">{TEXTES.confirmation}</Bandeau>
      ) : (
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-4">
          {etat.etape === "saisie" && etat.general ? (
            <Bandeau etat="danger">{etat.general}</Bandeau>
          ) : null}
          {etat.etape === "saisie" && etat.inattendue ? (
            <BandeauErreur incident={etat.inattendue.incident} />
          ) : null}
          <Champ
            id="renvoi-email"
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
      )}
    </section>
  );
}
