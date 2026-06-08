import { Hono } from "hono";
import { importPublicGitHubRepository } from "@sivraj/ingestion";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinScopedJsonBody } from "../lib/http/route-auth.js";
import { handleGitHubImportPost, type GitHubImporter } from "./github-import-handler.js";

export type { GitHubImporter } from "./github-import-handler.js";

export function createGitHubImportRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
  githubImporter = ({ repoUrl }) => importPublicGitHubRepository({ repoUrl }),
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/", requireAuth, async (c) => {
    const gate = await authorizeTwinScopedJsonBody(c, "artifact:upload", { rejectArrays: false });

    if (!gate.ok) {
      return gate.response;
    }

    return handleGitHubImportPost(c, {
      db,
      privateMemoryStorage,
      artifactProcessingQueue,
      githubImporter,
    }, gate.value);
  });

  return routes;
}
