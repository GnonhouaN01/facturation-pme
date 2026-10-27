"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { raisonSocialeValide } from "@/schemas/regles-organisation";
import type { Resultat } from "@/server/actions/refus";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_NAVIGATION } from "@/textes/navigation";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { useHydrate } from "./hydrate";

// Les organisations de /compte (2.1) : la liste de celles de l'utilisateur,
// chacune avec « Ouvrir l'organisation », et la création, seul bouton
// principal de l'écran. Les actions sont reçues de la page (actions
// serveur), jamais importées de src/app/. Le serveur refait chaque contrôle ;
// ici, seule la raison sociale est vérifiée avant l'envoi. Un succès mène,
// par une navigation complète, au tableau de bord, ou à l'activation du
// second facteur quand le rôle l'impose. Fiche :
// docs/features/organisations.md, section 9.

const TEXTES = TEXTES_COMPTE.organisations;
const TITRE_2 = "font-heading text-[1.25rem] leading-7 font-semibold text-foreground";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type Role = keyof typeof TEXTES_NAVIGATION.roles;

export type OrganisationListee = {
  id: string;
  nom: string;
  role: Role;
  doubleAuthentificationRequise: boolean;
};

type Suite = { doubleAuthentificationRequise: boolean };

export type ActionCreer = (entree: {
  raisonSociale: string;
}) => Promise<Resultat<Suite & { organisationId: string }>>;
export type ActionChanger = (entree: { organisationId: string }) => Promise<Resultat<Suite>>;

type Echec = { general?: string; incident?: string | undefined; inattendue?: boolean };

function echecDe(resultat: Exclude<Resultat<unknown>, { ok: true }>): Echec {
  if (resultat.raison === "erreur") {
    return {
      inattendue: true,
      incident: UUID.test(resultat.incident) ? resultat.incident : undefined,
    };
  }
  return { general: TEXTES_RESULTATS[resultat.raison] };
}

// Le nom accessible du bouton porte le texte visible, puis la raison
// sociale : plusieurs boutons « Ouvrir l'organisation » restent distincts.
function nomAccessible(organisation: OrganisationListee): string {
  return [TEXTES.ouvrir, organisation.nom].join(" ");
}

function poursuivre(suite: Suite) {
  window.location.assign(
    suite.doubleAuthentificationRequise ? "/compte/double-authentification" : "/tableau-de-bord",
  );
}

// Un appel d'action qui lève (réseau coupé, réponse illisible) : erreur
// inattendue, sans incident.
async function appeler<T>(appel: () => Promise<Resultat<T>>): Promise<Resultat<T> | null> {
  try {
    return await appel();
  } catch {
    return null;
  }
}

function Echec({ echec }: { echec: Echec | null }) {
  if (echec === null) return null;
  if (echec.inattendue) return <BandeauErreur incident={echec.incident} />;
  return echec.general ? <Bandeau etat="danger">{echec.general}</Bandeau> : null;
}

export function ListeOrganisations({
  organisations,
  changer,
}: {
  organisations: readonly OrganisationListee[];
  changer: ActionChanger;
}) {
  const hydrate = useHydrate();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [echec, setEchec] = useState<Echec | null>(null);

  async function ouvrir(organisation: OrganisationListee) {
    if (envoi !== null) return;
    setEnvoi(organisation.id);
    setEchec(null);
    const resultat = await appeler(() => changer({ organisationId: organisation.id }));
    if (resultat?.ok) {
      poursuivre(resultat.donnees);
      return;
    }
    setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
    setEnvoi(null);
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <h2 className={TITRE_2}>{TEXTES.titre}</h2>
      <Echec echec={echec} />
      {organisations.length === 0 ? (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{TEXTES.aucune}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {organisations.map((organisation) => (
            <li
              key={organisation.id}
              className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">
                  {organisation.nom}
                </p>
                <p className="flex flex-wrap gap-x-1 text-[0.875rem] leading-5 text-muted-foreground">
                  <span>{TEXTES.role}</span>
                  <span>{TEXTES_NAVIGATION.roles[organisation.role]}</span>
                </p>
                {organisation.doubleAuthentificationRequise ? (
                  <p className="text-[0.875rem] leading-5 text-muted-foreground">
                    {TEXTES.doubleAuthRequise}
                  </p>
                ) : null}
              </div>
              {hydrate ? (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={nomAccessible(organisation)}
                  disabled={envoi !== null}
                  onClick={() => void ouvrir(organisation)}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {envoi === organisation.id ? TEXTES.ouvertureEnCours : TEXTES.ouvrir}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {hydrate ? null : (
        <noscript>
          <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
        </noscript>
      )}
    </section>
  );
}

export function FormulaireCreationOrganisation({ creer }: { creer: ActionCreer }) {
  const hydrate = useHydrate();
  const [envoi, setEnvoi] = useState(false);
  const [erreurChamp, setErreurChamp] = useState<string | null>(null);
  const [echec, setEchec] = useState<Echec | null>(null);

  async function soumettre(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (envoi) return;
    const raisonSociale = String(new FormData(evenement.currentTarget).get("raisonSociale") ?? "");
    setEchec(null);
    if (!raisonSocialeValide(raisonSociale)) {
      setErreurChamp(TEXTES.erreurRaisonSociale);
      return;
    }
    setErreurChamp(null);
    setEnvoi(true);
    const resultat = await appeler(() => creer({ raisonSociale }));
    if (resultat?.ok) {
      poursuivre(resultat.donnees);
      return;
    }
    if (resultat !== null && resultat.raison === "invalide") {
      setErreurChamp(TEXTES.erreurRaisonSociale);
    } else {
      setEchec(resultat === null ? { inattendue: true } : echecDe(resultat));
    }
    setEnvoi(false);
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <h2 className={TITRE_2}>{TEXTES.creerTitre}</h2>
      {hydrate ? (
        <form noValidate onSubmit={soumettre} className="flex flex-col gap-5">
          <Echec echec={echec} />
          <Champ
            id="organisation-raison-sociale"
            nom="raisonSociale"
            libelle={TEXTES.raisonSociale}
            type="text"
            autoComplete="organization"
            aide={TEXTES.aide}
            erreur={erreurChamp}
          />
          <Button type="submit" disabled={envoi} className="w-full sm:w-auto sm:self-start">
            {envoi ? TEXTES.creationEnCours : TEXTES.creer}
          </Button>
        </form>
      ) : (
        <noscript>
          <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
        </noscript>
      )}
    </section>
  );
}
