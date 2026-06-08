import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { twinScopedHandler } from "../lib/http/route-auth.js";
import {
  handleDeleteProviderConfig,
  handleGetProviderConfig,
  handlePutProviderConfig,
  handleTestProviderConfig,
} from "./chat-provider-config.js";
import {
  handleCreateThread,
  handleGetThreadMessages,
  handleListThreads,
  handlePostThreadMessage,
} from "./chat-message-handler.js";

export function createChatRoutes({
  db,
  privateMemoryReader,
  llmFetch,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/provider-config", requireAuth, (c) => handleGetProviderConfig(c, db));
  routes.put("/provider-config", requireAuth, (c) => handlePutProviderConfig(c, db));
  routes.post("/provider-config/test", requireAuth, (c) => handleTestProviderConfig(c, db, llmFetch));
  routes.delete("/provider-config", requireAuth, (c) => handleDeleteProviderConfig(c, db));

  routes.get("/threads", requireAuth, twinScopedHandler("memory:read", (c, { twinId }) =>
    handleListThreads(c, db, twinId),
  ));

  routes.post("/threads", requireAuth, twinScopedHandler("memory:read", (c, { twinId }) =>
    handleCreateThread(c, db, twinId),
  ));

  routes.get("/threads/:threadId/messages", requireAuth, (c) => handleGetThreadMessages(c, db));
  routes.post("/threads/:threadId/messages", requireAuth, (c) =>
    handlePostThreadMessage(c, db, privateMemoryReader, llmFetch),
  );

  return routes;
}
