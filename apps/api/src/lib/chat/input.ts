/** Parse and validate chat POST bodies for message and turn endpoints. */
import type { Context } from "hono";
import type { AuthEnv } from "../../middleware/auth.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import type { PostAttachmentInput, PostMessageInput } from "../../types/chat.types.js";
import { readChatMemoryIntent, readChatSurface } from "./chat-surface.js";
import { isUuid, readFiniteNonNegativeNumber } from "./attachments.js";

/** Read message content, memory intent, and surface from a thread POST body. */
export async function readPostMessageInput(c: Context<AuthEnv>): Promise<PostMessageInput> {
  const body = await c.req.json().catch(() => null);
  const record = readRecord(body);

  return {
    content: optionalString(record["content"]),
    memoryIntent: readChatMemoryIntent(record["memoryIntent"]),
    surface: readChatSurface(record["surface"]),
    retryAttempt: readChatRetryAttempt(record["retryAttempt"]),
  };
}

function readChatRetryAttempt(value: unknown) {
  const parsed = readFiniteNonNegativeNumber(value) ?? 0;
  return Math.min(Math.floor(parsed), 4);
}

export async function readPostAttachmentInput(c: Context<AuthEnv>): Promise<PostAttachmentInput> {
  const body = await c.req.json().catch(() => null);
  const record = readRecord(body);
  const artifactId = optionalString(record["artifactId"]);

  if (!artifactId) {
    return { error: "missing_attachment_artifact", status: 400 };
  }

  if (!isUuid(artifactId)) {
    return { error: "invalid_attachment_artifact", status: 400 };
  }

  return {
    artifactId,
    fileName: optionalString(record["fileName"]) ?? "Uploaded file",
    fileType: optionalString(record["fileType"]),
    fileSize: readFiniteNonNegativeNumber(record["fileSize"]),
  };
}
