import { describe, expect, test } from "vitest";

import { fenetreMaxSecondes, LIMITES, VALEUR_APPLICATION, type Limite } from "./limites";

// Les limites, source unique. Fiche : docs/features/limitation-debit.md,
// section 1.

const UN_JOUR = 24 * 60 * 60;

describe("LIMITES", () => {
  test.each(Object.entries(LIMITES))(
    "%s : nom, maximum, fenêtre et désignation valides",
    (nom, limite: Limite) => {
      // Le nom apparaît en clair dans la clé, avant « : ».
      expect(nom).toMatch(/^[a-z_.]+$/);
      expect(Number.isInteger(limite.maximum)).toBe(true);
      expect(limite.maximum).toBeGreaterThan(0);
      expect(Number.isInteger(limite.fenetreSecondes)).toBe(true);
      expect(limite.fenetreSecondes).toBeGreaterThan(0);
      expect(limite.fenetreSecondes).toBeLessThanOrEqual(UN_JOUR);
      // 0.7 : trois valeurs de plus, pour les limites d'envoi d'emails
      // (docs/features/envoi-emails.md, section 5.2). 1.1 : adresse_ip, pour
      // les points d'entrée de Better Auth (docs/features/inscription.md,
      // section 3.2). 1.2 : adresse_email, pour la limite de connexion par
      // compte (docs/features/connexion.md, section 3).
      expect([
        "utilisateur",
        "application",
        "organisation",
        "destinataire",
        "adresse_ip",
        "adresse_email",
      ]).toContain(limite.par);
      // 1.4 : aucune valeur nouvelle ; les limites par compte de la double
      // authentification comptent l'utilisateur.
    },
  );

  test("membre.action : 60 tentatives par minute et par utilisateur (décision 4)", () => {
    expect(LIMITES["membre.action"]).toStrictEqual({
      maximum: 60,
      fenetreSecondes: 60,
      par: "utilisateur",
    });
  });
});

// Limites d'envoi d'emails (décision 5). Fiche : docs/features/envoi-emails.md,
// section 5.
const UNE_HEURE = 60 * 60;
const LIMITE_GMAIL_PAR_JOUR = 500;

describe("limites d'envoi d'emails (0.7)", () => {
  test("valeurs retenues (décision 5)", () => {
    expect(LIMITES["email.application"]).toStrictEqual({
      maximum: 200,
      fenetreSecondes: UN_JOUR,
      par: "application",
    });
    expect(LIMITES["email.organisation"]).toStrictEqual({
      maximum: 40,
      fenetreSecondes: UN_JOUR,
      par: "organisation",
    });
    expect(LIMITES["email.destinataire"]).toStrictEqual({
      maximum: 3,
      fenetreSecondes: UNE_HEURE,
      par: "destinataire",
    });
    expect(LIMITES["email.destinataire_jour"]).toStrictEqual({
      maximum: 10,
      fenetreSecondes: UN_JOUR,
      par: "destinataire",
    });
  });

  test("au bord de la fenêtre fixe (2 × le maximum), toujours sous la limite de Gmail", () => {
    expect(2 * LIMITES["email.application"].maximum).toBeLessThan(LIMITE_GMAIL_PAR_JOUR);
    expect(LIMITES["email.application"].fenetreSecondes).toBeLessThanOrEqual(UN_JOUR);
  });

  test("une organisation seule n'épuise pas la limite de l'application", () => {
    expect(LIMITES["email.organisation"].maximum).toBeLessThan(
      LIMITES["email.application"].maximum,
    );
  });

  test("la limite par heure d'un destinataire est sous sa limite par jour", () => {
    expect(LIMITES["email.destinataire"].maximum).toBeLessThan(
      LIMITES["email.destinataire_jour"].maximum,
    );
  });
});

describe("fenetreMaxSecondes", () => {
  test("renvoie la plus longue fenêtre", () => {
    const limites: Record<string, Limite> = {
      courte: { maximum: 3, fenetreSecondes: 10, par: "utilisateur" },
      longue: { maximum: 5, fenetreSecondes: 3_600, par: "utilisateur" },
      moyenne: { maximum: 9, fenetreSecondes: 60, par: "utilisateur" },
    };

    expect(fenetreMaxSecondes(limites)).toBe(3_600);
  });

  test("LIMITES : positive et au plus 24 heures", () => {
    const fenetre = fenetreMaxSecondes(LIMITES);

    expect(fenetre).toBeGreaterThan(0);
    expect(fenetre).toBeLessThanOrEqual(UN_JOUR);
  });
});

// Limites des points d'entrée de Better Auth et des emails de compte (1.1).
// Fiche : docs/features/inscription.md, section 3.2.
describe("limites de l'inscription (1.1)", () => {
  test("valeurs retenues (décision par défaut 6)", () => {
    expect(LIMITES["auth.inscription"]).toStrictEqual({
      maximum: 5,
      fenetreSecondes: UNE_HEURE,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.renvoi_verification"]).toStrictEqual({
      maximum: 3,
      fenetreSecondes: UNE_HEURE,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.verification"]).toStrictEqual({
      maximum: 10,
      fenetreSecondes: 10 * 60,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.defaut"]).toStrictEqual({
      maximum: 30,
      fenetreSecondes: 60,
      par: "adresse_ip",
    });
    expect(LIMITES["email.compte"]).toStrictEqual({
      maximum: 100,
      fenetreSecondes: UN_JOUR,
      par: "application",
    });
  });

  test("les emails de compte ne prennent jamais plus de la moitié des envois de l'application", () => {
    expect(2 * LIMITES["email.compte"].maximum).toBeLessThanOrEqual(
      LIMITES["email.application"].maximum,
    );
  });

  test("deux limites auth.* n'ont jamais la même règle (le stockage les distingue par leur règle)", () => {
    const regles = Object.entries(LIMITES)
      .filter(([nom]) => nom.startsWith("auth."))
      .map(([, limite]) => `${limite.fenetreSecondes}/${limite.maximum}`);
    expect(new Set(regles).size).toBe(regles.length);
  });

  test("VALEUR_APPLICATION : valeur fixe des limites par application", () => {
    expect(VALEUR_APPLICATION).toBe("gmail");
  });
});

// Fonctionnalité 1.2. Fiche : docs/features/connexion.md, section 3,
// décision par défaut 4, test 11.
describe("limites de la connexion (1.2)", () => {
  const QUINZE_MINUTES = 15 * 60;

  test("valeurs retenues", () => {
    expect(LIMITES["auth.connexion"]).toStrictEqual({
      maximum: 10,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.connexion_compte"]).toStrictEqual({
      maximum: 5,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_email",
    });
    expect(LIMITES["auth.deconnexion"]).toStrictEqual({
      maximum: 20,
      fenetreSecondes: 60,
      par: "adresse_ip",
    });
  });

  test("la limite par compte est plus stricte que la limite par adresse IP (T-01)", () => {
    expect(LIMITES["auth.connexion_compte"].maximum).toBeLessThan(
      LIMITES["auth.connexion"].maximum,
    );
  });
});

// Fonctionnalité 1.3. Fiche : docs/features/mot-de-passe.md, sections 5 et
// 6.4, décisions par défaut 7 et 9, test 16.
describe("limites de la réinitialisation (1.3)", () => {
  test("valeurs retenues", () => {
    expect(LIMITES["auth.reinitialisation_demande"]).toStrictEqual({
      maximum: 4,
      fenetreSecondes: UNE_HEURE,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.reinitialisation_compte"]).toStrictEqual({
      maximum: 2,
      fenetreSecondes: UNE_HEURE,
      par: "adresse_email",
    });
    expect(LIMITES["auth.reinitialisation"]).toStrictEqual({
      maximum: 6,
      fenetreSecondes: 15 * 60,
      par: "adresse_ip",
    });
    expect(LIMITES["email.reinitialisation"]).toStrictEqual({
      maximum: 50,
      fenetreSecondes: UN_JOUR,
      par: "application",
    });
  });

  test("les deux budgets de compte restent sous celui de l'application (RR-13)", () => {
    expect(
      LIMITES["email.compte"].maximum + LIMITES["email.reinitialisation"].maximum,
    ).toBeLessThanOrEqual(LIMITES["email.application"].maximum);
  });

  test("la limite par adresse email est plus stricte que la limite par adresse IP", () => {
    expect(LIMITES["auth.reinitialisation_compte"].maximum).toBeLessThan(
      LIMITES["auth.reinitialisation_demande"].maximum,
    );
  });

  test("deux demandes, puis une notification : sous la limite par heure d'un destinataire", () => {
    expect(LIMITES["auth.reinitialisation_compte"].maximum + 1).toBeLessThanOrEqual(
      LIMITES["email.destinataire"].maximum,
    );
  });
});

// Fonctionnalité 1.4. Fiche : docs/features/double-authentification.md,
// sections 6 et 10, décisions 3 et 4, test 10.
describe("limites de la double authentification (1.4)", () => {
  const QUINZE_MINUTES = 15 * 60;

  test("valeurs retenues : par adresse IP sur chaque chemin interne", () => {
    expect(LIMITES["auth.double_auth_code"]).toStrictEqual({
      maximum: 12,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.double_auth_secours"]).toStrictEqual({
      maximum: 8,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.double_auth_activation"]).toStrictEqual({
      maximum: 6,
      fenetreSecondes: UNE_HEURE,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.double_auth_codes"]).toStrictEqual({
      maximum: 3,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_ip",
    });
    expect(LIMITES["auth.double_auth_desactivation"]).toStrictEqual({
      maximum: 4,
      fenetreSecondes: QUINZE_MINUTES,
      par: "adresse_ip",
    });
  });

  test("décision 3 : 20 codes par 24 heures et par compte ; 10 opérations de gestion par heure", () => {
    expect(LIMITES["auth.double_auth_compte"]).toStrictEqual({
      maximum: 20,
      fenetreSecondes: UN_JOUR,
      par: "utilisateur",
    });
    expect(LIMITES["auth.double_auth_gestion"]).toStrictEqual({
      maximum: 10,
      fenetreSecondes: UNE_HEURE,
      par: "utilisateur",
    });
  });

  test("budget d'emails propre, et les trois budgets de compte sous celui de l'application", () => {
    expect(LIMITES["email.double_auth"]).toStrictEqual({
      maximum: 40,
      fenetreSecondes: UN_JOUR,
      par: "application",
    });
    expect(
      LIMITES["email.compte"].maximum +
        LIMITES["email.reinitialisation"].maximum +
        LIMITES["email.double_auth"].maximum,
    ).toBeLessThanOrEqual(LIMITES["email.application"].maximum);
  });

  test("pas de compteur de rejeu : l'anti-rejeu tient la dernière tranche acceptée (décision 4)", () => {
    expect(Object.keys(LIMITES).filter((nom) => nom.includes("rejeu"))).toEqual([]);
  });
});

// Fonctionnalité 1.5 : profil et sessions. Par utilisateur dans notre
// passerelle (opérations du profil, essais du mot de passe actuel), par
// adresse IP dans Better Auth (chemin interne /change-password). Fiche :
// docs/features/profil-sessions.md, section 6, test 6.
describe("limites du profil et des sessions (1.5)", () => {
  test("30 opérations du profil par heure et par utilisateur", () => {
    expect(LIMITES["auth.profil_compte"]).toStrictEqual({
      maximum: 30,
      fenetreSecondes: UNE_HEURE,
      par: "utilisateur",
    });
  });

  test("8 essais du mot de passe actuel par 24 heures et par utilisateur", () => {
    expect(LIMITES["auth.mot_de_passe_compte"]).toStrictEqual({
      maximum: 8,
      fenetreSecondes: UN_JOUR,
      par: "utilisateur",
    });
  });

  test("4 changements du mot de passe par 10 minutes et par adresse IP", () => {
    expect(LIMITES["auth.changement_mot_de_passe"]).toStrictEqual({
      maximum: 4,
      fenetreSecondes: 10 * 60,
      par: "adresse_ip",
    });
  });

  test("aucun budget d'emails nouveau : la notification part sur email.reinitialisation", () => {
    expect(
      Object.keys(LIMITES)
        .filter((nom) => nom.startsWith("email."))
        .sort(),
    ).toEqual([
      "email.application",
      "email.compte",
      "email.destinataire",
      "email.destinataire_jour",
      "email.double_auth",
      "email.organisation",
      "email.reinitialisation",
    ]);
  });
});
