import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  adresseBase,
  argumentsRun,
  ETIQUETTE,
  executer,
  IMAGE,
  lirePort,
} from "../scripts/e2e-base-jetable.mjs";

// Base jetable des tests de bout en bout, sans Docker ni serveur : la
// commande docker, les processus lancés et l'attente de la base sont
// remplacés par des faux. Décisions du développeur du 2026-10-14 : port sur
// 127.0.0.1 seulement, conteneur supprimé dans tous les cas, refus d'un hôte
// distant, refus si VERCEL_ENV est défini, aucune lecture de .env.local.
// Fiche : docs/features/e2e-base-jetable.md, « Tests à écrire ».

type Env = Record<string, string | undefined>;
type Lancement = { quoi: string; args: string[]; env: Env; arrete: boolean };

function nature(args: readonly string[]): string {
  const premier = (args[0] ?? "").replaceAll("\\", "/");
  if (premier.endsWith("scripts/preparer-base-test.mjs")) return "preparation";
  if (premier.endsWith("drizzle-kit/bin.cjs")) return "migrations";
  if (premier.endsWith("@playwright/test/cli.js")) return "playwright";
  return `inconnu:${premier}`;
}

function faux(
  options: {
    info?: number;
    restes?: string;
    run?: number;
    port?: string;
    rm?: number;
    baseJamaisPrete?: boolean;
    codes?: Partial<Record<"preparation" | "migrations" | "playwright", number>>;
    signalPendantPlaywright?: "SIGINT" | "SIGTERM" | "SIGHUP";
    // Simule une évolution fautive du script : environnement transmis à
    // drizzle-kit modifié juste avant son lancement.
    envMigrations?: (env: Env) => Env;
  } = {},
) {
  const docker: { args: string[]; env: Env }[] = [];
  const lancements: Lancement[] = [];
  const attentes: string[] = [];
  const messages: string[] = [];
  const signaux = new EventEmitter();

  const outils = {
    commande: async (programme: string, args: string[], { env }: { env: Env }) => {
      expect(programme).toBe("docker");
      docker.push({ args, env });
      switch (args[0]) {
        case "info":
          return { code: options.info ?? 0, sortie: "29.6.2\n" };
        case "ps":
          return { code: 0, sortie: options.restes ?? "" };
        case "run":
          return { code: options.run ?? 0, sortie: "0123456789ab\n" };
        case "port":
          return { code: 0, sortie: options.port ?? "127.0.0.1:35059\n" };
        case "rm":
          return { code: options.rm ?? 0, sortie: "" };
        default:
          throw new Error(`commande docker inattendue : ${args.join(" ")}`);
      }
    },
    lancer: (_programme: string, args: string[], { env }: { env: Env }) => {
      const lancement: Lancement = { quoi: nature(args), args, env, arrete: false };
      lancements.push(lancement);
      const code = options.codes?.[lancement.quoi as "preparation"] ?? 0;
      if (lancement.quoi === "playwright" && options.signalPendantPlaywright) {
        let terminer: (code: number) => void = () => {};
        const fin = new Promise<number>((resoudre) => (terminer = resoudre));
        setImmediate(() => signaux.emit(options.signalPendantPlaywright as string));
        return {
          fin,
          arreter: () => {
            lancement.arrete = true;
            terminer(1);
          },
        };
      }
      return { fin: Promise.resolve(code), arreter: () => (lancement.arrete = true) };
    },
    attendreBase: async (adresse: string) => {
      attentes.push(adresse);
      if (options.baseJamaisPrete) throw new Error("base injoignable après 60 s");
    },
    signaux,
    ecrire: (texte: string) => messages.push(texte),
    maintenant: () => 0,
    delaiArret: 0,
    ...(options.envMigrations ? { envMigrations: options.envMigrations } : {}),
  };

  const nom = () => {
    const run = docker.find((c) => c.args[0] === "run");
    const i = run ? run.args.indexOf("--name") : -1;
    return run && i >= 0 ? run.args[i + 1] : undefined;
  };

  return { outils, docker, lancements, attentes, messages, signaux, nom };
}

function lancerJetable(f: ReturnType<typeof faux>, env: Env = {}, args: string[] = []) {
  return executer({ env, arguments: args, outils: f.outils });
}

function verifierSuppression(f: ReturnType<typeof faux>) {
  const nom = f.nom();
  expect(nom).toMatch(/^facturation-pme-e2e-[0-9a-f]+$/);
  const suppressions = f.docker.filter((c) => c.args[0] === "rm" && c.args.includes(nom!));
  expect(suppressions).toHaveLength(1);
  expect(f.docker.at(-1)?.args).toEqual(["rm", "-f", "-v", nom]);
}

test.describe("base jetable des tests de bout en bout", () => {
  test("1. le port n'est publié que sur 127.0.0.1, numéro choisi par Docker", async () => {
    const args = argumentsRun("facturation-pme-e2e-0a1b2c");
    const publications = args.flatMap((a: string, i: number) =>
      a === "--publish" || a === "-p" ? [args[i + 1]] : [],
    );
    expect(publications).toEqual(["127.0.0.1::5432"]);
    expect(args.some((a: string) => a.startsWith("--publish=") || a === "-P")).toBe(false);
    expect(args.at(-1)).toBe(IMAGE);
    expect(IMAGE).toMatch(/^postgres:18@sha256:[0-9a-f]{64}$/);
    expect(args).toContain(`${ETIQUETTE}=1`);
    expect(args.join(" ")).toContain("--tmpfs /var/lib/postgresql");

    expect(lirePort("127.0.0.1:35059\n")).toBe(35059);
    for (const sortie of [
      "0.0.0.0:35059\n",
      "[::]:35059\n",
      "localhost:35059\n",
      "192.168.1.10:35059\n",
      "127.0.0.1:35059\n[::1]:35059\n",
      "127.0.0.1:0\n",
      "127.0.0.1:\n",
      "",
    ]) {
      expect(() => lirePort(sortie), sortie).toThrow();
    }
  });

  test("1. un port publié hors de 127.0.0.1 est refusé, conteneur supprimé, Playwright jamais lancé", async () => {
    for (const port of ["0.0.0.0:35059\n", "[::]:35059\n", "127.0.0.1:35059\n0.0.0.0:35059\n"]) {
      const f = faux({ port });
      expect(await lancerJetable(f)).toBe(1);
      expect(f.lancements).toEqual([]);
      expect(f.attentes).toEqual([]);
      verifierSuppression(f);
    }
  });

  test("2. le conteneur est supprimé après un succès, et le code de Playwright est rendu", async () => {
    const f = faux();
    expect(await lancerJetable(f)).toBe(0);
    expect(f.lancements.map((l) => l.quoi)).toEqual(["preparation", "migrations", "playwright"]);
    verifierSuppression(f);
  });

  test("2. le conteneur est supprimé même en cas d'échec, à chaque étape", async () => {
    const cas = [
      { options: { codes: { playwright: 1 } }, code: 1, lances: 3 },
      { options: { codes: { playwright: 7 } }, code: 7, lances: 3 },
      { options: { codes: { migrations: 1 } }, code: 1, lances: 2 },
      { options: { codes: { preparation: 1 } }, code: 1, lances: 1 },
      { options: { baseJamaisPrete: true }, code: 1, lances: 0 },
      { options: { run: 125 }, code: 1, lances: 0 },
    ];
    for (const { options, code, lances } of cas) {
      const f = faux(options);
      expect(await lancerJetable(f), JSON.stringify(options)).toBe(code);
      expect(f.lancements, JSON.stringify(options)).toHaveLength(lances);
      verifierSuppression(f);
    }
  });

  test("2. un signal pendant Playwright l'arrête, supprime le conteneur et rend 130", async () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const f = faux({ signalPendantPlaywright: signal });
      expect(await lancerJetable(f)).toBe(130);
      expect(f.lancements.at(-1)).toMatchObject({ quoi: "playwright", arrete: true });
      verifierSuppression(f);
      // Écouteurs retirés : le processus peut se terminer.
      expect(f.signaux.listenerCount(signal)).toBe(0);
    }
  });

  test("2. un conteneur impossible à supprimer fait échouer l'exécution, commande indiquée", async () => {
    const f = faux({ rm: 1 });
    expect(await lancerJetable(f)).toBe(1);
    expect(f.messages.join("\n")).toContain(`docker rm -f -v ${f.nom()}`);
  });

  test("2. les restes étiquetés d'une exécution tuée sont supprimés avant le run", async () => {
    const f = faux({ restes: "aaa111aaa111\nbbb222bbb222\nnon-hexadecimal\n" });
    expect(await lancerJetable(f)).toBe(0);
    const commandes = f.docker.map((c) => c.args);
    expect(commandes.slice(0, 4)).toEqual([
      ["info", "--format", "{{.ServerVersion}}"],
      ["ps", "-aq", "--filter", `label=${ETIQUETTE}`],
      ["rm", "-f", "-v", "aaa111aaa111", "bbb222bbb222"],
      expect.arrayContaining(["run"]),
    ]);
  });

  test("3. une adresse de base hors de 127.0.0.1 est refusée", async () => {
    const base = { utilisateur: "app_facturation", motDePasse: "abc", port: 35059 };
    expect(adresseBase({ ...base, hote: "127.0.0.1" })).toBe(
      "postgresql://app_facturation:abc@127.0.0.1:35059/facturation_test",
    );
    for (const hote of ["ep-exemple.eu-central-1.aws.neon.tech", "localhost", "0.0.0.0", "::1"]) {
      expect(() => adresseBase({ ...base, hote }), hote).toThrow();
    }
  });

  test("3. les adresses transmises visent le conteneur ; DATABASE_URL_MIGRATION jamais à Playwright", async () => {
    const f = faux();
    const env = {
      DATABASE_URL: "postgresql://app_facturation:x@ep-exemple.neon.tech/neondb",
      DATABASE_URL_MIGRATION: "postgresql://proprietaire:x@ep-exemple.neon.tech/neondb",
      PATH: "/usr/bin",
    };
    expect(await lancerJetable(f, env)).toBe(0);

    const run = f.docker.find((c) => c.args[0] === "run")!;
    const motDePasse = run.env.POSTGRES_PASSWORD!;
    expect(motDePasse).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(run.args.join(" ")).not.toContain(motDePasse);
    expect(run.args).toContain("POSTGRES_PASSWORD");

    for (const quoi of ["preparation", "migrations"]) {
      const l = f.lancements.find((x) => x.quoi === quoi)!;
      expect(new URL(l.env.DATABASE_URL_MIGRATION!).host).toBe("127.0.0.1:35059");
      expect(new URL(l.env.DATABASE_URL_MIGRATION!).username).toBe("postgres");
      expect(new URL(l.env.DATABASE_URL!).host).toBe("127.0.0.1:35059");
      expect(new URL(l.env.DATABASE_URL!).username).toBe("app_facturation");
    }
    const playwright = f.lancements.find((x) => x.quoi === "playwright")!;
    expect("DATABASE_URL_MIGRATION" in playwright.env).toBe(false);
    expect(new URL(playwright.env.DATABASE_URL!).host).toBe("127.0.0.1:35059");
    expect(playwright.env.PATH).toBe("/usr/bin");
    expect(f.attentes.every((a) => new URL(a).hostname === "127.0.0.1")).toBe(true);

    // Aucun mot de passe affiché.
    const application = decodeURIComponent(new URL(playwright.env.DATABASE_URL!).password);
    for (const secret of [motDePasse, application]) {
      expect(f.messages.join("\n")).not.toContain(secret);
    }
  });

  test("4. refus si VERCEL_ENV est défini, dans les trois modes, avant toute commande", async () => {
    for (const valeur of ["production", "preview", "development", ""]) {
      for (const mode of [{}, { CI: "true" }, { E2E_BASE: "dev" }]) {
        const f = faux();
        expect(await lancerJetable(f, { ...mode, VERCEL_ENV: valeur })).toBe(1);
        expect(f.docker).toEqual([]);
        expect(f.lancements).toEqual([]);
        expect(f.messages.join("\n")).toContain("VERCEL_ENV");
      }
    }
  });

  test("5. le script ne lit pas .env.local : ni le nom du fichier, ni dotenv, ni node:fs", async () => {
    const source = readFileSync("scripts/e2e-base-jetable.mjs", "utf8");
    expect(source).not.toContain(".env.local");
    expect(source).not.toMatch(/env\.local/);
    expect(source).not.toContain("dotenv");
    expect(source).not.toMatch(/["'](node:)?fs(\/promises)?["']/);
  });

  test("6. Docker arrêté : message clair, aucun conteneur, code 1", async () => {
    const f = faux({ info: 1 });
    expect(await lancerJetable(f)).toBe(1);
    expect(f.docker.map((c) => c.args[0])).toEqual(["info"]);
    expect(f.lancements).toEqual([]);
    const message = f.messages.join("\n");
    expect(message).toContain("Docker");
    expect(message).toContain("E2E_BASE=dev npm run test:e2e");
  });

  test("6. E2E_BASE inconnue refusée ; CI et E2E_BASE=dev lancent Playwright sans Docker", async () => {
    const inconnue = faux();
    expect(await lancerJetable(inconnue, { E2E_BASE: "Dev" })).toBe(1);
    expect(inconnue.docker).toEqual([]);
    expect(inconnue.lancements).toEqual([]);

    for (const env of [{ CI: "true" }, { E2E_BASE: "dev" }]) {
      const f = faux({ codes: { playwright: 3 } });
      expect(await lancerJetable(f, env, ["e2e/accueil.spec.ts", "--headed"])).toBe(3);
      expect(f.docker).toEqual([]);
      expect(f.lancements).toHaveLength(1);
      expect(f.lancements[0]!.quoi).toBe("playwright");
      expect(f.lancements[0]!.args.slice(1)).toEqual(["test", "e2e/accueil.spec.ts", "--headed"]);
      expect(f.lancements[0]!.env).toEqual(env);
    }
  });

  test("7. verrou : DATABASE_URL_MIGRATION absente de l'environnement transmis, drizzle-kit jamais lancé", async () => {
    const retraits: ((env: Env) => Env)[] = [
      (env) => {
        const copie = { ...env };
        delete copie.DATABASE_URL_MIGRATION;
        return copie;
      },
      (env) => ({ ...env, DATABASE_URL_MIGRATION: "" }),
      (env) => ({ ...env, DATABASE_URL_MIGRATION: undefined }),
      (env) => ({ ...env, DATABASE_URL_MIGRATION: "pas une adresse" }),
    ];
    for (const envMigrations of retraits) {
      const f = faux({ envMigrations });
      expect(await lancerJetable(f)).toBe(1);
      expect(f.lancements.map((l) => l.quoi)).toEqual(["preparation"]);
      verifierSuppression(f);
      expect(f.messages.join("\n")).toContain("DATABASE_URL_MIGRATION");
    }
  });

  test("7. verrou : DATABASE_URL_MIGRATION vers un autre hôte ou un autre port, drizzle-kit jamais lancé", async () => {
    const adresses = [
      "postgresql://neondb_owner:secret-reel@ep-exemple.eu-central-1.aws.neon.tech/neondb",
      "postgresql://postgres:secret-reel@localhost:35059/facturation_test",
      "postgresql://postgres:secret-reel@0.0.0.0:35059/facturation_test",
      "postgresql://postgres:secret-reel@[::1]:35059/facturation_test",
      "postgresql://postgres:secret-reel@127.0.0.1:5432/facturation_test",
      "postgresql://postgres:secret-reel@127.0.0.1/facturation_test",
      "postgresql://postgres:secret-reel@127.0.0.1.exemple.com:35059/facturation_test",
    ];
    for (const adresse of adresses) {
      const f = faux({ envMigrations: (env) => ({ ...env, DATABASE_URL_MIGRATION: adresse }) });
      expect(await lancerJetable(f), adresse).toBe(1);
      expect(
        f.lancements.map((l) => l.quoi),
        adresse,
      ).toEqual(["preparation"]);
      verifierSuppression(f);
      const messages = f.messages.join("\n");
      expect(messages).toContain("DATABASE_URL_MIGRATION");
      // Ni le mot de passe ni l'adresse refusée ne sont affichés.
      expect(messages).not.toContain("secret-reel");
    }
  });

  test("6. mode jetable : les arguments suivent jusqu'à Playwright", async () => {
    const f = faux();
    expect(await lancerJetable(f, {}, ["e2e/inscription.spec.ts"])).toBe(0);
    expect(f.lancements.at(-1)!.args.slice(1)).toEqual(["test", "e2e/inscription.spec.ts"]);
  });
});
