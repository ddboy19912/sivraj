export function mapStandardApiError(prefix: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${prefix}_unauthorized`;
  }

  if (status === 404) {
    return `${prefix}_not_found`;
  }

  if (status === 429) {
    return `${prefix}_rate_limited`;
  }

  return `${prefix}_fetch_failed_${status}`;
}
