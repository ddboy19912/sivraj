import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
} from "@sivraj/auth";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { refreshContextRuntimePackets } from "../lib/context-runtime/packets.js";
import {
  readContextRuntimeMode,
  readContextRuntimeRetrievalDepth,
  readContextRuntimeSurface,
  readLatencyBudgetMs,
  readRecordValue,
  readStringList,
  readStringValue,
} from "../lib/context-runtime/parsing.js";
import { defaultRetrievalDepth, resolveTwinContext } from "../lib/context-runtime/resolver.js";
import type { ContextRuntimeMode, ContextRuntimeSurface } from "../lib/context-runtime/types.js";
import { parseJsonObjectBody } from "../lib/http/route-helpers.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export function createContextRoutes({
  db,
  contextWarmupQueue,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/resolve", requireAuth, async (c) => {
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }
    if (process.env["CONTEXT_RUNTIME_ENABLED"] === "false") {
      return c.json({ error: "context_runtime_disabled" }, 503);
    }

    const body = await parseJsonObjectBody(c);
    if (!body.ok) {
      return body.response;
    }

    const surface = readContextRuntimeSurface(body.body["surface"]);
    const mode = readContextRuntimeMode(body.body["mode"]);
    const query = readStringValue(body.body["query"]);
    if (!surface || !mode || !query) {
      return c.json({ error: "invalid_context_resolve_request" }, 400);
    }

    const authError = authorizeContextRequest({
      twinId,
      auth: c.get("auth"),
      mode,
      retrievalDepth: readContextRuntimeRetrievalDepth(body.body["retrievalDepth"])
        ?? defaultRetrievalDepth(surface, mode),
      includeEvidence: body.body["includeEvidence"] === true,
    });
    if (authError) {
      return c.json(authError.body, authError.status);
    }

    const result = await resolveTwinContext({
      db,
      twinId,
      userId: c.get("auth").sub,
      requester: {
        type: c.get("auth").type,
        id: c.get("auth").sub,
        scopes: c.get("auth").scopes,
      },
      surface,
      query,
      mode,
      scopes: c.get("auth").scopes,
      latencyBudgetMs: readLatencyBudgetMs(body.body["latencyBudgetMs"], defaultLatencyBudgetMs(surface)),
      retrievalDepth: readContextRuntimeRetrievalDepth(body.body["retrievalDepth"]) ?? undefined,
      includeEvidence: body.body["includeEvidence"] === true,
      projectFingerprint: readRecordValue(body.body["projectFingerprint"]),
    });

    return c.json(result);
  });

  routes.post("/warmup", requireAuth, async (c) => {
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }
    if (process.env["CONTEXT_RUNTIME_ENABLED"] === "false") {
      return c.json({ status: "skipped", packetIds: [], reason: "context_runtime_disabled" });
    }

    const body = await parseJsonObjectBody(c);
    if (!body.ok) {
      return body.response;
    }

    const surface = readContextRuntimeSurface(body.body["surface"]);
    const reason = readWarmupReason(body.body["reason"]);
    if (!surface || !reason) {
      return c.json({ error: "invalid_context_warmup_request" }, 400);
    }

    const authError = authorizeContextRequest({
      twinId,
      auth: c.get("auth"),
      mode: surface === "mcp" || surface === "cli" ? "agent_context" : "answer_context",
      retrievalDepth: "hot",
      includeEvidence: false,
    });
    if (authError) {
      return c.json(authError.body, authError.status);
    }

    const refreshed = await refreshContextRuntimePackets({
      db,
      twinId,
      surface,
      reason,
      scopeKey: readStringValue(body.body["scope"]) ?? "default",
    });

    if (process.env["CONTEXT_WARMUP_ENABLED"] === "false") {
      return c.json({
        status: "skipped",
        packetIds: refreshed.packetIds,
      });
    }

    if (!contextWarmupQueue) {
      return c.json({
        status: "already_warm",
        packetIds: refreshed.packetIds,
      });
    }

    const queued = await contextWarmupQueue.enqueueContextWarmup({
      twinId,
      requestedBy: c.get("auth").sub,
      surface,
      reason,
      scope: readStringValue(body.body["scope"]),
      projectFingerprint: readRecordValue(body.body["projectFingerprint"]),
      documentIds: readStringList(body.body["documentIds"]),
    });

    return c.json({
      status: "queued",
      jobId: queued.jobId,
      packetIds: refreshed.packetIds,
    });
  });

  return routes;
}

type AuthLike = {
  sub: string;
  type: string;
  scopes: string[];
  twinId?: string;
};

function authorizeContextRequest(input: {
  twinId: string;
  auth: AuthLike;
  mode: ContextRuntimeMode;
  retrievalDepth: "hot" | "warm" | "cold";
  includeEvidence: boolean;
}): { status: 403; body: Record<string, unknown> } | null {
  if (input.auth.twinId && input.auth.twinId !== input.twinId) {
    return { status: 403, body: { error: "wrong_twin" } };
  }

  if (input.auth.type === "agent") {
    if (
      (input.mode === "memory_search" || input.retrievalDepth === "cold" || input.includeEvidence) &&
      !input.auth.scopes.includes(AGENT_MEMORY_SEARCH_SCOPE)
    ) {
      return { status: 403, body: { error: "missing_scope", scope: AGENT_MEMORY_SEARCH_SCOPE } };
    }
    if (!input.auth.scopes.includes(AGENT_CONTEXT_READ_SCOPE) && !input.auth.scopes.includes(AGENT_MEMORY_SEARCH_SCOPE)) {
      return { status: 403, body: { error: "missing_scope", scope: AGENT_CONTEXT_READ_SCOPE } };
    }
    return null;
  }

  return input.auth.scopes.includes("memory:read")
    ? null
    : { status: 403, body: { error: "missing_scope", scope: "memory:read" } };
}

function defaultLatencyBudgetMs(surface: ContextRuntimeSurface): number {
  if (surface === "voice_chat" || surface === "onboarding_voice") {
    return 150;
  }
  if (surface === "mcp" || surface === "cli") {
    return 1_000;
  }
  return 500;
}

function readWarmupReason(value: unknown) {
  return value === "app_boot" ||
    value === "voice_start" ||
    value === "mcp_connect" ||
    value === "artifact_processed" ||
    value === "connector_sync_completed" ||
    value === "manual"
    ? value
    : null;
}
