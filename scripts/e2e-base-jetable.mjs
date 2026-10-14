import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";

import pg from "pg";

// Lanceur de « npm run test:e2e ». Trois modes :
// - CI (variable CI définie) : Playwright tel quel, sur le service
//   PostgreSQL du workflow ;
// - E2E_BASE=dev : Playwright tel quel, sur la base de dev lue par
//   next start dans le fichier local des variables (sortie de secours) ;
// - sinon : un PostgreSQL 18 jetable dans Docker, préparé comme la CI, puis
//   supprimé dans tous les cas (fin, échec, Ctrl+C).
// Garde-fous : refus si VERCEL_ENV est défini ; adresses de base vers
// 127.0.0.1 seulement ; ce script ne lit aucun fichier de variables ;
// DATABASE_URL_MIGRATION n'est construite que vers le conteneur et n'est
// transmise qu'à la préparation et aux migrations, jamais à Playwright.
// Fiche : docs/features/e2e-base-jetable.md.
//
//   node scripts/e2e-base-jetable.mjs [arguments de playwright test]

// PostgreSQL 18.6, image officielle du 2026-10-06, épinglée par l'empreinte
// de son index (toutes architectures).
export const IMAGE =
  "postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336";
export const ETIQUETTE = "facturation-pme.e2e-base-jetable";

const PREFIXE_NOM = "facturation-pme-e2e-";
const HOTE = "127.0.0.1";
const BASE = "facturation_test";
const SIGNAUX = ["SIGINT", "SIGTERM", "SIGHUP"];
// Après un signal, Playwright a ce délai pour arrêter ses serveurs.
const DELAI_ARRET = 15_000;
const ATTENTE_BASE = 60_000;

// Chemins relatifs à la racine du dépôt : npm lance le script depuis elle.
const PREPARATION = resolve("scripts/preparer-base-test.mjs");
const DRIZZLE = resolve("node_modules/drizzle-kit/bin.cjs");
const PLAYWRIGHT = resolve("node_modules/@playwright/test/cli.js");

export const MESSAGE_DOCKER =
  "Docker est requis par npm run test:e2e hors CI (base PostgreSQL jetable). " +
  "Démarrer Docker Desktop, attendre « Engine running », puis relancer. " +
  "Sortie de secours, sur la branche dev : E2E_BASE=dev npm run test:e2e " +
  "(docs/CONFIGURATION.md, étape 9).";

const PREFIXE = "[base jetable]";

export function choisirMode(env) {
  if (env.VERCEL_ENV !== undefined) {
    throw new Error(`${PREFIXE} Refusé : VERCEL_ENV est défini. Jamais sur un déploiement.`);
  }
  if (env.E2E_BASE !== undefined) {
    if (env.E2E_BASE === "dev") return "dev";
    throw new Error(`${PREFIXE} Refusé : E2E_BASE n'accepte que « dev ».`);
  }
  return env.CI ? "ci" : "jetable";
}

export function argumentsRun(nom) {
  return [
    "run",
    "--detach",
    "--rm",
    "--name",
    nom,
    "--label",
    `${ETIQUETTE}=1`,
    // Valeur prise dans l'environnement de la commande docker : le mot de
    // passe n'apparaît pas dans la ligne de commande.
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    `POSTGRES_DB=${BASE}`,
    // 127.0.0.1 seulement, numéro choisi par Docker.
    "--publish",
    `${HOTE}::5432`,
    // Données en mémoire : aucun volume, rien sur le disque.
    "--tmpfs",
    "/var/lib/postgresql",
    IMAGE,
  ];
}

// Sortie de « docker port <nom> 5432/tcp » : une seule ligne 127.0.0.1:<port>.
export function lirePort(sortie) {
  const lignes = sortie
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter(Boolean);
  const correspondance = lignes.length === 1 ? /^127\.0\.0\.1:(\d{1,5})$/.exec(lignes[0]) : null;
  const port = correspondance ? Number(correspondance[1]) : 0;
  if (port < 1 || port > 65_535) {
    throw new Error(`${PREFIXE} Port publié refusé (127.0.0.1 seulement) : ${lignes.join(", ")}`);
  }
  return port;
}

export function adresseBase({ utilisateur, motDePasse, hote, port }) {
  if (hote !== HOTE) throw new Error(`${PREFIXE} Hôte de base refusé : 127.0.0.1 seulement.`);
  const identite = `${encodeURIComponent(utilisateur)}:${encodeURIComponent(motDePasse)}`;
  return `postgresql://${identite}@${HOTE}:${port}/${BASE}`;
}

function secondes(millisecondes) {
  return (millisecondes / 1000).toFixed(1).replace(".", ",");
}

class Interruption extends Error {}

export async function executer({ env, arguments: args, outils }) {
  const { commande, lancer, ecrire } = outils;
  let mode;
  try {
    mode = choisirMode(env);
  } catch (erreur) {
    ecrire(erreur.message);
    return 1;
  }
  const argumentsPlaywright = [PLAYWRIGHT, "test", ...args];

  const etat = { interrompu: false, enCours: null, minuterie: null };
  const controleur = new AbortController();
  const surSignal = () => {
    if (etat.interrompu) return;
    etat.interrompu = true;
    controleur.abort();
    ecrire(`${PREFIXE} Interruption : arrêt de Playwright, puis suppression du conteneur.`);
    if (etat.enCours) arreterPlusTard(etat.enCours);
  };
  // Playwright reçoit aussi le Ctrl+C et arrête ses serveurs ; il n'est
  // arrêté de force qu'après le délai.
  const arreterPlusTard = (lancement) => {
    etat.minuterie = setTimeout(() => lancement.arreter(), outils.delaiArret);
  };
  const suivre = async (programme, argumentsEnfant, envEnfant) => {
    if (etat.interrompu) throw new Interruption();
    const lancement = lancer(programme, argumentsEnfant, { env: envEnfant });
    etat.enCours = lancement;
    try {
      return await lancement.fin;
    } finally {
      etat.enCours = null;
      clearTimeout(etat.minuterie);
    }
  };
  const verifierInterruption = () => {
    if (etat.interrompu) throw new Interruption();
  };

  for (const signal of SIGNAUX) outils.signaux.on(signal, surSignal);
  try {
    if (mode !== "jetable") {
      const code = await suivre(process.execPath, argumentsPlaywright, env);
      return etat.interrompu ? 130 : code;
    }

    const info = await commande("docker", ["info", "--format", "{{.ServerVersion}}"], { env });
    if (info.code !== 0) {
      ecrire(`${PREFIXE} ${MESSAGE_DOCKER}`);
      return 1;
    }

    // Restes d'une exécution tuée sans pouvoir nettoyer (fenêtre fermée).
    const restes = await commande("docker", ["ps", "-aq", "--filter", `label=${ETIQUETTE}`], {
      env,
    });
    const anciens = restes.sortie.split(/\s+/).filter((id) => /^[0-9a-f]{12,64}$/.test(id));
    if (restes.code === 0 && anciens.length > 0) {
      ecrire(
        `${PREFIXE} Suppression de ${anciens.length} conteneur(s) d'une exécution précédente.`,
      );
      await commande("docker", ["rm", "-f", "-v", ...anciens], { env });
    }

    const nom = PREFIXE_NOM + randomBytes(6).toString("hex");
    const motProprietaire = randomBytes(24).toString("base64url");
    const motApplication = randomBytes(24).toString("base64url");
    let code = 1;
    let cree = false;
    try {
      const debut = outils.maintenant();
      ecrire(`${PREFIXE} Création du conteneur ${nom} (image tirée à la première exécution).`);
      const run = await commande("docker", argumentsRun(nom), {
        env: { ...env, POSTGRES_PASSWORD: motProprietaire },
      });
      if (run.code !== 0) {
        throw new Error(`${PREFIXE} docker run en échec (code ${run.code}). ${run.erreurs ?? ""}`);
      }
      cree = true;
      verifierInterruption();

      const publication = await commande("docker", ["port", nom, "5432/tcp"], { env });
      const port = lirePort(publication.sortie);
      const migration = adresseBase({
        utilisateur: "postgres",
        motDePasse: motProprietaire,
        hote: HOTE,
        port,
      });
      const application = adresseBase({
        utilisateur: "app_facturation",
        motDePasse: motApplication,
        hote: HOTE,
        port,
      });

      await outils.attendreBase(migration, controleur.signal);
      verifierInterruption();

      // Préparation identique à celle de la CI (.github/workflows/ci.yml).
      const envPreparation = {
        ...env,
        DATABASE_URL_MIGRATION: migration,
        DATABASE_URL: application,
      };
      const etapes = [
        ["Préparation de la base", [PREPARATION]],
        ["Migrations", [DRIZZLE, "migrate"]],
      ];
      for (const [libelle, argumentsEtape] of etapes) {
        const resultat = await suivre(process.execPath, argumentsEtape, envPreparation);
        if (resultat !== 0) throw new Error(`${PREFIXE} ${libelle} en échec (code ${resultat}).`);
      }
      ecrire(
        `${PREFIXE} PostgreSQL 18 prêt sur ${HOTE}:${port} en ${secondes(outils.maintenant() - debut)} s ` +
          "(conteneur, rôle, migrations).",
      );

      const envPlaywright = { ...env, DATABASE_URL: application };
      delete envPlaywright.DATABASE_URL_MIGRATION;
      code = await suivre(process.execPath, argumentsPlaywright, envPlaywright);
    } catch (erreur) {
      if (!(erreur instanceof Interruption)) ecrire(erreur.message);
      code = 1;
    } finally {
      const debutSuppression = outils.maintenant();
      const suppression = await commande("docker", ["rm", "-f", "-v", nom], { env });
      if (suppression.code === 0) {
        ecrire(
          `${PREFIXE} Conteneur supprimé en ${secondes(outils.maintenant() - debutSuppression)} s.`,
        );
      } else if (cree) {
        ecrire(`${PREFIXE} Conteneur NON supprimé. Le supprimer : docker rm -f -v ${nom}`);
        code ||= 1;
      }
    }
    if (code !== 0) {
      ecrire(`${PREFIXE} Sortie des serveurs de bout en bout : dossier .e2e-journaux/.`);
    }
    return etat.interrompu ? 130 : code;
  } finally {
    for (const signal of SIGNAUX) outils.signaux.off(signal, surSignal);
    clearTimeout(etat.minuterie);
  }
}

function commandeReelle(programme, args, { env }) {
  return new Promise((resoudre) => {
    const enfant = spawn(programme, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (morceau) => (sortie += morceau));
    enfant.stderr.on("data", (morceau) => (erreurs += morceau));
    // Docker absent : ENOENT.
    enfant.on("error", () => resoudre({ code: -1, sortie: "", erreurs: "" }));
    enfant.on("close", (code) => resoudre({ code: code ?? -1, sortie, erreurs: erreurs.trim() }));
  });
}

function lancerReel(programme, args, { env }) {
  const enfant = spawn(programme, args, { env, stdio: "inherit" });
  const fin = new Promise((resoudre) => {
    enfant.on("error", () => resoudre(1));
    enfant.on("exit", (code) => resoudre(code ?? 1));
  });
  const arreter = () => {
    if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill();
  };
  return { fin, arreter };
}

// Connexion TCP : la base d'initialisation de l'image n'écoute que sur sa
// socket locale, une connexion acceptée vient donc de la base définitive.
async function attendreBaseReelle(adresse, signal) {
  const limite = Date.now() + ATTENTE_BASE;
  for (;;) {
    if (signal.aborted) throw new Interruption();
    const client = new pg.Client({ connectionString: adresse, connectionTimeoutMillis: 2_000 });
    client.on("error", () => {});
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
    }
    if (Date.now() > limite) {
      throw new Error(`${PREFIXE} Base injoignable après ${ATTENTE_BASE / 1000} s.`);
    }
    await new Promise((resoudre) => setTimeout(resoudre, 250));
  }
}

// Exécuté seulement en ligne de commande, pas à l'import par les tests.
// Playwright charge ce module en CommonJS : ni import.meta ni await de
// premier niveau. Le lancement direct se reconnaît au nom du script.
if (basename(process.argv[1] ?? "") === "e2e-base-jetable.mjs") {
  executer({
    env: process.env,
    arguments: process.argv.slice(2),
    outils: {
      commande: commandeReelle,
      lancer: lancerReel,
      attendreBase: attendreBaseReelle,
      signaux: process,
      ecrire: (texte) => console.error(texte),
      maintenant: () => Date.now(),
      delaiArret: DELAI_ARRET,
    },
  }).then((code) => {
    process.exitCode = code;
  });
}
