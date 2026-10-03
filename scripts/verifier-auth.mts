import { config } from "dotenv";

config({ path: ".env.local" });

const { auth } = await import("../src/lib/auth");
const contexte = await auth.$context;
const nombre = await contexte.adapter.count({ model: "user" });

console.log(`Better Auth lit la table user : ${nombre} utilisateur(s).`);
process.exit(0);
