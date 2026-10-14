"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TEXTES_COMPTE } from "@/textes/compte";

import { appelerAuth } from "./appel-auth";
import { BandeauErreur } from "./bandeau";

// « Se déconnecter » (F-002), dans les gabarits de l'application et du
// compte : POST /api/auth/sign-out. La session est supprimée en base et
// vérifiée par le serveur (T-03) ; en cas d'échec, l'erreur s'affiche avec
// son identifiant d'incident et la session reste ouverte, sans déconnexion
// apparente. Un succès remplace l'entrée de l'historique par /connexion
// (navigation complète) : le retour arrière ne réaffiche pas la page quittée.
// Action secondaire : un seul bouton accent par écran. Fiche :
// docs/features/connexion.md, sections 4.2 et 5.2.

export function BoutonDeconnexion() {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{ incident?: string | undefined } | null>(null);

  async function deconnecter() {
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    const reponse = await appelerAuth("/sign-out", {});
    if (reponse.ok) {
      window.location.replace("/connexion");
      return;
    }
    setErreur({ incident: reponse.raison === "erreur" ? reponse.incident : undefined });
    setEnvoi(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {erreur ? <BandeauErreur incident={erreur.incident} /> : null}
      <Button type="button" variant="outline" onClick={deconnecter} disabled={envoi}>
        {envoi ? TEXTES_COMPTE.deconnexion.enCours : TEXTES_COMPTE.deconnexion.bouton}
      </Button>
    </div>
  );
}
