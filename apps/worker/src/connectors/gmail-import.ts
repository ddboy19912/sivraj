import { decodeBase64Url, fetchGmailJson } from "./fetch.js";

type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
};

type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  raw?: string;
};

export type EmailImportResult = {
  messageId: string;
  threadId: string | null;
  title: string;
  content: string;
  metadata: {
    importer: "gmail_message";
    messageId: string;
    threadId: string | null;
    internalDate: string | null;
  };
};

export type GmailImportInput = {
  token: string;
  cursor?: string;
  query: string;
  fetcher: typeof fetch;
};

export type GmailImportResult = {
  messages: EmailImportResult[];
  cursorAfter: string | null;
  query: string;
};

export function buildGmailSearchQuery(query: string, cursor?: string): string {
  const afterSeconds = cursor ? Math.floor(Number.parseInt(cursor, 10) / 1000) : null;

  return [query, afterSeconds ? `after:${afterSeconds}` : null]
    .filter(Boolean)
    .join(" ");
}

export function advanceGmailCursor(
  cursorAfter: string | null,
  internalDate: string | undefined,
): string | null {
  if (!internalDate) {
    return cursorAfter;
  }

  if (!cursorAfter || Number.parseInt(internalDate, 10) > Number.parseInt(cursorAfter, 10)) {
    return internalDate;
  }

  return cursorAfter;
}

export function toEmailImportResult(message: GmailMessageResponse): EmailImportResult | null {
  if (!message.id || !message.raw) {
    return null;
  }

  return {
    messageId: message.id,
    threadId: message.threadId ?? null,
    title: `Gmail message ${message.id}`,
    content: decodeBase64Url(message.raw),
    metadata: {
      importer: "gmail_message",
      messageId: message.id,
      threadId: message.threadId ?? null,
      internalDate: message.internalDate ?? null,
    },
  };
}

async function fetchGmailMessage(
  fetcher: typeof fetch,
  token: string,
  messageId: string,
): Promise<GmailMessageResponse> {
  return fetchGmailJson<GmailMessageResponse>(
    fetcher,
    token,
    `/users/me/messages/${encodeURIComponent(messageId)}?${new URLSearchParams({
      format: "raw",
    }).toString()}`,
  );
}

export async function importGmailMessages(input: GmailImportInput): Promise<GmailImportResult> {
  const query = buildGmailSearchQuery(input.query, input.cursor);
  const list = await fetchGmailJson<GmailListResponse>(
    input.fetcher,
    input.token,
    `/users/me/messages?${new URLSearchParams({
      maxResults: "10",
      q: query,
    }).toString()}`,
  );

  const imported: EmailImportResult[] = [];
  let cursorAfter: string | null = input.cursor ?? null;

  for (const messageRef of list.messages ?? []) {
    if (!messageRef.id) {
      continue;
    }

    const message = await fetchGmailMessage(input.fetcher, input.token, messageRef.id);
    const email = toEmailImportResult(message);

    if (!email) {
      continue;
    }

    imported.push(email);
    cursorAfter = advanceGmailCursor(cursorAfter, message.internalDate);
  }

  return {
    messages: imported,
    cursorAfter,
    query,
  };
}
