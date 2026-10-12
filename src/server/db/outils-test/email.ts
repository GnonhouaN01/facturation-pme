import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";

import { creerChaine, type Chaine } from "../../actions/action";
import { lireSession } from "../../auth/session";
import { creerVerificateur, type Verificateur } from "../../debit/debit";
import type { Limite, NomLimite } from "../../debit/limites";
import { adressePourCompteur } from "../../email/adresse";
import { creerPorteEmail } from "../../email/envoi";
import { env } from "../../env";
import { journaliser } from "../../journal/audit";
import { creerTransportMemoire } from "../../modules/email/memoire";
import { db, executerDansOrganisation } from "../client";
import { creerCompteur } from "../debit";
import { lireAdhesion } from "../requetes/adhesions";
import { compteurDebit } from "../schema/technique";

// Outillage des tests d'envoi d'emails avec la vraie base : chaîne réelle,
// compteur réel, transport en mémoire (aucun réseau). Ne s'importe que depuis
// un fichier de test. Fiche : docs/features/envoi-emails.md, « Tests à
// écrire ».

// Limites de test, petites pour atteindre les plafonds en quelques appels.
// Aucune limite de démonstration dans LIMITES.
export const LIMITES_TEST = {
  "membre.action": { maximum: 1_000, fenetreSecondes: 60, par: "utilisateur" },
  "email.destinataire": { maximum: 2, fenetreSecondes: 3_600, par: "destinataire" },
  "email.destinataire_jour": { maximum: 10, fenetreSecondes: 86_400, par: "destinataire" },
  "email.organisation": { maximum: 3, fenetreSecondes: 86_400, par: "organisation" },
  "email.application": { maximum: 5, fenetreSecondes: 86_400, par: "application" },
} as const satisfies Record<NomLimite, Limite>;

const NOMS = Object.keys(LIMITES_TEST) as NomLimite[];

export type Banc = {
  chaine: Chaine;
  transport: ReturnType<typeof creerTransportMemoire>;
  verificateur: Verificateur;
  // Clés du compteur pour une liste de valeurs : organisations, adresses
  // (normalisées ici pour le compteur), « gmail ».
  cles: (valeurs: string[]) => string[];
  // Supprime les lignes du compteur de ces valeurs, toutes limites confondues.
  nettoyer: (valeurs: string[]) => Promise<void>;
};

// Un banc par test : secret aléatoire, donc des clés de compteur que ne
// partage aucun autre test, aucun autre fichier, aucune autre exécution. Le
// compteur « application » d'un test ne voit que ses propres envois.
export function creerBanc(): Banc {
  const verificateur = creerVerificateur({
    limites: LIMITES_TEST,
    compteur: creerCompteur(db),
    secret: randomBytes(32),
  });
  const transport = creerTransportMemoire();
  const { envoyerEmail } = creerPorteEmail({
    transport,
    expediteur: "application@exemple.invalid",
    // Liste autorisée ignorée : les adresses des tests sont aléatoires, en
    // .invalid, et le transport est en mémoire. L'invariant de la liste est
    // éprouvé par src/server/email/envoi.test.ts.
    estProduction: true,
    destinatairesAutorises: [],
    origine: env.BETTER_AUTH_URL,
  });
  const chaine = creerChaine({
    origineAttendue: env.BETTER_AUTH_URL,
    lireSession,
    executerDansOrganisation,
    lireAdhesion,
    journaliser,
    verifierDebit: (nom, valeur) => verificateur.verifierDebit(nom, valeur),
    envoyerEmail,
  });

  function cles(valeurs: string[]): string[] {
    const variantes = valeurs.flatMap((v) => (v.includes("@") ? [v, adressePourCompteur(v)] : [v]));
    return NOMS.flatMap((nom) => variantes.map((v) => verificateur.cle(nom, v)));
  }

  async function nettoyer(valeurs: string[]): Promise<void> {
    if (valeurs.length === 0) return;
    await db.delete(compteurDebit).where(inArray(compteurDebit.cle, cles(valeurs)));
  }

  return { chaine, transport, verificateur, cles, nettoyer };
}

// Une adresse neuve, sur un domaine réservé qui ne peut pas exister (RFC 2606).
export function adresseDeTest(): string {
  return `destinataire-${randomUUID()}@exemple.invalid`;
}
