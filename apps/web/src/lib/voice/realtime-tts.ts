import type { RealtimeVoiceSynthesisSession } from "@/types/voice.types";

type CartesiaTextToSpeechEvent =
  | { type: "chunk"; data?: string; context_id?: string }
  | { type: "done"; done?: boolean; context_id?: string }
  | { type: "flush_done"; context_id?: string }
  | {
      type: "error";
      title?: string;
      message?: string;
      error_code?: string;
      status_code?: number;
      context_id?: string;
    };

export type RealtimeTextToSpeechClient = {
  push(text: string): void;
  close(): void;
  cancel(): void;
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  readonly started: boolean;
  readonly error: Error | null;
};

type RealtimeTextToSpeechInput = {
  session: RealtimeVoiceSynthesisSession;
  signal: AbortSignal;
  onAudioChunk: (bytes: Uint8Array) => void;
  onStreamClosed: () => void;
  WebSocketConstructor?: typeof WebSocket;
};

export function createCartesiaRealtimeTextToSpeechClient(
  input: RealtimeTextToSpeechInput,
): RealtimeTextToSpeechClient {
  const WebSocketImpl = input.WebSocketConstructor ?? WebSocket;
  const ws = new WebSocketImpl(cartesiaRealtimeTtsUrl(input.session));
  const queue: string[] = [];
  const pendingContexts = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  let activeContextId: string | null = null;
  let closed = false;
  let settled = false;
  let started = false;
  let cancelled = false;
  let error: Error | null = null;
  let wake: (() => void) | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function notify() {
    wake?.();
    wake = null;
  }

  function fail(nextError: Error) {
    if (!error) {
      error = nextError;
    }
    for (const pending of pendingContexts.values()) {
      pending.reject(nextError);
    }
    pendingContexts.clear();
    readyReject?.(nextError);
    notify();
  }

  function emitClip(base64Pcm: string) {
    const bytes = base64ToUint8Array(base64Pcm);
    if (bytes.byteLength === 0) {
      return;
    }
    if (!started) {
      started = true;
    }
    input.onAudioChunk(bytes);
  }

  ws.addEventListener("open", () => {
    readyResolve?.();
    notify();
  });

  ws.addEventListener("message", (event) => {
    const message = parseCartesiaTextToSpeechMessage(event.data);
    if (!message) {
      return;
    }

    if (message.type === "chunk" && message.data) {
      emitClip(message.data);
      return;
    }

    if (message.type === "done") {
      const contextId = message.context_id;
      if (contextId) {
        pendingContexts.get(contextId)?.resolve();
        pendingContexts.delete(contextId);
      }
      if (!contextId && activeContextId) {
        pendingContexts.get(activeContextId)?.resolve();
        pendingContexts.delete(activeContextId);
      }
      activeContextId = null;
      notify();
      return;
    }

    if (message.type === "error") {
      fail(new Error(cartesiaTextToSpeechErrorMessage(message)));
    }
  });

  ws.addEventListener("error", () => {
    fail(new Error("realtime_text_to_speech_connection_failed"));
  });

  ws.addEventListener("close", () => {
    if (!settled && !input.signal.aborted && !closed) {
      fail(new Error("realtime_text_to_speech_closed"));
    }
  });

  input.signal.addEventListener("abort", () => {
    cancel();
  }, { once: true });

  const done = (async () => {
    await ready;

    while (!input.signal.aborted) {
      if (error) {
        break;
      }

      const text = queue.shift();
      if (!text) {
        if (closed) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      await synthesizeChunk(text);
    }

    settled = true;
    if (!input.signal.aborted && started) {
      input.onStreamClosed();
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  })();

  async function synthesizeChunk(text: string) {
    const contextId = createContextId();
    activeContextId = contextId;
    const chunkDone = new Promise<void>((resolve, reject) => {
      pendingContexts.set(contextId, { resolve, reject });
    });

    ws.send(JSON.stringify({
      model_id: input.session.model,
      transcript: text,
      voice: {
        mode: "id",
        id: input.session.voiceId,
      },
      language: input.session.language || "en",
      context_id: contextId,
      output_format: {
        container: "raw",
        encoding: input.session.encoding,
        sample_rate: input.session.sampleRate,
      },
      add_timestamps: false,
      continue: false,
    }));

    await chunkDone;
  }

  function cancel() {
    closed = true;
    cancelled = true;
    readyResolve?.();
    if (activeContextId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ context_id: activeContextId, cancel: true }));
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    notify();
  }

  return {
    push(text: string) {
      const cleanText = text.trim();
      if (!cleanText || closed) {
        return;
      }
      queue.push(cleanText);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    cancel,
    ready,
    done,
    get started() {
      return started;
    },
    get error() {
      return cancelled ? null : error;
    },
  };
}

export function cartesiaRealtimeTtsUrl(session: RealtimeVoiceSynthesisSession): string {
  const baseUrl = session.websocketUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/tts/websocket`);
  url.searchParams.set("cartesia_version", session.apiVersion);
  url.searchParams.set("access_token", session.accessToken);
  return url.toString();
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createContextId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCartesiaTextToSpeechMessage(value: unknown): CartesiaTextToSpeechEvent | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isCartesiaTextToSpeechEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCartesiaTextToSpeechEvent(
  value: unknown,
): value is CartesiaTextToSpeechEvent {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string";
}

function cartesiaTextToSpeechErrorMessage(
  errorEvent: Extract<CartesiaTextToSpeechEvent, { type: "error" }>,
) {
  return [
    errorEvent.error_code,
    errorEvent.title,
    errorEvent.message,
    errorEvent.status_code ? `status:${errorEvent.status_code}` : null,
  ].filter(Boolean).join(":") || "realtime_text_to_speech_failed";
}
