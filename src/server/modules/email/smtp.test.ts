import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";

import { creerPorteEmail } from "../../email/envoi";

import { demarrerServeurSmtp, type OptionsServeurSmtp } from "./outils-test/serveur-smtp";
import { creerTransportSmtp, optionsTransportSmtp, traduireErreurSmtp } from "./smtp";
import { EchecTransport, type MessageEmail } from "./transport";

// Transport smtp, PR 2. Contre un serveur factice en node:net sur 127.0.0.1,
// sans TLS pour le test seulement : les options de production (TLS sur 465,
// certificat vérifié, délais, logger et debug à false) sont figées à part.
// Valeurs factices, domaines en .invalid. Fiche :
// docs/features/envoi-emails.md, sections 3.2, 6.3, 7 et 10.

// Chargement de envoi.ts (porte, pour les tests du journal technique).
vi.mock("../../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.invalid",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
  },
}));

const UTILISATEUR = "expediteur.factice@exemple.invalid";
const MOT_DE_PASSE = "motdepassefactic";
const DESTINATAIRE = "destinataire.piege@exemple.invalid";
const INJECTEE = "copie.cachee@exemple.invalid";
const ORIGINE = "https://facturation.exemple.invalid";

// Formes encodées du secret qu'un journal de conversation SMTP révélerait :
// AUTH PLAIN (\0utilisateur\0motdepasse) et AUTH LOGIN (chaque partie).
const base64 = (texte: string) => Buffer.from(texte, "utf8").toString("base64");
const SECRETS = [
  MOT_DE_PASSE,
  base64(`\0${UTILISATEUR}\0${MOT_DE_PASSE}`),
  base64(MOT_DE_PASSE),
  base64(UTILISATEUR),
];

function message(champs: Partial<MessageEmail> = {}): MessageEmail {
  return {
    de: UTILISATEUR,
    nomExpediteur: "Facturation PME",
    a: DESTINATAIRE,
    sujet: "Vérification de l'envoi",
    corps: "Ceci est un essai.\nNe répondez pas à cet email.",
    ...champs,
  };
}

async function serveur(options: OptionsServeurSmtp = {}) {
  const lance = await demarrerServeurSmtp(options);
  onTestFinished(() => lance.fermer());
  return lance;
}

// Options de production, redirigées vers le serveur factice, sans TLS.
function transportVers(port: number) {
  return creerTransportSmtp({
    ...optionsTransportSmtp({ utilisateur: UTILISATEUR, motDePasse: MOT_DE_PASSE }),
    host: "127.0.0.1",
    port,
    secure: false,
    ignoreTLS: true,
  });
}

async function echecDe(promesse: Promise<unknown>): Promise<EchecTransport> {
  try {
    await promesse;
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(EchecTransport);
    return erreur as EchecTransport;
  }
  throw new Error("La remise aurait dû échouer.");
}

// Tout ce qui sort vers stdout et stderr, console comprise.
let sorties: string[];

beforeEach(() => {
  sorties = [];
  const garder = (...morceaux: unknown[]) => {
    sorties.push(morceaux.map((m) => (typeof m === "string" ? m : inspect(m))).join(" "));
  };
  for (const methode of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    vi.spyOn(console, methode).mockImplementation(garder);
  }
  vi.spyOn(process.stdout, "write").mockImplementation((morceau: unknown) => {
    garder(Buffer.isBuffer(morceau) ? morceau.toString("utf8") : morceau);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((morceau: unknown) => {
    garder(Buffer.isBuffer(morceau) ? morceau.toString("utf8") : morceau);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sortiesSansSecretNiAdresse(): void {
  const tout = sorties.join("\n");
  for (const secret of SECRETS) expect(tout).not.toContain(secret);
  expect(tout).not.toContain(DESTINATAIRE);
  expect(tout).not.toContain(UTILISATEUR);
}

describe("options de production, figées", () => {
  test("TLS dès la connexion sur 465, certificat vérifié, délais courts, aucun journal", () => {
    expect(
      optionsTransportSmtp({ utilisateur: UTILISATEUR, motDePasse: MOT_DE_PASSE }),
    ).toStrictEqual({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: UTILISATEUR, pass: MOT_DE_PASSE },
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: "smtp.gmail.com" },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
      pool: false,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRecipients: 1,
    });
  });

  test("objet figé en profondeur", () => {
    const options = optionsTransportSmtp({ utilisateur: UTILISATEUR, motDePasse: MOT_DE_PASSE });
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.auth)).toBe(true);
    expect(Object.isFrozen(options.tls)).toBe(true);
  });
});

describe("conversation avec le serveur factice", () => {
  test("EHLO, AUTH, MAIL FROM, un seul RCPT TO, DATA : un message en texte brut", async () => {
    const factice = await serveur();

    await transportVers(factice.port).remettre(message());

    const commandes = factice.commandes();
    const verbes = commandes.map((ligne) => ligne.split(/[ :]/u, 1)[0]?.toUpperCase());
    expect(verbes.slice(0, 5)).toStrictEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
    expect(commandes.filter((ligne) => /^RCPT /iu.test(ligne))).toStrictEqual([
      `RCPT TO:<${DESTINATAIRE}>`,
    ]);
    expect(commandes.find((ligne) => /^MAIL /iu.test(ligne))).toMatch(
      new RegExp(`^MAIL FROM:<${UTILISATEUR.replaceAll(".", "\\.")}>`, "u"),
    );
    expect(factice.messages()).toHaveLength(1);
    const recu = factice.messages()[0] ?? "";
    expect(recu).toMatch(/^Content-Type: text\/plain/imu);
    expect(recu).not.toMatch(/text\/html/iu);
  });

  test("le mot de passe atteint le serveur (AUTH) : le test des sorties a un objet", async () => {
    const factice = await serveur();

    await transportVers(factice.port).remettre(message());

    const recu = factice.recu();
    expect(
      recu.includes(base64(`\0${UTILISATEUR}\0${MOT_DE_PASSE}`)) ||
        recu.includes(base64(MOT_DE_PASSE)),
    ).toBe(true);
  });
});

describe("injection d'en-têtes, validation de la porte contournée", () => {
  function entetes(brut: string): string {
    const fin = brut.indexOf("\r\n\r\n");
    return fin === -1 ? brut : brut.slice(0, fin);
  }

  test("sujet avec \\r\\nBcc: : aucun en-tête Bcc, un seul RCPT TO", async () => {
    const factice = await serveur();

    await transportVers(factice.port).remettre(
      message({ sujet: `Essai\r\nBcc: ${INJECTEE}\r\nX-Injecte: oui` }),
    );

    const recu = factice.messages()[0] ?? "";
    expect(entetes(recu)).not.toMatch(/^Bcc:/imu);
    expect(entetes(recu)).not.toMatch(/^X-Injecte:/imu);
    expect(factice.commandes().filter((ligne) => /^RCPT /iu.test(ligne))).toHaveLength(1);
    expect(factice.recu()).not.toContain(`RCPT TO:<${INJECTEE}>`);
  });

  test("nom de l'expéditeur avec \\r\\nBcc: : aucun en-tête Bcc", async () => {
    const factice = await serveur();

    await transportVers(factice.port).remettre(
      message({ nomExpediteur: `Facturation\r\nBcc: ${INJECTEE}` }),
    );

    expect(entetes(factice.messages()[0] ?? "")).not.toMatch(/^Bcc:/imu);
    expect(factice.recu()).not.toContain(`RCPT TO:<${INJECTEE}>`);
  });

  test("destinataire avec \\r\\nRCPT TO: : jamais de second destinataire", async () => {
    const factice = await serveur();

    try {
      await transportVers(factice.port).remettre(
        message({ a: `${DESTINATAIRE}\r\nRCPT TO:<${INJECTEE}>` }),
      );
    } catch (erreur) {
      // Refuser est une issue admise ; jamais une exception brute.
      expect(erreur).toBeInstanceOf(EchecTransport);
    }

    expect(factice.recu()).not.toContain(`RCPT TO:<${INJECTEE}>`);
    expect(factice.commandes().filter((ligne) => /^RCPT /iu.test(ligne)).length).toBeLessThan(2);
  });

  test("corps avec \\r\\n.\\r\\n : un seul message, aucune commande glissée", async () => {
    const factice = await serveur();

    await transportVers(factice.port).remettre(
      message({ corps: `Début\r\n.\r\nMAIL FROM:<${INJECTEE}>\r\nRCPT TO:<${INJECTEE}>\r\nFin` }),
    );

    expect(factice.messages()).toHaveLength(1);
    expect(factice.commandes().filter((ligne) => /^RCPT /iu.test(ligne))).toStrictEqual([
      `RCPT TO:<${DESTINATAIRE}>`,
    ]);
  });
});

describe("échecs du serveur, traduits", () => {
  test("535 à l'authentification : indisponible, EAUTH, 535", async () => {
    const factice = await serveur({
      reponseAuth: "535 5.7.8 Username and Password not accepted",
    });

    const echec = await echecDe(transportVers(factice.port).remettre(message()));

    expect(echec.raison).toBe("indisponible");
    expect(echec.code).toBe("EAUTH");
    expect(echec.responseCode).toBe(535);
  });

  test(
    "serveur muet : indisponible, en moins de huit secondes (accueil attendu 5 s)",
    { timeout: 15_000 },
    async () => {
      const factice = await serveur({ muet: true });
      const debut = performance.now();

      const echec = await echecDe(transportVers(factice.port).remettre(message()));

      expect(echec.raison).toBe("indisponible");
      expect(performance.now() - debut).toBeLessThan(8_000);
    },
  );

  test("550 qui cite l'adresse : refuse_par_serveur, l'adresse n'est nulle part dans l'erreur", async () => {
    const factice = await serveur({
      reponseRcpt: `550 5.1.1 <${DESTINATAIRE}> The email account that you tried to reach does not exist`,
    });

    const echec = await echecDe(transportVers(factice.port).remettre(message()));

    expect(echec.raison).toBe("refuse_par_serveur");
    expect(echec.code).toBe("EENVELOPE");
    expect(echec.responseCode).toBe(550);
    expect(echec.message).not.toContain(DESTINATAIRE);
    expect(echec.cause).toBeUndefined();
    expect(inspect(echec, { depth: 10, showHidden: true })).not.toContain(DESTINATAIRE);
  });
});

describe("par la porte : journal technique", () => {
  function porteSmtp(port: number) {
    return creerPorteEmail({
      transport: transportVers(port),
      expediteur: UTILISATEUR,
      estProduction: true,
      destinatairesAutorises: [],
      origine: ORIGINE,
    });
  }

  const DEMANDE = {
    modele: "essai.verification_envoi" as const,
    destinataire: DESTINATAIRE,
    parametres: {},
  };

  test("535 : une seule ligne consignée, EAUTH et 535, rien d'autre", async () => {
    const factice = await serveur({
      reponseAuth: "535 5.7.8 Username and Password not accepted",
    });

    const resultat = await porteSmtp(factice.port).envoyerEmail(DEMANDE);

    expect(resultat).toStrictEqual({ envoye: false, raison: "indisponible" });
    expect(sorties).toHaveLength(1);
    const ligne = sorties[0] ?? "";
    expect(ligne.startsWith("[email] ")).toBe(true);
    const consigne = JSON.parse(ligne.slice("[email] ".length)) as Record<string, unknown>;
    expect(Object.keys(consigne).sort()).toStrictEqual([
      "code",
      "incident",
      "modele",
      "raison",
      "responseCode",
    ]);
    expect(consigne).toMatchObject({
      modele: "essai.verification_envoi",
      raison: "indisponible",
      code: "EAUTH",
      responseCode: 535,
    });
    expect(ligne).not.toContain("Username and Password");
    sortiesSansSecretNiAdresse();
  });

  test("550 qui cite l'adresse : refuse_par_serveur, l'adresse n'est consignée nulle part", async () => {
    const factice = await serveur({
      reponseRcpt: `550 5.1.1 <${DESTINATAIRE}> does not exist`,
    });

    const resultat = await porteSmtp(factice.port).envoyerEmail(DEMANDE);

    expect(resultat).toStrictEqual({ envoye: false, raison: "refuse_par_serveur" });
    expect(sorties.join("\n")).toContain("EENVELOPE");
    sortiesSansSecretNiAdresse();
  });

  test("envoi réussi : rien sur stdout ni stderr, ni mot de passe, ni base64, ni adresse", async () => {
    const factice = await serveur();

    const resultat = await porteSmtp(factice.port).envoyerEmail(DEMANDE);

    expect(resultat).toStrictEqual({ envoye: true });
    expect(factice.messages()).toHaveLength(1);
    expect(sorties).toStrictEqual([]);
    sortiesSansSecretNiAdresse();
  });
});

describe("traduireErreurSmtp : code et responseCode seulement", () => {
  // Erreur de Nodemailer simulée : lire message ou response est une faute
  // (la réponse d'un serveur SMTP cite souvent l'adresse, section 6.3).
  function erreurNodemailer(code: unknown, responseCode?: unknown) {
    const lus: string[] = [];
    const erreur = new Error();
    Object.defineProperty(erreur, "message", {
      get: () => {
        lus.push("message");
        return `refus pour ${DESTINATAIRE}`;
      },
    });
    Object.defineProperty(erreur, "response", {
      get: () => {
        lus.push("response");
        return `550 5.1.1 <${DESTINATAIRE}>`;
      },
    });
    Object.assign(erreur, { code, responseCode });
    return { erreur, lus };
  }

  test.each([
    ["EAUTH", 535, "indisponible"],
    ["EAUTH", undefined, "indisponible"],
    ["ETIMEDOUT", undefined, "indisponible"],
    ["ECONNECTION", undefined, "indisponible"],
    ["ESOCKET", undefined, "indisponible"],
    ["EDNS", undefined, "indisponible"],
    ["ETLS", undefined, "indisponible"],
    ["EPROTOCOL", undefined, "indisponible"],
    ["EENVELOPE", 550, "refuse_par_serveur"],
    ["EENVELOPE", 553, "refuse_par_serveur"],
    ["EENVELOPE", 450, "indisponible"],
    ["EMESSAGE", 552, "refuse_par_serveur"],
    ["EMESSAGE", 421, "indisponible"],
    ["CODE_INCONNU", undefined, "indisponible"],
  ] as const)("%s, %s : %s", (code, responseCode, raison) => {
    const { erreur, lus } = erreurNodemailer(code, responseCode);

    const echec = traduireErreurSmtp(erreur);

    expect(echec).toBeInstanceOf(EchecTransport);
    expect(echec.raison).toBe(raison);
    expect(echec.code).toBe(code);
    expect(echec.responseCode).toBe(responseCode);
    expect(lus).toStrictEqual([]);
    expect(echec.cause).toBeUndefined();
    expect(echec.message).not.toContain(DESTINATAIRE);
  });

  test.each([
    ["chaîne", `refus pour ${DESTINATAIRE}`],
    ["null", null],
    ["undefined", undefined],
    ["objet sans code", {}],
  ])("%s : indisponible, sans code", (_nom, erreur) => {
    const echec = traduireErreurSmtp(erreur);

    expect(echec).toBeInstanceOf(EchecTransport);
    expect(echec.raison).toBe("indisponible");
    expect(echec.code).toBeUndefined();
    expect(echec.responseCode).toBeUndefined();
  });

  test.each([
    ["code non textuel", { code: 42, responseCode: 550 }],
    ["responseCode non entier", { code: "EENVELOPE", responseCode: "550" }],
    ["responseCode hors plage", { code: "EENVELOPE", responseCode: 9_999 }],
  ])("%s : champ mal formé écarté, indisponible", (_nom, erreur) => {
    const echec = traduireErreurSmtp(erreur);

    expect(echec.raison).toBe("indisponible");
    expect(echec.code === undefined || typeof echec.code === "string").toBe(true);
    expect(
      echec.responseCode === undefined ||
        (Number.isInteger(echec.responseCode) &&
          echec.responseCode >= 100 &&
          echec.responseCode <= 599),
    ).toBe(true);
  });
});
