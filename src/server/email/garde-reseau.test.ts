import { createServer, type AddressInfo, type Socket } from "node:net";
import * as net from "node:net";
import * as tls from "node:tls";

import { describe, expect, onTestFinished, test } from "vitest";

// Garde réseau du projet unitaires : aucune connexion vers un port de
// messagerie, quel que soit l'hôte. Posée par tests/garde-reseau.ts, fichier
// de préparation (setupFiles) des deux projets de vitest.config.mts. Ce test
// vérifie la garde là où elle s'applique, donc aussi son branchement.
// Fiche : docs/features/envoi-emails.md, section 2.3, barrière 3.

const PORTS_MESSAGERIE = [25, 465, 587, 2525];
// Aucun de ces hôtes ne peut joindre un vrai serveur : .invalid n'existe pas.
const HOTES = ["127.0.0.1", "smtp.exemple.invalid"];

// Renvoie l'erreur levée à l'appel, ou null. Un socket obtenu est détruit
// aussitôt, ses erreurs ignorées : sans garde, le test échoue sans attendre.
function essayer(ouvrir: () => Socket): unknown {
  try {
    const socket = ouvrir();
    socket.on("error", () => undefined);
    socket.destroy();
    return null;
  } catch (erreur) {
    return erreur;
  }
}

describe("garde réseau : ports de messagerie refusés", () => {
  for (const port of PORTS_MESSAGERIE) {
    for (const host of HOTES) {
      test(`net.connect({ host: ${host}, port: ${port} }) lève`, () => {
        expect(essayer(() => net.connect({ host, port }))).toBeInstanceOf(Error);
      });

      test(`net.connect(${port}, ${host}) lève`, () => {
        expect(essayer(() => net.connect(port, host))).toBeInstanceOf(Error);
      });

      test(`net.createConnection({ host: ${host}, port: ${port} }) lève`, () => {
        expect(essayer(() => net.createConnection({ host, port }))).toBeInstanceOf(Error);
      });

      test(`tls.connect({ host: ${host}, port: ${port} }) lève`, () => {
        expect(essayer(() => tls.connect({ host, port }))).toBeInstanceOf(Error);
      });
    }
  }

  test("port donné en chaîne : refusé aussi", () => {
    expect(
      essayer(() => net.connect({ host: "127.0.0.1", port: "465" as unknown as number })),
    ).toBeInstanceOf(Error);
  });
});

describe("garde réseau : le reste passe (témoins)", () => {
  test("127.0.0.1 sur un port libre choisi par le système : connexion établie", async () => {
    const serveur = createServer((socket) => socket.end());
    await new Promise<void>((resoudre) => serveur.listen(0, "127.0.0.1", resoudre));
    onTestFinished(() => new Promise<void>((resoudre) => serveur.close(() => resoudre())));
    const { port } = serveur.address() as AddressInfo;

    const connecte = await new Promise<boolean>((resoudre) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.on("connect", () => {
        socket.destroy();
        resoudre(true);
      });
      socket.on("error", () => resoudre(false));
    });

    expect(connecte).toBe(true);
  });
});
