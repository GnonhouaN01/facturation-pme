import "server-only";

import { createServer, type Socket } from "node:net";

// Serveur SMTP factice des tests de smtp.ts : node:net, 127.0.0.1, port
// choisi par le système (jamais 25, 465, 587 ni 2525 : la garde réseau les
// refuse), sans TLS. Il garde les octets reçus, pour vérifier ce qui part
// vraiment sur le fil. Fiche : docs/features/envoi-emails.md, sections 3.2
// et 7, « Tests à écrire ».

export type OptionsServeurSmtp = {
  // Réponse à la fin de AUTH (défaut : acceptée).
  reponseAuth?: string;
  // Réponse à RCPT TO (défaut : acceptée).
  reponseRcpt?: string;
  // N'envoie jamais l'accueil 220 : le client doit abandonner sur délai.
  muet?: boolean;
};

export type ServeurSmtp = {
  port: number;
  // Tous les octets reçus, toutes connexions confondues, en latin1 (aucune
  // transformation des octets).
  recu: () => string;
  // Lignes de commande reçues hors DATA, sans le CRLF final.
  commandes: () => readonly string[];
  // Contenu de chaque DATA, sans la ligne finale « . ».
  messages: () => readonly string[];
  fermer: () => Promise<void>;
};

const ACCUEIL = "220 serveur.factice ESMTP\r\n";
const EHLO = "250-serveur.factice\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n";
const AUTH_OK = "235 2.7.0 Accepted";
const FIN_DATA = "\r\n.\r\n";

export async function demarrerServeurSmtp(options: OptionsServeurSmtp = {}): Promise<ServeurSmtp> {
  const octets: Buffer[] = [];
  const commandes: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();

  const serveur = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);

    let tampon = "";
    let etat: "commande" | "data" | "auth_login_utilisateur" | "auth_login_mot_de_passe" =
      "commande";

    const repondre = (ligne: string) => {
      if (!socket.destroyed) socket.write(ligne.endsWith("\r\n") ? ligne : `${ligne}\r\n`);
    };

    const traiter = (ligne: string) => {
      if (etat === "auth_login_utilisateur") {
        etat = "auth_login_mot_de_passe";
        repondre("334 UGFzc3dvcmQ6");
        return;
      }
      if (etat === "auth_login_mot_de_passe") {
        etat = "commande";
        repondre(options.reponseAuth ?? AUTH_OK);
        return;
      }
      commandes.push(ligne);
      const verbe = ligne.split(" ", 1)[0]?.toUpperCase() ?? "";
      switch (verbe) {
        case "EHLO":
          repondre(EHLO);
          return;
        case "HELO":
          repondre("250 serveur.factice");
          return;
        case "AUTH":
          if (/^AUTH LOGIN$/iu.test(ligne)) {
            etat = "auth_login_utilisateur";
            repondre("334 VXNlcm5hbWU6");
            return;
          }
          repondre(options.reponseAuth ?? AUTH_OK);
          return;
        case "MAIL":
          repondre("250 2.1.0 OK");
          return;
        case "RCPT":
          repondre(options.reponseRcpt ?? "250 2.1.5 OK");
          return;
        case "DATA":
          etat = "data";
          repondre("354 Go ahead");
          return;
        case "RSET":
        case "NOOP":
          repondre("250 OK");
          return;
        case "QUIT":
          repondre("221 2.0.0 Bye");
          socket.end();
          return;
        default:
          repondre("502 5.5.1 Unrecognized command");
      }
    };

    socket.on("data", (morceau: Buffer) => {
      octets.push(morceau);
      tampon += morceau.toString("latin1");
      for (;;) {
        if (etat === "data") {
          const fin = tampon.indexOf(FIN_DATA);
          if (fin === -1) return;
          messages.push(tampon.slice(0, fin));
          tampon = tampon.slice(fin + FIN_DATA.length);
          etat = "commande";
          repondre("250 2.0.0 OK queued");
          continue;
        }
        const fin = tampon.indexOf("\r\n");
        if (fin === -1) return;
        const ligne = tampon.slice(0, fin);
        tampon = tampon.slice(fin + 2);
        traiter(ligne);
      }
    });

    if (!options.muet) repondre(ACCUEIL);
  });

  await new Promise<void>((resoudre, rejeter) => {
    serveur.once("error", rejeter);
    serveur.listen(0, "127.0.0.1", () => resoudre());
  });
  const adresse = serveur.address();
  if (adresse === null || typeof adresse === "string") throw new Error("Adresse inattendue.");

  return {
    port: adresse.port,
    recu: () => Buffer.concat(octets).toString("latin1"),
    commandes: () => [...commandes],
    messages: () => [...messages],
    fermer: () =>
      new Promise<void>((resoudre) => {
        for (const socket of sockets) socket.destroy();
        serveur.close(() => resoudre());
      }),
  };
}
