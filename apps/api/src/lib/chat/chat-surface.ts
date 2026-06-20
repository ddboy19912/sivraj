import { chatThreads } from "@sivraj/db";
import { sql } from "drizzle-orm";
import type { ChatMemoryIntent } from "./memory-intake.js";

export type ChatSurface = "web_chat" | "voice_chat";

export const NORMAL_CHAT_THREAD_FILTER =
  sql`coalesce(${chatThreads.metadata}->>'surface', 'web_chat') = 'web_chat'`;

export function readChatSurface(value: unknown): ChatSurface {
  return value === "voice_chat" ? "voice_chat" : "web_chat";
}

export function readChatMemoryIntent(value: unknown): ChatMemoryIntent {
  return value === "remember" || value === "private" ? value : "auto";
}
