import { describe, it } from "vitest";

import { run_builds_shared_encryption_artifacts_and_request_bodies } from "./agent-writeback-encryption.test-scenarios.js";

describe("agent writeback encryption", () => {
  it("builds shared encryption artifacts and request bodies", run_builds_shared_encryption_artifacts_and_request_bodies);
});
