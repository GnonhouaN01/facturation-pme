import { describe, expect, test } from "vitest";

import { decrireAppareil, NAVIGATEURS, SYSTEMES } from "./appareil";

// Description de l'appareil d'une session (1.5) : deux valeurs de listes
// fermées, jamais le texte du navigateur déclaré, choisi par qui ouvre la
// session (T-34). Fiche : docs/features/profil-sessions.md, section 3.4,
// test 7.

const CAS: ReadonlyArray<[string, string, string]> = [
  [
    "Chrome sur Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Chrome sur Windows",
  ],
  [
    "Edge sur Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    "Edge sur Windows",
  ],
  [
    "Opera sur Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0",
    "Opera sur Windows",
  ],
  [
    "Firefox sur Linux",
    "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
    "Firefox sur Linux",
  ],
  [
    "Safari sur macOS",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    "Safari sur macOS",
  ],
  [
    "Safari sur iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    "Safari sur iOS",
  ],
  [
    "Safari sur iPad",
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    "Safari sur iOS",
  ],
  [
    "Chrome sur Android",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "Chrome sur Android",
  ],
  [
    "Samsung Internet sur Android",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    "Samsung Internet sur Android",
  ],
  [
    "Firefox sur Android",
    "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
    "Firefox sur Android",
  ],
  [
    "Chrome sur ChromeOS",
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Chrome sur ChromeOS",
  ],
  [
    "Chrome sur iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
    "Chrome sur iOS",
  ],
];

describe("decrireAppareil : navigateur et système, listes fermées", () => {
  test.each(CAS)("%s", (_nom, agent, attendu) => {
    expect(decrireAppareil(agent)).toBe(attendu);
  });

  test.each([
    ["chaîne vide", ""],
    ["absente", null],
    ["texte libre", "Support : appelez le 07 00 00 00 00"],
    ["balisage", "<img src=x onerror=alert(1)>"],
    ["outil en ligne de commande", "curl/8.10.1"],
  ] as const)("%s : navigateur et système inconnus", (_nom, agent) => {
    expect(decrireAppareil(agent)).toBe("Navigateur inconnu sur système inconnu");
  });

  test("la sortie n'est jamais qu'une combinaison des deux listes", () => {
    const admises = new Set(
      NAVIGATEURS.flatMap((navigateur) =>
        SYSTEMES.map((systeme) => `${navigateur} sur ${systeme}`),
      ),
    );
    const agents = [
      ...CAS.map(([, agent]) => agent),
      "Chrome/1 Windows Support : appelez le 07",
      "Firefox/1 (Android) <script>",
      "x".repeat(10_000),
    ];
    for (const agent of agents) expect(admises.has(decrireAppareil(agent)), agent).toBe(true);
  });

  test("les deux listes, valeurs inconnues comprises", () => {
    expect(NAVIGATEURS).toEqual([
      "Edge",
      "Opera",
      "Samsung Internet",
      "Firefox",
      "Chrome",
      "Safari",
      "Navigateur inconnu",
    ]);
    expect(SYSTEMES).toEqual([
      "Windows",
      "Android",
      "iOS",
      "macOS",
      "ChromeOS",
      "Linux",
      "système inconnu",
    ]);
  });
});
