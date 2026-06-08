import { fetchSlackJson } from "./fetch.js";

type SlackMessage = {
  text?: string;
  ts?: string;
  type?: string;
};

type SlackConversationInfoResponse = {
  channel?: {
    id?: string;
    name?: string;
    is_private?: boolean;
  };
};

type SlackHistoryResponse = {
  messages?: SlackMessage[];
  response_metadata?: {
    next_cursor?: string;
  };
};

export type SlackChannelImportResult = {
  channelId: string;
  channelName: string;
  content: string;
  metadata: {
    importer: "slack_channel";
    channelId: string;
    channelName: string;
    isPrivate: boolean | null;
    messageCount: number;
    oldest: string | null;
    latest: string | null;
    nextCursor: string | null;
  };
};

export async function importSlackChannel(input: {
  channelId: string;
  token: string;
  oldest?: string;
  fetcher: typeof fetch;
}): Promise<SlackChannelImportResult> {
  const info = await fetchSlackJson<SlackConversationInfoResponse>(
    input.fetcher,
    input.token,
    "conversations.info",
    { channel: input.channelId, include_num_members: "true" },
  );
  const channel = info.channel ?? {};
  const { messages, cursor } = await fetchSlackChannelMessages(input);
  const sortedMessages = sortSlackMessages(messages);
  const timestamps = summarizeSlackMessageTimestamps(sortedMessages);

  return {
    channelId: channel.id ?? input.channelId,
    channelName: channel.name ?? input.channelId,
    content: JSON.stringify(sortedMessages),
    metadata: {
      importer: "slack_channel",
      channelId: channel.id ?? input.channelId,
      channelName: channel.name ?? input.channelId,
      isPrivate: typeof channel.is_private === "boolean" ? channel.is_private : null,
      messageCount: sortedMessages.length,
      oldest: timestamps.oldest,
      latest: timestamps.latest,
      nextCursor: cursor ?? null,
    },
  };
}

async function fetchSlackChannelMessages(input: {
  channelId: string;
  token: string;
  oldest?: string;
  fetcher: typeof fetch;
}) {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 2; page += 1) {
    const history = await fetchSlackJson<SlackHistoryResponse>(
      input.fetcher,
      input.token,
      "conversations.history",
      {
        channel: input.channelId,
        limit: "15",
        ...(input.oldest ? { oldest: input.oldest, inclusive: "false" } : {}),
        ...(cursor ? { cursor } : {}),
      },
    );
    messages.push(...filterSlackMessages(history.messages ?? []));
    cursor = history.response_metadata?.next_cursor || undefined;

    if (!cursor) {
      break;
    }
  }

  return { messages, cursor };
}

function filterSlackMessages(messages: SlackMessage[]): SlackMessage[] {
  return messages
    .filter((message) => message.type === "message" || !message.type)
    .filter((message) => typeof message.text === "string" && message.text.trim().length > 0);
}

function sortSlackMessages(messages: SlackMessage[]): SlackMessage[] {
  return [...messages].sort(
    (left, right) => Number.parseFloat(left.ts ?? "0") - Number.parseFloat(right.ts ?? "0"),
  );
}

function summarizeSlackMessageTimestamps(messages: SlackMessage[]) {
  if (messages.length === 0) {
    return { oldest: null, latest: null };
  }

  return {
    oldest: messages[0]?.ts ?? null,
    latest: messages[messages.length - 1]?.ts ?? null,
  };
}
