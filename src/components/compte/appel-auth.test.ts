import { afterEach, describe, expect, test, vi } from "vitest";

import { appelerAuth } from "./appel-auth";

// Appel d'un point d'entrée ouvert de /api/auth depuis le navigateur : seules
// les réponses de la liste fermée sont reconnues ; l'identifiant d'incident
// n'est lu que s'il a la forme d'un UUID (S-85, dette de PLAN.md, section 7).
// fetch est remplacé : aucun réseau. Fiche : docs/features/connexion.md,
// section 6, test 14.

const INCIDENT = "6f1c3c1e-8a3d-4c5b-9f0e-2d7a1b4c5e6f";

function repondre(corps: unknown, statut = 200) {
  const appels: { url: string; options: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      appels.push({ url, options });
      return new Response(JSON.stringify(corps), { status: statut });
    }),
  );
  return appels;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appelerAuth (1.2)", () => {
  test("connexion et déconnexion : POST JSON vers /api/auth, même origine", async () => {
    const appels = repondre({ ok: true });
    expect(await appelerAuth("/sign-in/email", { email: "a@b.ci", motDePasse: "x" })).toEqual({
      ok: true,
    });
    expect(await appelerAuth("/sign-out", {})).toEqual({ ok: true });
    expect(appels.map(({ url }) => url)).toEqual(["/api/auth/sign-in/email", "/api/auth/sign-out"]);
    expect(appels[1]?.options?.method).toBe("POST");
    expect(appels[1]?.options?.body).toBe("{}");
    expect(appels[1]?.options?.credentials).toBe("same-origin");
  });

  test("identifiants_incorrects est une raison reconnue", async () => {
    repondre({ ok: false, raison: "identifiants_incorrects" }, 401);
    expect(await appelerAuth("/sign-in/email", {})).toEqual({
      ok: false,
      raison: "identifiants_incorrects",
    });
  });

  test("erreur avec un incident au format UUID : l'incident est gardé", async () => {
    repondre({ ok: false, raison: "erreur", incident: INCIDENT }, 500);
    expect(await appelerAuth("/sign-up/email", {})).toEqual({
      ok: false,
      raison: "erreur",
      incident: INCIDENT,
    });
  });

  test.each([
    ["texte libre", "<img src=x onerror=alert(1)>"],
    ["UUID en majuscules suivi d'un texte", `${INCIDENT} voir le journal`],
    ["nombre", 42],
    ["vide", ""],
  ])("incident hors format (%s) : ignoré", async (_nom, incident) => {
    repondre({ ok: false, raison: "erreur", incident }, 500);
    expect(await appelerAuth("/sign-up/email", {})).toEqual({ ok: false, raison: "erreur" });
  });

  test("incident sur une autre raison : ignoré", async () => {
    repondre({ ok: false, raison: "trop_de_requetes", incident: INCIDENT }, 429);
    expect(await appelerAuth("/sign-in/email", {})).toEqual({
      ok: false,
      raison: "trop_de_requetes",
    });
  });

  test("raison inconnue : erreur, sans incident", async () => {
    repondre({ ok: false, raison: "EMAIL_NOT_VERIFIED" }, 403);
    expect(await appelerAuth("/sign-in/email", {})).toEqual({ ok: false, raison: "erreur" });
  });

  test("réseau coupé : erreur, sans incident", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await appelerAuth("/sign-out", {})).toEqual({ ok: false, raison: "erreur" });
  });
});
