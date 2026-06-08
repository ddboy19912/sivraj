import { describe, expect, it } from "vitest";
import { storeDocumentImports } from "./document-imports.js";
import { createConnectorAdapterTestInput } from "../test/connector-fixtures.js";

describe("storeDocumentImports", () => {
  it("skips when no documents are available", async () => {
    const inserts: unknown[] = [];
    const result = await storeDocumentImports(createConnectorAdapterTestInput(inserts), [], "google_drive");

    expect(result.skippedCount).toBe(1);
    expect(inserts).toHaveLength(1);
  });
});
