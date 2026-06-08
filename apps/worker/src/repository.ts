import type { Db } from "@sivraj/db";
import type { ArtifactRepository } from "./ingestion-processor.js";
import { createArtifactMethods } from "./repository/artifact-methods.js";
import { createAuditMethods } from "./repository/audit-methods.js";
import { createCandidateMemoryMethods } from "./repository/candidate-memory-methods.js";
import { createGraphMethods } from "./repository/graph-methods.js";
import { createMemoryFragmentMethods } from "./repository/memory-fragment-methods.js";
import { createReflectionMethods } from "./repository/reflection-methods.js";

export function createDrizzleArtifactRepository(db: Db): ArtifactRepository {
  return {
    ...createArtifactMethods(db),
    ...createMemoryFragmentMethods(db),
    ...createGraphMethods(db),
    ...createCandidateMemoryMethods(db),
    ...createReflectionMethods(db),
    ...createAuditMethods(db),
  };
}
