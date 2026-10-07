import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";

import { db } from "../db/client";
import * as schema from "../db/schema/auth";

export const auth = betterAuth({
  appName: "Facturation PME",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  plugins: [twoFactor(), organization(), nextCookies()],
});
