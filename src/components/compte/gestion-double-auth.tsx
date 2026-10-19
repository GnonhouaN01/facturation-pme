"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { CODE_TOTP, normaliserCodeSecours } from "@/schemas/regles-compte";
import { TEXTES_COMPTE } from "@/textes/compte";
import { TEXTES_RESULTATS } from "@/textes/resultats";

import { appelerAuth, type Activation, type ReponseAuth } from "./appel-auth";
import { Bandeau, BandeauErreur } from "./bandeau";
import { Champ } from "./champ";
import { CodeQr } from "./code-qr";
import { useHydrate } from "./hydrate";

// Activation et gestion de la double authentification (UC-04, 1.4) : mot de
// passe, puis code QR et clé, puis le code de l'application ; les dix codes
// de secours ne s'affichent qu'après ce code, une seule fois. Second facteur
// actif : codes restants, nouveaux codes, remplacement de l'application,
// désactivation (masquée pour un rôle exigeant, refusée aussi par le
// serveur), chacun avec mot de passe et code. Aucun appel avant un clic.
// Fiche : docs/features/double-authentification.md, sections 5, 7 et 11.

const TEXTES = TEXTES_COMPTE.doubleAuth;

export type EtatInitial = { actif: boolean; codesRestants: number; roleExigeant: boolean };

type Operation = "nouveauxCodes" | "remplacer" | "desactiver";

type Vue =
  | { vue: "inactive"; message?: string }
  | { vue: "qr"; activation: Activation; remplacement: boolean }
  | { vue: "codes"; codes: string[]; remplacement: boolean }
  | { vue: "active"; codesRestants: number; message?: string }
  | { vue: "operation"; operation: Operation; codesRestants: number };

type Erreur = { texte?: string; incident?: string | undefined; inattendue?: boolean };

function erreurDe(reponse: Exclude<ReponseAuth, { ok: true }>): Erreur {
  switch (reponse.raison) {
    case "mot_de_passe_incorrect":
      return { texte: TEXTES.motDePasseIncorrect };
    case "code_incorrect":
      return { texte: TEXTES.codeIncorrect };
    case "double_authentification_obligatoire":
      return { texte: TEXTES.obligatoireRefus };
    case "trop_de_requetes":
    case "invalide":
    case "refuse":
    case "connexion_requise":
      return { texte: TEXTES_RESULTATS[reponse.raison] };
    case "erreur":
      return { inattendue: true, incident: reponse.incident };
    default:
      return { inattendue: true };
  }
}

function MessageErreur({ erreur }: { erreur: Erreur | null }) {
  if (erreur === null) return null;
  if (erreur.inattendue) return <BandeauErreur incident={erreur.incident} />;
  return erreur.texte ? <Bandeau etat="danger">{erreur.texte}</Bandeau> : null;
}

const TITRE_2 = "font-heading text-[1.25rem] leading-7 font-semibold text-foreground";
const AIDE = "text-[0.9375rem] leading-6 text-muted-foreground";

export function GestionDoubleAuth({ initial }: { initial: EtatInitial }) {
  const hydrate = useHydrate();
  const [vue, setVue] = useState<Vue>(
    initial.actif ? { vue: "active", codesRestants: initial.codesRestants } : { vue: "inactive" },
  );
  const [erreur, setErreur] = useState<Erreur | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [conserve, setConserve] = useState(false);
  const [copies, setCopies] = useState(false);

  async function appeler(
    point: Parameters<typeof appelerAuth>[0],
    corps: unknown,
  ): Promise<Extract<ReponseAuth, { ok: true }> | null> {
    if (envoi) return null;
    setEnvoi(true);
    setErreur(null);
    const reponse = await appelerAuth(point, corps);
    setEnvoi(false);
    if (!reponse.ok) {
      setErreur(erreurDe(reponse));
      return null;
    }
    return reponse;
  }

  function lire(evenement: FormEvent<HTMLFormElement>, nom: string): string {
    return String(new FormData(evenement.currentTarget).get(nom) ?? "");
  }

  async function activer(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const motDePasse = lire(evenement, "motDePasse");
    if (motDePasse === "") {
      setErreur({ texte: TEXTES_COMPTE.erreurs.motDePasse });
      return;
    }
    const reponse = await appeler("/two-factor/enable", { motDePasse });
    if (reponse?.activation)
      setVue({ vue: "qr", activation: reponse.activation, remplacement: false });
  }

  async function confirmer(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (vue.vue !== "qr") return;
    const code = lire(evenement, "code").trim();
    if (!CODE_TOTP.test(code)) {
      setErreur({ texte: code === "" ? TEXTES.codeVide : TEXTES.codeIncorrect });
      return;
    }
    const reponse = await appeler("/two-factor/confirm-enable", { code });
    if (reponse) {
      setConserve(false);
      setCopies(false);
      setVue({ vue: "codes", codes: vue.activation.codes, remplacement: vue.remplacement });
    }
  }

  async function executer(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (vue.vue !== "operation") return;
    const motDePasse = lire(evenement, "motDePasse");
    const saisie = lire(evenement, "code").trim();
    const code = CODE_TOTP.test(saisie) ? saisie : normaliserCodeSecours(saisie);
    if (motDePasse === "" || code === null) {
      setErreur({ texte: motDePasse === "" ? TEXTES_COMPTE.erreurs.motDePasse : TEXTES.codeVide });
      return;
    }
    const corps = { motDePasse, code };
    if (vue.operation === "nouveauxCodes") {
      const reponse = await appeler("/two-factor/generate-backup-codes", corps);
      if (reponse?.codes) {
        setConserve(false);
        setCopies(false);
        setVue({ vue: "codes", codes: reponse.codes, remplacement: false });
      }
    } else if (vue.operation === "remplacer") {
      const reponse = await appeler("/two-factor/replace", corps);
      if (reponse?.activation)
        setVue({ vue: "qr", activation: reponse.activation, remplacement: true });
    } else {
      const reponse = await appeler("/two-factor/disable", corps);
      if (reponse) setVue({ vue: "inactive", message: TEXTES.desactivee });
    }
  }

  async function copier(codes: readonly string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopies(true);
    } catch {
      setCopies(false);
    }
  }

  if (!hydrate) {
    return (
      <noscript>
        <Bandeau etat="danger">{TEXTES.sansJavaScript}</Bandeau>
      </noscript>
    );
  }

  if (vue.vue === "inactive") {
    return (
      <form noValidate onSubmit={activer} className="flex flex-col gap-5">
        {vue.message ? <Bandeau etat="succes">{vue.message}</Bandeau> : null}
        <MessageErreur erreur={erreur} />
        <Champ
          id="double-auth-mot-de-passe"
          nom="motDePasse"
          libelle={TEXTES.motDePasse}
          type="password"
          autoComplete="current-password"
        />
        <Button type="submit" disabled={envoi} className="w-full sm:w-auto sm:self-start">
          {envoi ? TEXTES.envoiEnCours : TEXTES.continuer}
        </Button>
      </form>
    );
  }

  if (vue.vue === "qr") {
    return (
      <form noValidate onSubmit={confirmer} className="flex flex-col gap-5">
        <p className={AIDE}>{TEXTES.etapeQr}</p>
        <CodeQr lignes={vue.activation.qr} libelle={TEXTES.qr} />
        <div className="flex flex-col gap-1.5">
          <p className={AIDE}>{TEXTES.cle}</p>
          <p
            data-testid="cle-totp"
            className="font-mono text-[0.9375rem] leading-6 break-all text-foreground select-all"
          >
            {vue.activation.cle}
          </p>
        </div>
        <MessageErreur erreur={erreur} />
        <Champ
          id="double-auth-code"
          nom="code"
          libelle={TEXTES.code}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <Button type="submit" disabled={envoi} className="w-full sm:w-auto sm:self-start">
          {envoi
            ? TEXTES.envoiEnCours
            : vue.remplacement
              ? TEXTES.confirmerRemplacement
              : TEXTES.confirmer}
        </Button>
      </form>
    );
  }

  if (vue.vue === "codes") {
    const { codes } = vue;
    return (
      <section className="flex flex-col gap-5">
        <h2 className={TITRE_2}>{TEXTES.codesTitre}</h2>
        <p className={AIDE}>{TEXTES.codesAide}</p>
        <ul className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
          {codes.map((code) => (
            <li
              key={code}
              data-testid="code-secours"
              className="font-mono text-[0.9375rem] leading-6 text-foreground"
            >
              {code}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" onClick={() => copier(codes)}>
            {TEXTES.copier}
          </Button>
          {copies ? (
            <p role="status" className="text-[0.875rem] leading-5 text-muted-foreground">
              {TEXTES.copies}
            </p>
          ) : null}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-[0.9375rem] leading-6 text-foreground">
          <input
            type="checkbox"
            checked={conserve}
            onChange={(e) => setConserve(e.currentTarget.checked)}
            className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
          />
          {TEXTES.conserve}
        </label>
        <Button
          type="button"
          disabled={!conserve}
          className="w-full sm:w-auto sm:self-start"
          onClick={() =>
            setVue({ vue: "active", codesRestants: codes.length, message: TEXTES.activee })
          }
        >
          {TEXTES.terminer}
        </Button>
      </section>
    );
  }

  if (vue.vue === "operation") {
    const titres: Record<Operation, string> = {
      nouveauxCodes: TEXTES.nouveauxCodesTitre,
      remplacer: TEXTES.remplacerTitre,
      desactiver: TEXTES.desactiverTitre,
    };
    const boutons: Record<Operation, string> = {
      nouveauxCodes: TEXTES.nouveauxCodes,
      remplacer: TEXTES.remplacer,
      desactiver: TEXTES.desactiver,
    };
    return (
      <form noValidate onSubmit={executer} className="flex flex-col gap-5">
        <h2 className={TITRE_2}>{titres[vue.operation]}</h2>
        {vue.operation === "desactiver" ? (
          <p className={AIDE}>{TEXTES.desactiverAvertissement}</p>
        ) : null}
        {vue.operation === "remplacer" ? <p className={AIDE}>{TEXTES.remplacerAide}</p> : null}
        <MessageErreur erreur={erreur} />
        <Champ
          id="double-auth-gestion-mot-de-passe"
          nom="motDePasse"
          libelle={TEXTES.motDePasse}
          type="password"
          autoComplete="current-password"
        />
        <Champ
          id="double-auth-gestion-code"
          nom="code"
          libelle={TEXTES.gestionCode}
          type="text"
          autoComplete="one-time-code"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={envoi} className="w-full sm:w-auto">
            {envoi ? TEXTES.envoiEnCours : boutons[vue.operation]}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => {
              setErreur(null);
              setVue({ vue: "active", codesRestants: vue.codesRestants });
            }}
          >
            {TEXTES.annuler}
          </Button>
        </div>
      </form>
    );
  }

  const { codesRestants } = vue;
  const ouvrir = (operation: Operation) => {
    setErreur(null);
    setVue({ vue: "operation", operation, codesRestants });
  };
  return (
    <section className="flex flex-col gap-5">
      {vue.message ? <Bandeau etat="succes">{vue.message}</Bandeau> : null}
      <p className="text-[0.9375rem] leading-6 text-foreground">
        {TEXTES.codesRestants} <span className="font-mono">{codesRestants}</span>
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="outline" onClick={() => ouvrir("nouveauxCodes")}>
          {TEXTES.nouveauxCodes}
        </Button>
        <Button type="button" variant="outline" onClick={() => ouvrir("remplacer")}>
          {TEXTES.remplacer}
        </Button>
        {initial.roleExigeant ? null : (
          <Button type="button" variant="outline" onClick={() => ouvrir("desactiver")}>
            {TEXTES.desactiver}
          </Button>
        )}
      </div>
    </section>
  );
}
