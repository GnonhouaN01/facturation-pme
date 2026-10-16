import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";

import { ADRESSES_E2E, EXECUTION } from "./comptes-e2e";

// Organisation de test du gabarit connecté (1.2) : une organisation, une
// adhésion au rôle proprietaire et l'organisation active des sessions, par
// SQL, pour un compte de l'exécution. Aucun écran ne crée d'adhésion avant la
// 2.1. Conditions fixées par le développeur (décision 4), chacune testée
// (e2e/organisation-e2e.spec.ts) :
// - code dans e2e/ seulement, jamais dans src/ ;
// - base jetable (E2E_BASE_JETABLE=1, posée par scripts/e2e-base-jetable.mjs)
//   ou service de la CI (CI), hôte 127.0.0.1 ou localhost ; sinon, les tests
//   sont sautés avec un message, sans connexion ni écriture ;
// - DATABASE_URL seule, prise dans l'environnement du processus, utilisateur
//   app_facturation, le rôle de l'application ; ce fichier ne lit aucun
//   fichier de variables ;
// - identifiants tirés à chaque exécution ;
// - suppression par la liste exacte des identifiants créés ;
// - refus si VERCEL_ENV est défini.
// Fiche : docs/features/connexion.md, section 8.2.

type Source = Readonly<Record<string, string | undefined>>;

export type PoolOrganisation = {
  query: (
    texte: string,
    valeurs: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

export const REQUETE_SUPPRESSION = 'DELETE FROM "organization" WHERE id = ANY($1::uuid[])';
const REQUETE_UTILISATEUR = 'SELECT id FROM "user" WHERE email = $1';
const REQUETE_ORGANISATION =
  'INSERT INTO "organization" (id, name, slug, created_at) VALUES ($1, $2, $3, now())';
const REQUETE_ADHESION =
  'INSERT INTO "member" (organization_id, user_id, role, created_at) VALUES ($1, $2, $3, now())';
const REQUETE_SESSION = 'UPDATE "session" SET active_organization_id = $1 WHERE user_id = $2';

const HOTES_ADMIS = new Set(["127.0.0.1", "localhost"]);
const ROLE_APPLICATION = "app_facturation";
const NOM_ORGANISATION = "Organisation de bout en bout";

export type OutilOrganisation = {
  rattacher: (email: string) => Promise<{ organisationId: string }>;
  nettoyer: () => Promise<number>;
};

function saut(raison: string): { saut: string } {
  return { saut: `Organisation de test sautée : ${raison}.` };
}

export function creerOutilOrganisation(options: {
  source: Source;
  ouvrir: (adresse: string) => PoolOrganisation;
  execution: string;
}): OutilOrganisation | { saut: string } {
  const { source } = options;
  if (source.VERCEL_ENV !== undefined) {
    throw new Error("Organisation de test refusée : VERCEL_ENV est défini.");
  }
  if (source.E2E_BASE === "dev") {
    return saut("E2E_BASE=dev, elle n'écrit que sur la base jetable ou en CI");
  }
  if (source.E2E_BASE_JETABLE !== "1" && !source.CI) {
    return saut("ni base jetable ni CI");
  }
  const base = source.DATABASE_URL;
  if (!base) return saut("DATABASE_URL absente (base jetable ou CI attendue)");
  let adresse: URL;
  try {
    adresse = new URL(base);
  } catch {
    return saut("DATABASE_URL illisible (base jetable ou CI attendue)");
  }
  if (!HOTES_ADMIS.has(adresse.hostname)) {
    return saut("hôte de base autre que 127.0.0.1 ou localhost (base jetable ou CI attendue)");
  }
  if (decodeURIComponent(adresse.username) !== ROLE_APPLICATION) {
    throw new Error(`Organisation de test refusée : rôle autre que ${ROLE_APPLICATION}.`);
  }

  let pool: PoolOrganisation | null = null;
  const creees: string[] = [];
  const connexion = () => (pool ??= options.ouvrir(base));

  return {
    async rattacher(email) {
      if (!ADRESSES_E2E.includes(email)) {
        throw new Error("Organisation de test refusée : adresse hors de l'exécution.");
      }
      const base = connexion();
      const { rows } = await base.query(REQUETE_UTILISATEUR, [email]);
      const utilisateurId = (rows[0] as { id?: unknown } | undefined)?.id;
      if (typeof utilisateurId !== "string") throw new Error("Compte de test introuvable.");
      const organisationId = randomUUID();
      creees.push(organisationId);
      const slug = `e2e-${options.execution}-${randomBytes(4).toString("hex")}`;
      await base.query(REQUETE_ORGANISATION, [organisationId, NOM_ORGANISATION, slug]);
      await base.query(REQUETE_ADHESION, [organisationId, utilisateurId, "proprietaire"]);
      await base.query(REQUETE_SESSION, [organisationId, utilisateurId]);
      return { organisationId };
    },
    async nettoyer() {
      if (creees.length === 0 || pool === null) return 0;
      const ouvert = pool;
      try {
        const { rowCount } = await ouvert.query(REQUETE_SUPPRESSION, [creees.splice(0)]);
        return rowCount ?? 0;
      } finally {
        pool = null;
        await ouvert.end();
      }
    },
  };
}

// Outil lié à l'environnement du processus et à un vrai Pool d'une connexion.
export function outilOrganisation(): OutilOrganisation | { saut: string } {
  return creerOutilOrganisation({
    source: process.env,
    ouvrir: (adresse) => new Pool({ connectionString: adresse, max: 1 }),
    execution: EXECUTION ?? "",
  });
}
