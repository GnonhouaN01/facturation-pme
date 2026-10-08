import "server-only";

// Matrice rôles x droits, transcription unique de docs/THREATS.md section 6,
// qui fait foi. Un droit par ligne du tableau. Les contrôles d'accès et les
// tests la lisent tous deux (T-50). Fiche :
// docs/features/chaine-controles.md, section 8.

export const ROLES = ["proprietaire", "comptable", "commercial", "lecteur"] as const;

export type Role = (typeof ROLES)[number];

// oui : autorisé sur toute l'organisation. portefeuille (P*) : autorisé, limité
// au portefeuille quand la visibilité des Commerciaux est restreinte.
// lecture_portefeuille (L*) : lecture seule, même limite.
export type ValeurDroit = "oui" | "non" | "portefeuille" | "lecture_portefeuille";

export type DefinitionDroit = {
  groupe: string;
  libelle: string;
  valeurs: Readonly<Record<Role, ValeurDroit>>;
};

type Valeurs = readonly [ValeurDroit, ValeurDroit, ValeurDroit, ValeurDroit];

// Valeurs dans l'ordre des colonnes de THREATS.md : Propriétaire, Comptable,
// Commercial, Lecteur.
function ligne(groupe: string, libelle: string, valeurs: Valeurs): DefinitionDroit {
  const [proprietaire, comptable, commercial, lecteur] = valeurs;
  return Object.freeze({
    groupe,
    libelle,
    valeurs: Object.freeze({ proprietaire, comptable, commercial, lecteur }),
  });
}

const ORGANISATION = "Organisation";
const CLIENTS = "Clients";
const CATALOGUE = "Catalogue";
const DEVIS = "Devis";
const FACTURES = "Factures et avoirs";
const PAIEMENTS = "Paiements et relances";
const PILOTAGE = "Pilotage";

const DEFINITIONS = {
  "organisation.membres.voir": ligne(ORGANISATION, "Voir la liste des membres et leur rôle", [
    "oui",
    "oui",
    "oui",
    "oui",
  ]),
  "organisation.fiche.modifier": ligne(
    ORGANISATION,
    "Modifier la fiche, les taux de TVA, les délais",
    ["oui", "non", "non", "non"],
  ),
  "organisation.instructions_paiement.modifier": ligne(
    ORGANISATION,
    "Modifier les instructions de paiement",
    ["oui", "non", "non", "non"],
  ),
  "organisation.invitations.gerer": ligne(
    ORGANISATION,
    "Inviter un membre, révoquer une invitation",
    ["oui", "non", "non", "non"],
  ),
  "organisation.membres.gerer": ligne(ORGANISATION, "Modifier un rôle, retirer un membre", [
    "oui",
    "non",
    "non",
    "non",
  ]),
  "organisation.visibilite.regler": ligne(ORGANISATION, "Régler la visibilité des Commerciaux", [
    "oui",
    "non",
    "non",
    "non",
  ]),
  // Couvre aussi l'annulation de la suppression (UC-13, erreur 4a ; décision 6).
  "organisation.supprimer": ligne(ORGANISATION, "Supprimer l'organisation", [
    "oui",
    "non",
    "non",
    "non",
  ]),
  "organisation.quitter": ligne(ORGANISATION, "Quitter l'organisation", [
    "oui",
    "oui",
    "oui",
    "oui",
  ]),

  "clients.voir": ligne(CLIENTS, "Voir les clients", ["oui", "oui", "portefeuille", "oui"]),
  "clients.modifier": ligne(CLIENTS, "Créer, modifier, archiver un client", [
    "oui",
    "oui",
    "portefeuille",
    "non",
  ]),
  "clients.reaffecter": ligne(CLIENTS, "Réaffecter un client", ["oui", "non", "non", "non"]),
  "clients.anonymiser": ligne(CLIENTS, "Anonymiser un particulier", ["oui", "non", "non", "non"]),

  "catalogue.voir": ligne(CATALOGUE, "Voir le catalogue", ["oui", "oui", "oui", "oui"]),
  "catalogue.modifier": ligne(CATALOGUE, "Créer, modifier, désactiver un article", [
    "oui",
    "oui",
    "non",
    "non",
  ]),

  "devis.voir": ligne(DEVIS, "Voir les devis", ["oui", "oui", "portefeuille", "oui"]),
  "devis.brouillons.modifier": ligne(DEVIS, "Créer, modifier, supprimer un brouillon", [
    "oui",
    "oui",
    "portefeuille",
    "non",
  ]),
  "devis.envoyer": ligne(DEVIS, "Envoyer, révoquer le lien", ["oui", "oui", "portefeuille", "non"]),
  "devis.reponse.marquer": ligne(DEVIS, "Marquer accepté ou refusé", [
    "oui",
    "oui",
    "portefeuille",
    "non",
  ]),
  "devis.transformer": ligne(DEVIS, "Transformer en brouillon de facture", [
    "oui",
    "oui",
    "portefeuille",
    "non",
  ]),

  "factures.brouillons.voir": ligne(FACTURES, "Voir les brouillons de facture", [
    "oui",
    "oui",
    "portefeuille",
    "oui",
  ]),
  "factures.brouillons.modifier": ligne(FACTURES, "Créer, modifier, supprimer un brouillon", [
    "oui",
    "oui",
    "portefeuille",
    "non",
  ]),
  "factures.emises.voir": ligne(FACTURES, "Voir les factures émises, les avoirs et les paiements", [
    "oui",
    "oui",
    "lecture_portefeuille",
    "oui",
  ]),
  "factures.emettre": ligne(FACTURES, "Émettre une facture, relancer une certification", [
    "oui",
    "oui",
    "non",
    "non",
  ]),
  "factures.envoyer": ligne(FACTURES, "Envoyer une facture, révoquer le lien", [
    "oui",
    "oui",
    "non",
    "non",
  ]),
  "avoirs.emettre": ligne(FACTURES, "Émettre un avoir", ["oui", "oui", "non", "non"]),

  "paiements.enregistrer": ligne(PAIEMENTS, "Enregistrer un paiement", [
    "oui",
    "oui",
    "non",
    "non",
  ]),
  "paiements.annuler": ligne(PAIEMENTS, "Annuler un paiement, enregistrer un remboursement", [
    "oui",
    "oui",
    "non",
    "non",
  ]),
  "relances.modeles.gerer": ligne(PAIEMENTS, "Gérer les modèles de relance", [
    "oui",
    "oui",
    "non",
    "non",
  ]),
  "relances.envoyer": ligne(PAIEMENTS, "Envoyer une relance", ["oui", "oui", "non", "non"]),

  "tableau_de_bord.voir": ligne(PILOTAGE, "Voir le tableau de bord", [
    "oui",
    "oui",
    "portefeuille",
    "oui",
  ]),
  "exports.csv": ligne(PILOTAGE, "Exporter en CSV", ["oui", "oui", "non", "oui"]),
  "exports.complet": ligne(PILOTAGE, "Exporter l'ensemble des données", [
    "oui",
    "non",
    "non",
    "non",
  ]),
  "journal.consulter": ligne(PILOTAGE, "Consulter le journal d'audit", [
    "oui",
    "non",
    "non",
    "non",
  ]),
} as const satisfies Record<string, DefinitionDroit>;

// Type précis des droits : une déclaration d'action qui cite un droit inconnu
// ne compile pas (PR 2).
export type Droit = keyof typeof DEFINITIONS;

export const DROITS: Readonly<Record<string, DefinitionDroit>> = Object.freeze(DEFINITIONS);

// Le rôle vient de member.role, colonne text écrite par Better Auth : peut et
// perimetre reçoivent donc une chaîne quelconque. Seules les clés propres de
// la matrice comptent (Object.hasOwn) : un rôle ou un droit comme
// « __proto__ », « constructor », « owner », « member » ou
// « comptable,proprietaire » n'a aucun droit (décision 1, T-51).
function valeur(role: string, droit: string): ValeurDroit {
  if (!Object.hasOwn(DROITS, droit)) return "non";
  const definition = DROITS[droit];
  if (!definition || !Object.hasOwn(definition.valeurs, role)) return "non";
  return definition.valeurs[role as Role];
}

export function peut(role: string, droit: string): boolean {
  return valeur(role, droit) !== "non";
}

// Étendue d'un droit accordé : « portefeuille » pour P* et L*. Le filtrage
// par portefeuille et le réglage de visibilité sont la fonctionnalité 7.4.
// N'a de sens qu'après peut(role, droit) ; un droit refusé vaut
// « organisation », sans effet puisque la chaîne a déjà refusé.
export function perimetre(role: string, droit: string): "organisation" | "portefeuille" {
  const v = valeur(role, droit);
  return v === "portefeuille" || v === "lecture_portefeuille" ? "portefeuille" : "organisation";
}
