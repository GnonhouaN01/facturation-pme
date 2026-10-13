import { connect } from "node:net";

// Dernière étape de « npm run verifier » : échoue si un serveur écoute encore
// sur le port 3000 (site construit) ou 3101 (serveur en panne des tests de
// bout en bout). Un serveur resté en vie fait échouer la suite suivante
// (reuseExistingServer à false) ; arrêter le processus lancé par npx peut
// laisser vivre le Node enfant (CLAUDE.md, « Pièges connus »).
// Une connexion acceptée, en IPv4 ou en IPv6, signifie « en écoute ».

const PORTS = [3000, 3101];
const HOTES = ["127.0.0.1", "::1"];
const DELAI = 1_000;

function enEcoute(hote, port) {
  return new Promise((resoudre) => {
    const socket = connect({ host: hote, port });
    const finir = (resultat) => {
      socket.destroy();
      resoudre(resultat);
    };
    socket.setTimeout(DELAI, () => finir(false));
    socket.once("connect", () => finir(true));
    socket.once("error", () => finir(false));
  });
}

const occupes = [];
for (const port of PORTS) {
  const resultats = await Promise.all(HOTES.map((hote) => enEcoute(hote, port)));
  if (resultats.some(Boolean)) occupes.push(port);
}

if (occupes.length > 0) {
  console.error(
    `Port(s) encore en écoute : ${occupes.join(", ")}. Arrêter le processus ` +
      "(netstat -ano | grep LISTENING, puis taskkill //PID <pid> //F après avoir lu sa ligne de commande).",
  );
  process.exit(1);
}
console.log(`Ports ${PORTS.join(" et ")} libres.`);
