// Vérifie qu'à l'exécution la base fabrique des identifiants UUID pour les
// lignes créées par Better Auth. Écrit dans la base : ne s'exécute que sur
// une base locale (CI). Script provisoire : il sera remplacé par un test
// Vitest avec l'outillage de la fonctionnalité 0.2.
// Fiche : docs/features/identifiants-uuid.md.

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

// Garde : avant de charger Better Auth et avant toute connexion.
// Le message ne cite jamais l'hôte ni l'adresse.
let hote: string;
try {
  hote = new URL(process.env.DATABASE_URL ?? "").hostname;
} catch {
  arreter("DATABASE_URL absente ou invalide.");
}
if (!["localhost", "127.0.0.1"].includes(hote)) {
  arreter("Ce script ne s'execute que sur une base locale de test. Hote refuse.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let echecs = 0;
function verifier(libelle: string, obtenu: unknown, attendu: unknown): void {
  const ok = obtenu === attendu;
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK   " : "ECHEC"} ${libelle} : obtenu ${obtenu}, attendu ${attendu}`);
}

const { auth } = await import("../src/server/auth/config");
const { adapter } = await auth.$context;

// Marqueurs uniques : ils permettent de retrouver les lignes à supprimer même
// si une création échoue avant d'avoir renvoyé son identifiant.
const marqueur = crypto.randomUUID();
const email = `verification-${marqueur}@exemple.test`;
const slug = `verification-${marqueur}`;

let idUtilisateur: string | undefined;
let idOrganisation: string | undefined;

try {
  const utilisateur = await adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: "Verification UUID",
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  idUtilisateur = utilisateur.id;
  verifier("user.id est un UUID", UUID.test(utilisateur.id), true);
  const utilisateurRelu = await adapter.findOne<{ id: string }>({
    model: "user",
    where: [{ field: "email", value: email }],
  });
  verifier("user.id relu identique", utilisateurRelu?.id === utilisateur.id, true);

  const organisation = await adapter.create<Record<string, unknown>, { id: string }>({
    model: "organization",
    data: { name: "Verification UUID", slug, createdAt: new Date() },
  });
  idOrganisation = organisation.id;
  verifier("organization.id est un UUID", UUID.test(organisation.id), true);
  const organisationRelue = await adapter.findOne<{ id: string }>({
    model: "organization",
    where: [{ field: "slug", value: slug }],
  });
  verifier("organization.id relu identique", organisationRelue?.id === organisation.id, true);

  const adhesion = await adapter.create<
    Record<string, unknown>,
    { id: string; organizationId: string; userId: string }
  >({
    model: "member",
    data: {
      organizationId: organisation.id,
      userId: utilisateur.id,
      role: "owner",
      createdAt: new Date(),
    },
  });
  verifier("member.id est un UUID", UUID.test(adhesion.id), true);
  verifier("member.organization_id relie l'organisation", adhesion.organizationId, organisation.id);
  verifier("member.user_id relie l'utilisateur", adhesion.userId, utilisateur.id);
} catch (erreur) {
  echecs += 1;
  console.log(`ECHEC Creation interrompue : ${(erreur as Error).message}`);
} finally {
  // Nettoyage dans tous les cas. Les adhésions disparaissent avec
  // l'organisation et l'utilisateur (clés étrangères en cascade).
  try {
    await adapter.deleteMany({ model: "organization", where: [{ field: "slug", value: slug }] });
    await adapter.deleteMany({ model: "user", where: [{ field: "email", value: email }] });
    verifier(
      "Nettoyage, utilisateurs restants",
      await adapter.count({ model: "user", where: [{ field: "email", value: email }] }),
      0,
    );
    verifier(
      "Nettoyage, organisations restantes",
      await adapter.count({ model: "organization", where: [{ field: "slug", value: slug }] }),
      0,
    );
    if (idUtilisateur || idOrganisation) {
      const where = idUtilisateur
        ? [{ field: "userId", value: idUtilisateur }]
        : [{ field: "organizationId", value: idOrganisation as string }];
      verifier(
        "Nettoyage, adhesions restantes",
        await adapter.count({ model: "member", where }),
        0,
      );
    }
  } catch (erreur) {
    echecs += 1;
    console.log(`ECHEC Nettoyage interrompu : ${(erreur as Error).message}`);
  }
}

console.log(echecs === 0 ? "\nCreation verifiee." : `\n${echecs} verification(s) en echec.`);
process.exit(echecs === 0 ? 0 : 1);
