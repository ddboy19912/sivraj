export function formatWritebackApiResponseMarkdown(
  response: Record<string, unknown>,
  options: {
    heading?: string;
    statusLabel?: string;
  } = {},
): string {
  const heading = options.heading ?? "# Sivraj Agent Writeback";
  const statusLabel = options.statusLabel ?? "Warning";

  return [
    heading,
    "",
    `Writeback: ${String(response["writebackId"] ?? "unknown")}`,
    `Status: ${String(response["status"] ?? "unknown")}`,
    `Storage: ${String(response["storageMode"] ?? "unknown")}`,
    `${statusLabel}: ${String(response["warning"] ?? "pending_review")}`,
  ].join("\n");
}
