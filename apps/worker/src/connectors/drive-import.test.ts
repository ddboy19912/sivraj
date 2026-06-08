import { describe, expect, it } from "vitest";
import { downloadGoogleDriveFile } from "./drive-import.js";

describe("downloadGoogleDriveFile", () => {
  it("returns null for unsupported mime types", async () => {
    await expect(downloadGoogleDriveFile({
      token: "token",
      fetcher: fetch,
      file: { id: "file-1", mimeType: "application/pdf" },
    })).resolves.toBeNull();
  });
});
