import * as net from "node:net";
import * as tls from "node:tls";

import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { db } from "./client";

// Garde réseau du projet integration : mêmes ports refusés que dans le projet
// unitaires, et la base reste joignable. Fiche :
// docs/features/envoi-emails.md, section 2.3, barrière 3.

const PORTS_MESSAGERIE = [25, 465, 587, 2525];

function essayer(ouvrir: () => net.Socket): unknown {
  try {
    const socket = ouvrir();
    socket.on("error", () => undefined);
    socket.destroy();
    return null;
  } catch (erreur) {
    return erreur;
  }
}

describe("garde réseau, projet integration", () => {
  test.each(PORTS_MESSAGERIE)("port %i : net.connect et tls.connect lèvent", (port) => {
    expect(essayer(() => net.connect({ host: "127.0.0.1", port }))).toBeInstanceOf(Error);
    expect(essayer(() => tls.connect({ host: "smtp.exemple.invalid", port }))).toBeInstanceOf(
      Error,
    );
  });

  test("témoin : la base répond toujours", async () => {
    const resultat = await db.execute(sql`select 1 as un`);
    expect(resultat.rows).toEqual([{ un: 1 }]);
  });
});
