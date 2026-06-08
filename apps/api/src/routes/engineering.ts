import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  createEngineeringAgentHandler,
  ENGINEERING_CONTEXT_AGENT_SCOPES,
  ENGINEERING_CONTEXT_SCOPES,
} from "../lib/engineering/helpers.js";
import {
  handleEngineeringContextGet,
  handleEngineeringInstructionPatchPost,
  handleEngineeringReviewActionPost,
  handleEngineeringReviewQueueGet,
  handleEngineeringSourcesGet,
} from "./engineering-handlers.js";

export function createEngineeringRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();
  const withContextAgent = createEngineeringAgentHandler(db, {
    scopes: ENGINEERING_CONTEXT_SCOPES,
    acceptedAgentScopes: ENGINEERING_CONTEXT_AGENT_SCOPES,
  });

  routes.get("/sources", requireAuth, (c) => handleEngineeringSourcesGet(c, db));
  routes.get("/context", requireAuth, withContextAgent((c, ctx) => handleEngineeringContextGet(c, db, ctx)));
  routes.get("/review-queue", requireAuth, withContextAgent((c, ctx) => handleEngineeringReviewQueueGet(c, db, ctx)));
  routes.post("/instruction-patch", requireAuth, withContextAgent((c, ctx) => handleEngineeringInstructionPatchPost(c, db, ctx)));
  routes.post("/review-queue/:candidateId/action", requireAuth, (c) => handleEngineeringReviewActionPost(c, db));

  return routes;
}
