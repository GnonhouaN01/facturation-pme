import "server-only";

import { createTransport } from "nodemailer";

import { EchecTransport, type MessageEmail, type Transport } from "./transport";

// Transport SMTP vers Gmail, PR 2 : seul fichier qui importe nodemailer
// (règle ESLint T). Il ne journalise rien : ni conversation, ni erreur. Une
// erreur du client est réduite à son code et à son statut, sans le message
// ni la réponse du serveur, qui citent souvent l'adresse (section 6.3).
// Fiche : docs/features/envoi-emails.md, sections 3.2, 6.3, 7 et 10.

const HOTE = "smtp.gmail.com";

export type OptionsTransportSmtp = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  auth: Readonly<{ user: string; pass: string }>;
  tls: Readonly<{ minVersion: "TLSv1.2"; rejectUnauthorized: true; servername: string }>;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  pool: false;
  logger: false;
  debug: false;
  disableFileAccess: true;
  disableUrlAccess: true;
  maxRecipients: 1;
  // Tests seulement (serveur factice sans TLS) : jamais dans les options de
  // production.
  ignoreTLS?: boolean;
}>;

// Options de production, figées : TLS dès la connexion (465), certificat
// vérifié pour smtp.gmail.com, délais courts (une fonction Vercel ne doit
// pas attendre deux minutes), aucune connexion gardée, aucun journal, aucun
// accès aux fichiers ni aux adresses depuis un message, un seul destinataire.
export function optionsTransportSmtp(compte: {
  utilisateur: string;
  motDePasse: string;
}): OptionsTransportSmtp {
  return Object.freeze({
    host: HOTE,
    port: 465,
    secure: true,
    auth: Object.freeze({ user: compte.utilisateur, pass: compte.motDePasse }),
    tls: Object.freeze({
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: HOTE,
    } as const),
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    pool: false,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    // Un seul destinataire par message, refusé par Nodemailer au-delà.
    maxRecipients: 1,
  } as const);
}

// Code et statut du client SMTP, gardés seulement s'ils ont la forme
// attendue (même règle que le journal de la porte).
const CODE = /^[A-Z][A-Z0-9_]{0,31}$/u;
// Codes dont le statut 5xx dit que le serveur refuse ce message ou ce
// destinataire, définitivement. Tout le reste, 4xx compris (refus
// temporaire), est « indisponible ».
const CODES_REFUS = new Set(["EENVELOPE", "EMESSAGE"]);

// Lit code et responseCode, et rien d'autre : ni message, ni response, ni
// cause (section 6.3).
export function traduireErreurSmtp(erreur: unknown): EchecTransport {
  if (typeof erreur !== "object" || erreur === null) {
    return new EchecTransport({ raison: "indisponible" });
  }
  const { code: codeBrut, responseCode: statutBrut } = erreur as {
    code?: unknown;
    responseCode?: unknown;
  };
  const code = typeof codeBrut === "string" && CODE.test(codeBrut) ? codeBrut : undefined;
  const responseCode =
    typeof statutBrut === "number" &&
    Number.isInteger(statutBrut) &&
    statutBrut >= 100 &&
    statutBrut <= 599
      ? statutBrut
      : undefined;
  const raison =
    code !== undefined && CODES_REFUS.has(code) && responseCode !== undefined && responseCode >= 500
      ? "refuse_par_serveur"
      : "indisponible";
  return new EchecTransport({ raison, code, responseCode });
}

// Dernière barrière, si la validation de la porte était contournée : une
// adresse d'enveloppe est une seule adresse nue, sans espace, contrôle,
// virgule, chevron ni parenthèse.
const ADRESSE_NUE = /^[^\s\x00-\x1f\x7f,;<>()"]+@[^\s\x00-\x1f\x7f,;<>()"@]+$/u;
// Un sujet ou un nom d'affichage ne garde aucun caractère de contrôle : un
// retour à la ligne y deviendrait un en-tête.
const CONTROLE = /[\x00-\x1f\x7f]/gu;

function ligneUnique(texte: string): string {
  return texte.replace(CONTROLE, " ");
}

export function creerTransportSmtp(options: OptionsTransportSmtp): Transport {
  // Copie : nodemailer reçoit des objets à lui, jamais les objets figés.
  const client = createTransport({
    ...options,
    auth: { ...options.auth },
    tls: { ...options.tls },
  });

  return {
    remettre: async (message: MessageEmail) => {
      if (!ADRESSE_NUE.test(message.de) || !ADRESSE_NUE.test(message.a)) {
        throw new EchecTransport({ raison: "refuse_par_serveur", code: "EENVELOPE" });
      }
      try {
        await client.sendMail({
          from: { name: ligneUnique(message.nomExpediteur), address: message.de },
          to: { name: "", address: message.a },
          // Enveloppe explicite : un seul RCPT TO, jamais déduit des en-têtes.
          envelope: { from: message.de, to: [message.a] },
          subject: ligneUnique(message.sujet),
          text: message.corps,
        });
      } catch (erreur) {
        throw traduireErreurSmtp(erreur);
      } finally {
        client.close();
      }
    },
  };
}
