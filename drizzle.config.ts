import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_MIGRATION;
if (!url) {
  throw new Error("DATABASE_URL_MIGRATION est absente de .env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
