import { Hono } from "hono";
import { loadMemorySearchConfig } from "@sivraj/config";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { twinScopedHandler } from "../lib/http/route-auth.js";
import {
  handleCreateOpenRouterModelConfig,
  handleDeleteProviderConfig,
  handleCompleteOpenRouterOAuth,
  handleGetProviderConfig,
  handleSelectFallbackProviderConfig,
  handleSelectProviderConfig,
  handleStartOpenRouterOAuth,
  handleUpdateProviderModel,
} from "./chat-provider-config.js";
import {
  handleCreateThread,
  handleDeleteThread,
  handleGetThreadMessages,
  handlePostThreadAttachment,
  handleListThreads,
  handlePostThreadMessage,
  handlePostThreadTurn,
} from "./chat-message-handler.js";

export function createChatRoutes({
  db,
  privateMemoryReader,
  privateMemoryStorage,
  artifactProcessingQueue,
  llmFetch,
  memorySearchConfig = loadMemorySearchConfig(process.env),
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/provider-config", requireAuth, (c) => handleGetProviderConfig(c, db));
  routes.post("/provider-config/openrouter/oauth/start", requireAuth, (c) =>
    handleStartOpenRouterOAuth(c),
  );
  routes.post("/provider-config/openrouter/oauth/callback", requireAuth, (c) =>
    handleCompleteOpenRouterOAuth(c, db, llmFetch),
  );
  routes.post("/provider-config/openrouter/models", requireAuth, (c) =>
    handleCreateOpenRouterModelConfig(c, db),
  );
  routes.put("/provider-config/default/select", requireAuth, (c) =>
    handleSelectFallbackProviderConfig(c, db),
  );
  routes.put("/provider-config/:providerConfigId/model", requireAuth, (c) =>
    handleUpdateProviderModel(c, db),
  );
  routes.put("/provider-config/:providerConfigId/select", requireAuth, (c) =>
    handleSelectProviderConfig(c, db),
  );
  routes.delete("/provider-config/:providerConfigId", requireAuth, (c) =>
    handleDeleteProviderConfig(c, db),
  );

  routes.get("/threads", requireAuth, twinScopedHandler("memory:read", (c, { twinId }) =>
    handleListThreads(c, db, twinId),
  ));

  routes.post("/threads", requireAuth, twinScopedHandler("memory:read", (c, { twinId }) =>
    handleCreateThread(c, db, twinId),
  ));

  routes.delete("/threads/:threadId", requireAuth, (c) => handleDeleteThread(c, db));
  routes.get("/threads/:threadId/messages", requireAuth, (c) => handleGetThreadMessages(c, db));
  routes.post("/threads/:threadId/attachments", requireAuth, (c) =>
    handlePostThreadAttachment(c, db),
  );
  routes.post("/threads/:threadId/messages", requireAuth, (c) =>
    handlePostThreadMessage(c, {
      db,
      privateMemoryReader,
      privateMemoryStorage,
      artifactProcessingQueue,
      llmFetch,
      memorySearchConfig,
    }),
  );
  routes.post("/threads/:threadId/turns", requireAuth, (c) =>
    handlePostThreadTurn(c, {
      db,
      privateMemoryReader,
      privateMemoryStorage,
      artifactProcessingQueue,
      llmFetch,
      memorySearchConfig,
    }),
  );

  return routes;
}
