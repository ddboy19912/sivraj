import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  authorizeTwinArtifactRoute,
  authorizeTwinScopedJsonBody,
} from "../lib/http/route-auth.js";
import {
  handleArtifactEvents,
  handleArtifactGet,
  handleArtifactPrivacyCheck,
  handleArtifactRetry,
  handleArtifactUpload,
} from "./artifact-handlers.js";

export function createArtifactRoutes(deps: AppDependencies) {
  const { db } = deps;
  const artifactRoutes = new Hono<AuthEnv>();

  artifactRoutes.post("/", requireAuth, async (c) => {
    const gate = await authorizeTwinScopedJsonBody(c, "artifact:upload", { rejectArrays: false });

    if (!gate.ok) {
      return gate.response;
    }

    return handleArtifactUpload(c, deps, gate.value);
  });

  artifactRoutes.post("/:artifactId/retry", requireAuth, async (c) => {
    const gate = await authorizeTwinArtifactRoute(c, db, "artifact:upload");

    if (!gate.ok) {
      return gate.response;
    }

    return handleArtifactRetry(c, deps, gate.value);
  });

  artifactRoutes.get("/:artifactId", requireAuth, async (c) => {
    const gate = await authorizeTwinArtifactRoute(c, db, "memory:read");

    if (!gate.ok) {
      return gate.response;
    }

    return handleArtifactGet(c, db, gate.value);
  });

  artifactRoutes.get("/:artifactId/privacy-check", requireAuth, async (c) => {
    const gate = await authorizeTwinArtifactRoute(c, db, "memory:read");

    if (!gate.ok) {
      return gate.response;
    }

    return handleArtifactPrivacyCheck(c, deps, gate.value);
  });

  artifactRoutes.get("/:artifactId/events", requireAuth, async (c) => {
    const gate = await authorizeTwinArtifactRoute(c, db);

    if (!gate.ok) {
      return gate.response;
    }

    return handleArtifactEvents(c, deps, gate.value);
  });

  return artifactRoutes;
}
