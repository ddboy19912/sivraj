import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  handleConversationMemoriesReviewPost,
  handleConversationReviewGet,
  handleConversationSummaryPost,
} from "./conversation-handlers.js";

export function createConversationRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/:artifactId/review", requireAuth, (c) => handleConversationReviewGet(c, { db }));
  routes.post("/:artifactId/summary", requireAuth, (c) => handleConversationSummaryPost(c, { db, privateMemoryStorage }));
  routes.post("/:artifactId/memories/review", requireAuth, (c) => handleConversationMemoriesReviewPost(c, {
    db,
    privateMemoryStorage,
    artifactProcessingQueue,
  }));

  return routes;
}
