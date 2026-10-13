import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { TEXTES_EMAILS } from "@/textes/emails";

import { configurationEmail, env } from "../env";
import { creerTransportFichier } from "../modules/email/fichier";
import { creerTransportMemoire } from "../modules/email/memoire";
import { creerTransportSmtp, optionsTransportSmtp } from "../modules/email/smtp";
import { EchecTransport, type Transport } from "../modules/email/transport";

import { schemaAdresse } from "./adresse";
import {
  LONGUEUR_MAX_CORPS,
  MODELES_EMAIL,
  type DefinitionModele,
  type ModeleEmail,
} from "./modeles";

// La porte d'envoi : seule fonction qui remet un message à un transport
// (règle ESLint T). Elle valide la demande, construit le message à partir du
// modèle (l'appelant ne fournit ni expéditeur, ni sujet, ni corps, ni copie,
// ni en-tête), applique la liste autorisée hors production, et traduit tout
// échec du transport en une raison fermée. Elle ne compte rien : les limites
// sont vérifiées par l'appelant autorisé (la chaîne, après la validation de
// la transaction). Fiche : docs/features/envoi-emails.md, sections 1, 2 et 6.

export type DemandeEmail = {
  modele: ModeleEmail;
  destinataire: string;
  parametres: Record<string, unknown>;
};

export type ResultatEnvoi =
  | { envoye: true }
  | { envoye: false; raison: "limite" | "indisponible" | "refuse_par_serveur" | "non_autorise" };

// Demande refusée par la porte : message fixe, sans valeur reçue ni cause
// (S-54), comme EntreeJournalInvalide.
export class DemandeEmailInvalide extends Error {
  constructor() {
    super("Demande d'email invalide.");
    this.name = "DemandeEmailInvalide";
  }
}

// Trois clés exactement : toute autre (cc, bcc, replyTo, from, headers,
// attachments, sujet) est refusée.
const schemaDemande = z.strictObject({
  modele: z.string(),
  destinataire: schemaAdresse,
  parametres: z.record(z.string(), z.unknown()),
});

function definition(modele: string): DefinitionModele | null {
  return Object.hasOwn(MODELES_EMAIL, modele)
    ? (MODELES_EMAIL[modele as ModeleEmail] as DefinitionModele)
    : null;
}

// Valide une demande et la renvoie normalisée, ou lève DemandeEmailInvalide.
// Pure : la chaîne l'appelle dans la transaction (ctx.preparerEmail).
export function validerDemande(demande: unknown): DemandeEmail {
  const lue = schemaDemande.safeParse(demande);
  if (!lue.success) throw new DemandeEmailInvalide();
  const modele = definition(lue.data.modele);
  if (modele === null) throw new DemandeEmailInvalide();
  const parametres = modele.parametres.safeParse(lue.data.parametres);
  if (!parametres.success) throw new DemandeEmailInvalide();
  return {
    modele: lue.data.modele as ModeleEmail,
    destinataire: lue.data.destinataire,
    parametres: parametres.data as Record<string, unknown>,
  };
}

// Code et statut du client SMTP, gardés seulement s'ils ont la forme
// attendue : aucun texte de l'erreur ne passe au journal.
const CODE = /^[A-Z][A-Z0-9_]{0,31}$/u;

function consignerEchec(entree: {
  modele: ModeleEmail;
  raison: string;
  code: string | undefined;
  responseCode: number | undefined;
}): void {
  const code = entree.code !== undefined && CODE.test(entree.code) ? entree.code : undefined;
  const responseCode =
    entree.responseCode !== undefined &&
    Number.isInteger(entree.responseCode) &&
    entree.responseCode >= 100 &&
    entree.responseCode <= 599
      ? entree.responseCode
      : undefined;
  // Journal technique, provisoire jusqu'à la 8.1. Jamais l'adresse, le sujet,
  // le corps, ni le message de l'erreur.
  console.error(
    "[email]",
    JSON.stringify({
      modele: entree.modele,
      raison: entree.raison,
      code,
      responseCode,
      incident: randomUUID(),
    }),
  );
}

export type ConfigurationPorte = {
  transport: Transport;
  expediteur: string;
  estProduction: boolean;
  destinatairesAutorises: readonly string[];
  origine: string;
};

export function creerPorteEmail(configuration: ConfigurationPorte): {
  envoyerEmail: (demande: DemandeEmail) => Promise<ResultatEnvoi>;
} {
  const { transport, expediteur, estProduction, origine } = configuration;
  // Liste comparée après normalisation ; une entrée invalide n'autorise rien.
  const autorises = new Set(
    configuration.destinatairesAutorises.flatMap((adresse) => {
      const lue = schemaAdresse.safeParse(adresse);
      return lue.success ? [lue.data] : [];
    }),
  );

  async function envoyerEmail(demande: DemandeEmail): Promise<ResultatEnvoi> {
    const valide = validerDemande(demande);

    // Invariant central (section 2.1) : hors production, aucun envoi hors de
    // la liste autorisée.
    if (!estProduction && !autorises.has(valide.destinataire)) {
      return { envoye: false, raison: "non_autorise" };
    }

    const modele = definition(valide.modele) as DefinitionModele;
    const { sujet, corps } = modele.construire(valide.parametres, { origine });
    if (corps.length > LONGUEUR_MAX_CORPS) throw new DemandeEmailInvalide();

    try {
      await transport.remettre({
        de: expediteur,
        nomExpediteur: TEXTES_EMAILS.expediteur,
        a: valide.destinataire,
        sujet,
        corps,
      });
      return { envoye: true };
    } catch (erreur) {
      const echec = erreur instanceof EchecTransport ? erreur : null;
      const raison = echec?.raison ?? "indisponible";
      consignerEchec({
        modele: valide.modele,
        raison,
        code: echec?.code,
        responseCode: echec?.responseCode,
      });
      return { envoye: false, raison };
    }
  }

  return { envoyerEmail };
}

// Expéditeur des transports memoire et fichier, qui n'envoient rien. Le
// transport smtp prend GMAIL_UTILISATEUR : Gmail remplace de toute façon
// l'expéditeur par le compte authentifié.
const EXPEDITEUR_LOCAL = "ne-pas-repondre@facturation.invalid";

function transportConfigure(): { transport: Transport; expediteur: string } {
  const { transport, dossier, gmail } = configurationEmail;
  if (transport === "smtp" && gmail !== null) {
    return {
      transport: creerTransportSmtp(optionsTransportSmtp(gmail)),
      expediteur: gmail.utilisateur,
    };
  }
  if (transport === "fichier" && dossier !== null) {
    return { transport: creerTransportFichier(dossier), expediteur: EXPEDITEUR_LOCAL };
  }
  return { transport: creerTransportMemoire(), expediteur: EXPEDITEUR_LOCAL };
}

// Construite au premier envoi, jamais au chargement : un module qui importe
// la porte (la chaîne) ne lit pas la configuration d'envoi pour autant.
let porte: ReturnType<typeof creerPorteEmail> | undefined;

// Porte liée à la configuration : ne s'importe que dans
// src/server/actions/action.ts et les tests (règle T).
export function envoyerEmail(demande: DemandeEmail): Promise<ResultatEnvoi> {
  porte ??= creerPorteEmail({
    ...transportConfigure(),
    estProduction: configurationEmail.estProduction,
    destinatairesAutorises: configurationEmail.destinatairesAutorises,
    origine: env.BETTER_AUTH_URL,
  });
  return porte.envoyerEmail(demande);
}
