import { format } from "node:util";

import { afterEach, expect, test, vi } from "vitest";

import { register } from "./instrumentation";

// register pose le filtre de la console (T-39) avant de charger la
// configuration. Fiche : docs/features/socle-interface.md, section 4.4.
vi.mock("./server/env", () => ({ env: {} }));

const JETON = "jeton-de-session-Zx81QaP0";

afterEach(() => {
  vi.restoreAllMocks();
});

test("après register, une erreur de Drizzle écrite à la console ne montre ni la requête ni ses paramètres", async () => {
  const sortie: string[] = [];
  for (const methode of [
    "error",
    "warn",
    "log",
    "info",
    "debug",
    "trace",
    "dir",
    "table",
  ] as const) {
    vi.spyOn(console, methode).mockImplementation((...args: unknown[]) => {
      sortie.push(format(...args));
    });
  }

  await register();
  console.error(
    new Error(`Failed query: select "token" from "session" where "id" = $1\nparams: ${JETON}`),
  );

  expect(sortie).toEqual(["[Error]"]);
});
