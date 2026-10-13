"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau } from "./bandeau";
import { FormulaireRenvoi } from "./formulaire-renvoi";

// Page /lien/verification#<jeton> (UC-01, étapes 4 et 5 ; décision 3). Le
// jeton n'est que dans le fragment, que le navigateur n'envoie jamais au
// serveur : il est lu ici, effacé aussitôt de la barre d'adresse et de
// l'historique, vérifié dans sa forme, puis envoyé dans le corps d'un POST
// par le bouton, jamais automatiquement (les robots des messageries ouvrent
// les liens, ils ne cliquent pas). Lien absent, mal formé ou refusé :
// « Ce lien n'est plus valable » et le renvoi (4a). Sans JavaScript : un
// message fixe, rien n'est envoyé. Fiche : docs/features/inscription.md,
// section 4.3.

const TEXTES = TEXTES_COMPTE.verification;
const LONGUEUR_MAX_JETON = 1024;
const JETON = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

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
    jetonLu = brut.length <= LONGUEUR_MAX_JETON && JETON.test(brut) ? brut : null;
  }
  return jetonLu;
}

function suivreFragment(rappel: () => void): () => void {
  window.addEventListener("hashchange", rappel);
  return () => window.removeEventListener("hashchange", rappel);
}

type Etat = "attente" | "envoi" | "invalide" | "trop_de_requetes" | "erreur";

export function ConfirmationVerification() {
  const router = useRouter();
  // undefined : rendu du serveur, avant la lecture du fragment.
  const jeton = useSyncExternalStore(suivreFragment, lireFragment, () => undefined);
  const [etat, setEtat] = useState<Etat>("attente");

  async function confirmer() {
    if (!jeton || etat === "envoi") return;
    setEtat("envoi");
    const reponse = await appelerAuth("/verify-email", { jeton });
    if (reponse.ok) {
      router.replace("/inscription/verifiee");
      return;
    }
    if (reponse.raison === "lien_invalide" || reponse.raison === "invalide") setEtat("invalide");
    else if (reponse.raison === "trop_de_requetes") setEtat("trop_de_requetes");
    else setEtat("erreur");
  }

  const invalide = jeton === null || etat === "invalide";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-[2rem] leading-9.5 font-semibold tracking-[-0.02em] text-foreground">
        {invalide ? TEXTES.lienInvalide : TEXTES.titre}
      </h1>
      {jeton === undefined ? (
        <noscript>
          <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
        </noscript>
      ) : invalide ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <FormulaireRenvoi />
        </div>
      ) : (
        <>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.message}</p>
          {etat === "trop_de_requetes" ? (
            <Bandeau etat="danger">{TEXTES_RESULTATS.trop_de_requetes}</Bandeau>
          ) : null}
          {etat === "erreur" ? <Bandeau etat="danger">{TEXTES_RESULTATS.erreur}</Bandeau> : null}
          <Button
            type="button"
            onClick={confirmer}
            disabled={etat === "envoi"}
            className="w-full sm:w-auto sm:self-start"
          >
            {etat === "envoi" ? TEXTES.confirmationEnCours : TEXTES.confirmer}
          </Button>
        </>
      )}
    </div>
  );
}
