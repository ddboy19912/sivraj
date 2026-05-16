/// <reference types="node" />

import { resolveDatabaseUrl, type EnvSource } from "@sivraj/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(process.env as EnvSource),
  },
});
