import { mapStandardApiError } from "./shared/api-error.js";

type FetchBearerOptions = {
  extraHeaders?: Record<string, string>;
  mapError?: (status: number) => string;
};

async function fetchBearerResponse(
  fetcher: typeof fetch,
  url: string,
  token: string,
  options?: FetchBearerOptions,
): Promise<Response> {
  const response = await fetcher(url, {
    headers: {
      authorization: `Bearer ${token}`,
      ...options?.extraHeaders,
    },
  });

  if (response.ok) {
    return response;
  }

  const message = options?.mapError
    ? options.mapError(response.status)
    : `fetch_failed_${response.status}`;

  throw new Error(message);
}

async function fetchBearerJson<T>(
  fetcher: typeof fetch,
  url: string,
  token: string,
  options?: FetchBearerOptions,
): Promise<T> {
  const response = await fetchBearerResponse(fetcher, url, token, options);
  return response.json() as Promise<T>;
}

async function fetchBearerText(
  fetcher: typeof fetch,
  url: string,
  token: string,
  options?: FetchBearerOptions,
): Promise<string> {
  const response = await fetchBearerResponse(fetcher, url, token, options);
  return response.text();
}

async function fetchBearerBase64(
  fetcher: typeof fetch,
  url: string,
  token: string,
  options?: FetchBearerOptions,
): Promise<string> {
  const response = await fetchBearerResponse(fetcher, url, token, options);
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

export async function fetchGoogleCalendarJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  return fetchBearerJson<T>(
    fetcher,
    `https://www.googleapis.com/calendar/v3${path}`,
    token,
    { mapError: (status) => mapStandardApiError("google_calendar", status) },
  );
}

function mapGmailError(status: number): string {
  return status === 404
    ? "gmail_message_not_found"
    : mapStandardApiError("gmail", status);
}

export async function fetchGmailJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  return fetchBearerJson<T>(
    fetcher,
    `https://gmail.googleapis.com/gmail/v1${path}`,
    token,
    { mapError: mapGmailError },
  );
}

function mapNotionError(status: number): string {
  return status === 404
    ? "notion_source_not_found"
    : mapStandardApiError("notion", status);
}

export async function fetchNotionJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  return fetchBearerJson<T>(
    fetcher,
    `https://api.notion.com/v1${path}`,
    token,
    {
      extraHeaders: { "notion-version": "2026-03-11" },
      mapError: mapNotionError,
    },
  );
}

async function parseSlackApiResponse<T>(response: Response): Promise<T> {
  if (response.status === 429) {
    throw new Error("slack_rate_limited");
  }

  if (!response.ok) {
    throw new Error(`slack_fetch_failed_${response.status}`);
  }

  const payload = await response.json() as { ok?: boolean; error?: string };

  if (payload.ok === false) {
    throw new Error(`slack_${payload.error ?? "api_error"}`);
  }

  return payload as T;
}

export async function fetchSlackJson<T>(
  fetcher: typeof fetch,
  token: string,
  method: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  return parseSlackApiResponse<T>(response);
}

function readGoogleDriveError(status: number): string {
  return status === 404
    ? "google_drive_source_not_found"
    : mapStandardApiError("google_drive", status);
}

export async function fetchGoogleDriveJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  return fetchBearerJson<T>(
    fetcher,
    `https://www.googleapis.com/drive/v3${path}`,
    token,
    { mapError: readGoogleDriveError },
  );
}

export async function fetchGoogleDriveText(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  return fetchBearerText(
    fetcher,
    `https://www.googleapis.com/drive/v3${path}`,
    token,
    { mapError: readGoogleDriveError },
  );
}

function readMicrosoftGraphError(status: number): string {
  return status === 404
    ? "microsoft_drive_source_not_found"
    : mapStandardApiError("microsoft_graph", status);
}

export async function fetchMicrosoftGraphJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  return fetchBearerJson<T>(
    fetcher,
    `https://graph.microsoft.com/v1.0${path}`,
    token,
    { mapError: readMicrosoftGraphError },
  );
}

export async function fetchMicrosoftGraphText(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  return fetchBearerText(
    fetcher,
    `https://graph.microsoft.com/v1.0${path}`,
    token,
    { mapError: readMicrosoftGraphError },
  );
}

export async function fetchMicrosoftGraphBase64(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  return fetchBearerBase64(
    fetcher,
    `https://graph.microsoft.com/v1.0${path}`,
    token,
    { mapError: readMicrosoftGraphError },
  );
}

export function microsoftDriveItemPath(itemId: string): string {
  return itemId === "root" ? "/me/drive/root" : `/me/drive/items/${encodeURIComponent(itemId)}`;
}

export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");

  return Buffer.from(padded, "base64").toString("utf8");
}
