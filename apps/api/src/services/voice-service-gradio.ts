import { randomUUID } from "node:crypto";
import { truncateText } from "@sivraj/core";
import { parseGradioAudioResult } from "./voice-service-parse.js";

export function buildGradioQueueJoinBody(input: {
  text: string;
  voiceId: string;
  language?: string;
  style?: string;
  exaggeration?: number;
  referenceAudioBase64?: string;
  referenceMimeType?: string | null;
  apiKey?: string;
  sessionHash?: string;
}) {
  return {
    data: [
      input.text,
      input.voiceId,
      input.language ?? "en",
      input.style ?? "",
      input.exaggeration ?? 0,
      input.referenceAudioBase64 ?? "",
      input.referenceMimeType ?? "",
      input.apiKey ?? "",
    ],
    event_data: null,
    fn_index: 0,
    trigger_id: 12,
    session_hash: input.sessionHash ?? `sivraj-${randomUUID()}`,
  };
}

export function parseGradioQueueResult(body: string): {
  success: boolean;
  output: unknown;
} {
  const lines = body.split(/\r?\n/).filter((line) => line.startsWith("data:"));

  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line.slice("data:".length).trim()) as {
        msg?: string;
        success?: boolean;
        output?: unknown;
      };

      if (parsed.msg === "process_completed") {
        return {
          success: parsed.success === true,
          output: parsed.output,
        };
      }
    } catch {
      continue;
    }
  }

  return { success: false, output: null };
}

export function decodeGradioAudioOutput(output: unknown) {
  const audioBase64 = parseGradioAudioResult(output);
  const audioBytes = new Uint8Array(Buffer.from(audioBase64, "base64"));

  if (audioBytes.length === 0) {
    throw new Error("voice_service_empty_audio");
  }

  return {
    audioBytes,
    contentType: "audio/wav",
  };
}

export function gradioJoinError(status: number, body: string) {
  return new Error(`voice_service_failed:${status}:${truncateText(body)}`);
}
