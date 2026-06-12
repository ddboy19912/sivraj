import { Hono } from "hono";
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

  routes.get("/threads/:threadId/messages", requireAuth, (c) => handleGetThreadMessages(c, db));
  routes.post("/threads/:threadId/messages", requireAuth, (c) =>
    handlePostThreadMessage(c, db, privateMemoryReader, llmFetch),
  );

  return routes;
}
