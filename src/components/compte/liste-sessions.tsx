"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { useHydrate } from "./hydrate";

// Liste des sessions (UC-05, 1.5) : chaque session reçue du serveur par son
// identifiant, son appareil décrit en liste fermée, son adresse IP et ses
// dates déjà mises en forme ; jamais un jeton. « Fermer » et « Fermer les
// autres sessions » appellent la passerelle, puis la page est relue en base
// (router.refresh) : la liste affichée est la preuve. La session courante se
// ferme par « Se déconnecter ». Fiche : docs/features/profil-sessions.md,
// sections 3 et 9.

const TEXTES = TEXTES_COMPTE.sessions;

export type SessionListee = {
  id: string;
  courante: boolean;
  appareil: string;
  adresseIp: string | null;
  ouverteLe: string;
  expireLe: string;
};

type Erreur = { texte?: string; incident?: string | undefined; inattendue?: boolean };

export function ListeSessions({ sessions }: { sessions: SessionListee[] }) {
  const hydrate = useHydrate();
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<Erreur | null>(null);

  async function fermer(point: "/revoke-session" | "/revoke-other-sessions", corps: unknown) {
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    const reponse = await appelerAuth(point, corps);
    if (reponse.ok) {
      router.refresh();
    } else if (reponse.raison === "erreur") {
      setErreur({ inattendue: true, incident: reponse.incident });
    } else if (
      reponse.raison === "trop_de_requetes" ||
      reponse.raison === "invalide" ||
      reponse.raison === "refuse" ||
      reponse.raison === "connexion_requise"
    ) {
      setErreur({ texte: TEXTES_RESULTATS[reponse.raison] });
    } else {
      setErreur({ inattendue: true });
    }
    setEnvoi(false);
  }

  const autres = sessions.filter((session) => !session.courante).length;
  return (
    <div className="flex flex-col gap-5">
      {erreur?.inattendue ? <BandeauErreur incident={erreur.incident} /> : null}
      {erreur?.texte ? <Bandeau etat="danger">{erreur.texte}</Bandeau> : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {sessions.map((session) => (
          <li
            key={session.id}
            data-testid="session"
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.9375rem] leading-6 font-semibold text-foreground">
                  {session.appareil}
                </p>
                {session.courante ? (
                  <span className="rounded-sm bg-accent px-2 py-0.5 text-[0.8125rem] leading-5 font-semibold text-primary">
                    {TEXTES.courante}
                  </span>
                ) : null}
              </div>
              <p className="text-[0.875rem] leading-5 break-words text-muted-foreground">
                {TEXTES.adresseIp}{" "}
                <span className="font-mono">{session.adresseIp ?? TEXTES.adresseInconnue}</span>
              </p>
              <p className="text-[0.875rem] leading-5 text-muted-foreground">
                {TEXTES.ouverteLe} <span className="font-mono">{session.ouverteLe}</span>
              </p>
              <p className="text-[0.875rem] leading-5 text-muted-foreground">
                {TEXTES.expireLe} <span className="font-mono">{session.expireLe}</span>
              </p>
            </div>
            {session.courante || !hydrate ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={envoi}
                className="w-full sm:w-auto"
                onClick={() => fermer("/revoke-session", { session: session.id })}
              >
                {TEXTES.fermer}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!hydrate ? (
        <noscript>
          <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
        </noscript>
      ) : autres > 0 ? (
        <Button
          type="button"
          variant="outline"
          disabled={envoi}
          className="w-full sm:w-auto sm:self-start"
          onClick={() => fermer("/revoke-other-sessions", {})}
        >
          {envoi ? TEXTES.envoiEnCours : TEXTES.fermerAutres}
        </Button>
      ) : (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.aucuneAutre}</p>
      )}
    </div>
  );
}
