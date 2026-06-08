import { loadMemorySearchConfig } from "@sivraj/config";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { handleMemorySearchRequest } from "./memory-search-handler.js";

export function createMemoryRoutes({
  db,
  privateMemoryReader,
  memorySearchConfig = loadMemorySearchConfig(process.env),
}: AppDependencies) {
  const memoryRoutes = new Hono<AuthEnv>();

  memoryRoutes.post("/search", requireAuth, (c) => handleMemorySearchRequest(c, {
    db,
    privateMemoryReader,
    memorySearchConfig,
  }));

  return memoryRoutes;
}
