import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ADRESSE_PANNE } from "./serveur-panne";

// Tâche quotidienne sur le site construit (T-45, S-02). Un appel sans le
// secret, avec un secret forgé ou mal formé, ou vers une tâche inconnue,
// reçoit la même réponse qu'une tâche inexistante : même statut, même corps,
// mêmes en-têtes au nonce de la politique près. L'appel autorisé purge la
// base de test (l'effet voulu de la tâche). Le secret est tiré au hasard par
// playwright.config.ts à chaque exécution. Fiche :
// docs/features/tache-quotidienne.md, sections 2.1 et 6, test 9.

const ADRESSE = "http://localhost:3000";

function secret(): string {
  const valeur = process.env.CRON_SECRET_E2E;
  if (!valeur) throw new Error("CRON_SECRET_E2E absent : playwright.config.ts doit le poser.");
  return valeur;
}

type Forme = { statut: number; corps: string; entetes: [string, string][] };

// En-têtes comparés : tous, sauf la politique (nonce neuf à chaque requête)
// et la date.
const VARIABLES = new Set(["content-security-policy", "date"]);

async function lire(
  origine: string,
  chemin: string,
  options: { methode?: string; autorisation?: string } = {},
): Promise<Forme> {
  const reponse = await fetch(origine + chemin, {
    method: options.methode ?? "GET",
    redirect: "manual",
    headers: options.autorisation === undefined ? {} : { authorization: options.autorisation },
  });
  return {
    statut: reponse.status,
    corps: await reponse.text(),
    entetes: [...reponse.headers.entries()]
      .filter(([nom]) => !VARIABLES.has(nom))
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}

function inconnue(): string {
  return `/api/taches/${randomBytes(8).toString("hex")}`;
}

test.describe("tâche quotidienne : refus indiscernable d'une tâche inexistante", () => {
  const forge = () => `Bearer ${randomBytes(32).toString("base64url")}`;
  const REFUS: [string, string, { autorisation?: string }][] = [
    ["sans Authorization", "/api/taches/quotidienne", {}],
    ["secret forgé", "/api/taches/quotidienne", { autorisation: forge() }],
    ["Bearer et une espace", "/api/taches/quotidienne", { autorisation: "Bearer " }],
    ["bearer en minuscules", "/api/taches/quotidienne", { autorisation: "bearer <secret>" }],
    ["espace en trop", "/api/taches/quotidienne", { autorisation: "Bearer  <secret>" }],
    ["secret seul", "/api/taches/quotidienne", { autorisation: "<secret>" }],
    ["secret dans la requête", "/api/taches/quotidienne?secret=<secret>", {}],
    ["secret juste, tâche inconnue", inconnue(), { autorisation: "Bearer <secret>" }],
    ["secret juste, QUOTIDIENNE", "/api/taches/QUOTIDIENNE", { autorisation: "Bearer <secret>" }],
  ];

  for (const [nom, chemin, options] of REFUS) {
    test(`${nom} : même réponse qu'une tâche inexistante`, async () => {
      const remplacer = (texte: string) => texte.replaceAll("<secret>", secret());
      const reference = await lire(ADRESSE, inconnue());

      const recue = await lire(ADRESSE, remplacer(chemin), {
        ...(options.autorisation === undefined
          ? {}
          : { autorisation: remplacer(options.autorisation) }),
      });

      expect(recue).toEqual(reference);
      expect(reference.statut).toBe(404);
      expect(reference.corps).toBe("");
    });
  }

  for (const methode of ["POST", "PUT", "DELETE", "PATCH"]) {
    test(`${methode} : même réponse pour quotidienne et pour une tâche inconnue`, async () => {
      const autorisation = `Bearer ${secret()}`;

      const connue = await lire(ADRESSE, "/api/taches/quotidienne", { methode, autorisation });
      const autre = await lire(ADRESSE, inconnue(), { methode, autorisation });

      expect(connue).toEqual(autre);
      expect(connue.statut).not.toBe(200);
    });
  }

  test("appel autorisé : 200 {ok:true}, no-store", async () => {
    const reponse = await fetch(`${ADRESSE}/api/taches/quotidienne`, {
      redirect: "manual",
      headers: { authorization: `Bearer ${secret()}` },
    });

    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe('{"ok":true}');
    expect(reponse.headers.get("cache-control")).toBe("no-store");
  });

  test("serveur sans CRON_SECRET (port 3101) : le secret du port 3000 y est refusé", async () => {
    const reference = await lire(ADRESSE_PANNE, inconnue());

    const recue = await lire(ADRESSE_PANNE, "/api/taches/quotidienne", {
      autorisation: `Bearer ${secret()}`,
    });

    expect(recue).toEqual(reference);
    expect(recue.statut).toBe(404);
  });
});
