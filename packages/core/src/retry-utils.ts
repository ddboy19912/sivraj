const RETRYABLE_NETWORK_ERROR_FRAGMENTS = [
  "fetch failed",
  "network",
  "timeout",
  "timed out",
  "econnreset",
  "econnrefused",
  "socket",
  "429",
  "500",
  "502",
  "503",
  "504",
] as const;

export function isRetryableNetworkError(
  error: unknown,
  fallbackMessage = "Unknown error",
): boolean {
  const message = (error instanceof Error ? error.message : fallbackMessage).toLowerCase();

  return RETRYABLE_NETWORK_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
