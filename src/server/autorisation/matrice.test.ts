import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { DROITS, peut, perimetre, ROLES, type Role, type ValeurDroit } from "./matrice";

// La matrice du code est la transcription exacte du tableau de
// docs/THREATS.md, section 6, qui fait foi (SPEC.md section 2.2). Ce test lit
// le document et compare chaque case. Fiche :
// docs/features/chaine-controles.md, section 8.

const ROLES_ATTENDUS = ["proprietaire", "comptable", "commercial", "lecteur"] as const;

// En-têtes du tableau, dans l'ordre des colonnes.
const COLONNES: Record<string, (typeof ROLES_ATTENDUS)[number]> = {
  Propriétaire: "proprietaire",
  Comptable: "comptable",
  Commercial: "commercial",
  Lecteur: "lecteur",
};

const SYMBOLES: Record<string, ValeurDroit> = {
  "✔": "oui",
  "✖": "non",
  "P\\*": "portefeuille",
  "L\\*": "lecture_portefeuille",
};

// Divergences 1 et 2 de la fiche, section 8.3. Le groupe « Par lien, sans
// compte » n'a pas de rôle : ses lignes passent par la recherche du lien, sans
// session, et auront leur propre chaîne (4.5, 5.4). La phrase sous le tableau
// (gestion de son propre compte) n'est pas une ligne : rien à exclure.
const GROUPES_EXCLUS = ["Par lien, sans compte"];

// Identifiants validés (décision 7), avec la ligne du document qu'ils
// désignent. Une ligne s'identifie par son groupe et son libellé : deux lignes
// portent le libellé « Créer, modifier, supprimer un brouillon ».
const IDENTIFIANTS: Record<string, readonly [string, string]> = {
  "organisation.membres.voir": ["Organisation", "Voir la liste des membres et leur rôle"],
  "organisation.fiche.modifier": ["Organisation", "Modifier la fiche, les taux de TVA, les délais"],
  "organisation.instructions_paiement.modifier": [
    "Organisation",
    "Modifier les instructions de paiement",
  ],
  "organisation.invitations.gerer": ["Organisation", "Inviter un membre, révoquer une invitation"],
  "organisation.membres.gerer": ["Organisation", "Modifier un rôle, retirer un membre"],
  "organisation.visibilite.regler": ["Organisation", "Régler la visibilité des Commerciaux"],
  "organisation.supprimer": ["Organisation", "Supprimer l'organisation"],
  "organisation.quitter": ["Organisation", "Quitter l'organisation"],
  "clients.voir": ["Clients", "Voir les clients"],
  "clients.modifier": ["Clients", "Créer, modifier, archiver un client"],
  "clients.reaffecter": ["Clients", "Réaffecter un client"],
  "clients.anonymiser": ["Clients", "Anonymiser un particulier"],
  "catalogue.voir": ["Catalogue", "Voir le catalogue"],
  "catalogue.modifier": ["Catalogue", "Créer, modifier, désactiver un article"],
  "devis.voir": ["Devis", "Voir les devis"],
  "devis.brouillons.modifier": ["Devis", "Créer, modifier, supprimer un brouillon"],
  "devis.envoyer": ["Devis", "Envoyer, révoquer le lien"],
  "devis.reponse.marquer": ["Devis", "Marquer accepté ou refusé"],
  "devis.transformer": ["Devis", "Transformer en brouillon de facture"],
  "factures.brouillons.voir": ["Factures et avoirs", "Voir les brouillons de facture"],
  "factures.brouillons.modifier": ["Factures et avoirs", "Créer, modifier, supprimer un brouillon"],
  "factures.emises.voir": [
    "Factures et avoirs",
    "Voir les factures émises, les avoirs et les paiements",
  ],
  "factures.emettre": ["Factures et avoirs", "Émettre une facture, relancer une certification"],
  "factures.envoyer": ["Factures et avoirs", "Envoyer une facture, révoquer le lien"],
  "avoirs.emettre": ["Factures et avoirs", "Émettre un avoir"],
  "paiements.enregistrer": ["Paiements et relances", "Enregistrer un paiement"],
  "paiements.annuler": [
    "Paiements et relances",
    "Annuler un paiement, enregistrer un remboursement",
  ],
  "relances.modeles.gerer": ["Paiements et relances", "Gérer les modèles de relance"],
  "relances.envoyer": ["Paiements et relances", "Envoyer une relance"],
  "tableau_de_bord.voir": ["Pilotage", "Voir le tableau de bord"],
  "exports.csv": ["Pilotage", "Exporter en CSV"],
  "exports.complet": ["Pilotage", "Exporter l'ensemble des données"],
  "journal.consulter": ["Pilotage", "Consulter le journal d'audit"],
};

type LigneDocument = {
  groupe: string;
  libelle: string;
  valeurs: Record<(typeof ROLES_ATTENDUS)[number], ValeurDroit>;
};

function cellules(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cellule) => cellule.trim());
}

// Lit le tableau de la section 6 d'un texte au format de THREATS.md. Lève une
// erreur sur toute forme inattendue, pour qu'un changement de format fasse
// échouer le test au lieu de le faire réussir à vide.
function lireMatriceDocument(texte: string): LigneDocument[] {
  const debut = texte.indexOf("\n## 6. Matrice");
  if (debut === -1) throw new Error("Section 6 introuvable.");
  const suite = texte.indexOf("\n## ", debut + 1);
  const section = texte.slice(debut, suite === -1 ? undefined : suite);

  const lignesTableau = section.split("\n").filter((ligne) => ligne.trim().startsWith("|"));
  const [entete, separateur, ...corps] = lignesTableau;
  if (!entete || !separateur) throw new Error("Tableau introuvable.");

  const colonnes = cellules(entete);
  if (colonnes[0] !== "Action") throw new Error("Première colonne inattendue.");
  const roles = colonnes.slice(1).map((nom) => {
    const role = COLONNES[nom];
    if (!role) throw new Error(`Colonne inattendue : ${nom}`);
    return role;
  });
  if (roles.length !== ROLES_ATTENDUS.length) throw new Error("Nombre de colonnes inattendu.");

  const lignes: LigneDocument[] = [];
  let groupe: string | undefined;
  for (const brute of corps) {
    const [premiere = "", ...reste] = cellules(brute);
    const titre = /^\*\*(.+)\*\*$/.exec(premiere);
    if (titre && reste.every((cellule) => cellule === "")) {
      groupe = titre[1];
      continue;
    }
    if (!groupe) throw new Error(`Ligne hors groupe : ${premiere}`);
    if (GROUPES_EXCLUS.includes(groupe)) continue;
    if (reste.length !== roles.length) throw new Error(`Ligne incomplète : ${premiere}`);

    const valeurs = {} as LigneDocument["valeurs"];
    reste.forEach((symbole, i) => {
      const valeur = SYMBOLES[symbole];
      const role = roles[i];
      if (!valeur || !role) throw new Error(`Case inattendue : ${premiere}, ${symbole}`);
      valeurs[role] = valeur;
    });
    lignes.push({ groupe, libelle: premiere, valeurs });
  }
  return lignes;
}

const DOCUMENT = readFileSync(
  fileURLToPath(new URL("../../../docs/THREATS.md", import.meta.url)),
  "utf8",
);

const DEMONSTRATION = `
## 6. Matrice rôles x actions

| Action | Propriétaire | Comptable | Commercial | Lecteur |
|---|---|---|---|---|
| **Groupe A** | | | | |
| Faire une chose | ✔ | ✖ | P\\* | L\\* |
| **Par lien, sans compte** | | | | |
| Consulter par lien | Client final détenteur du lien | | | |

## 7. Suite
`;

describe("lecture du tableau du document", () => {
  test("lit le tableau de démonstration et ignore le groupe exclu", () => {
    expect(lireMatriceDocument(DEMONSTRATION)).toStrictEqual([
      {
        groupe: "Groupe A",
        libelle: "Faire une chose",
        valeurs: {
          proprietaire: "oui",
          comptable: "non",
          commercial: "portefeuille",
          lecteur: "lecture_portefeuille",
        },
      },
    ]);
  });

  test("une case modifiée dans le document change la valeur lue", () => {
    const modifie = DEMONSTRATION.replace("| ✔ | ✖ |", "| ✔ | ✔ |");
    expect(lireMatriceDocument(modifie)[0]?.valeurs.comptable).toBe("oui");
  });

  test("un symbole inconnu, une colonne inconnue ou une section absente lèvent une erreur", () => {
    expect(() => lireMatriceDocument(DEMONSTRATION.replace("| ✖ |", "| ? |"))).toThrow();
    expect(() => lireMatriceDocument(DEMONSTRATION.replace("Comptable", "Gérant"))).toThrow();
    expect(() => lireMatriceDocument(DEMONSTRATION.replace("## 6.", "## 9."))).toThrow();
  });
});

describe("matrice des droits", () => {
  const lignes = lireMatriceDocument(DOCUMENT);

  test("les rôles sont exactement les quatre rôles, dans l'ordre", () => {
    expect([...ROLES]).toStrictEqual([...ROLES_ATTENDUS]);
  });

  test("le document compte 33 lignes, soit 132 cases (le test ne réussit pas à vide)", () => {
    expect(lignes).toHaveLength(33);
    expect(lignes.flatMap((ligne) => Object.keys(ligne.valeurs))).toHaveLength(132);
  });

  test("les identifiants des droits sont exactement les 33 validés", () => {
    expect(Object.keys(DROITS).sort()).toStrictEqual(Object.keys(IDENTIFIANTS).sort());
  });

  test("chaque identifiant désigne la ligne validée du document", () => {
    for (const [identifiant, [groupe, libelle]] of Object.entries(IDENTIFIANTS)) {
      expect({ identifiant, groupe: DROITS[identifiant]?.groupe }).toStrictEqual({
        identifiant,
        groupe,
      });
      expect({ identifiant, libelle: DROITS[identifiant]?.libelle }).toStrictEqual({
        identifiant,
        libelle,
      });
    }
  });

  test("chaque ligne du document a un droit, et chaque droit une ligne du document", () => {
    const duDocument = lignes.map((ligne) => `${ligne.groupe} / ${ligne.libelle}`).sort();
    const duCode = Object.values(DROITS)
      .map((droit) => `${droit.groupe} / ${droit.libelle}`)
      .sort();
    expect(duCode).toStrictEqual(duDocument);
  });

  test.each(lignes.map((ligne) => [`${ligne.groupe} / ${ligne.libelle}`, ligne] as const))(
    "les quatre cases de « %s » sont celles du document",
    (_, ligne) => {
      const droit = Object.values(DROITS).find(
        (d) => d.groupe === ligne.groupe && d.libelle === ligne.libelle,
      );
      expect(droit?.valeurs).toStrictEqual(ligne.valeurs);
    },
  );
});

describe("peut et perimetre", () => {
  const lignes = lireMatriceDocument(DOCUMENT);
  const cases = lignes.flatMap((ligne) => {
    const identifiant = Object.entries(IDENTIFIANTS).find(
      ([, [groupe, libelle]]) => groupe === ligne.groupe && libelle === ligne.libelle,
    )?.[0];
    return ROLES_ATTENDUS.map((role) => [identifiant ?? "", role, ligne.valeurs[role]] as const);
  });

  test("132 cases à vérifier", () => {
    expect(cases).toHaveLength(132);
    expect(cases.every(([identifiant]) => identifiant !== "")).toBe(true);
  });

  test.each(cases)("%s, %s : %s", (identifiant, role, valeur) => {
    expect(peut(role, identifiant)).toBe(valeur !== "non");
    if (valeur !== "non") {
      expect(perimetre(role, identifiant)).toBe(valeur === "oui" ? "organisation" : "portefeuille");
    }
  });
});

describe("rôles et droits hors liste (T-51)", () => {
  // Valeurs que member.role peut contenir sans être l'un de nos rôles : les
  // rôles par défaut de Better Auth, plusieurs rôles séparés par une virgule,
  // une casse ou des espaces différents, et des noms de propriétés héritées.
  const ROLES_INCONNUS = [
    "owner",
    "admin",
    "member",
    "",
    "Proprietaire",
    "PROPRIETAIRE",
    " proprietaire",
    "proprietaire ",
    "comptable,proprietaire",
    "proprietaire,lecteur",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ];

  test.each(ROLES_INCONNUS)("le rôle %j n'a aucun droit", (role) => {
    for (const identifiant of Object.keys(IDENTIFIANTS)) {
      expect({ identifiant, autorise: peut(role as Role, identifiant) }).toStrictEqual({
        identifiant,
        autorise: false,
      });
    }
  });

  test.each(["droit.inconnu", "", "__proto__", "constructor", "organisation"])(
    "le droit %j n'est accordé à aucun rôle",
    (identifiant) => {
      for (const role of ROLES_ATTENDUS) {
        expect(peut(role, identifiant)).toBe(false);
      }
    },
  );
});
