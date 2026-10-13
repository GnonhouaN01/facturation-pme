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
      // section 3.2).
      expect([
        "utilisateur",
        "application",
        "organisation",
        "destinataire",
        "adresse_ip",
      ]).toContain(limite.par);
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
