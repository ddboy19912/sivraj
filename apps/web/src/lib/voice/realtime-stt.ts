import type { RealtimeVoiceTranscriptionSession } from "@/types/voice.types";

type CartesiaTurnEvent =
  | { type: "connected"; request_id?: string }
  | { type: "turn.start"; request_id?: string }
  | { type: "turn.update"; transcript?: string; request_id?: string }
  | { type: "turn.eager_end"; transcript?: string; request_id?: string }
  | { type: "turn.resume"; request_id?: string }
  | { type: "turn.end"; transcript?: string; request_id?: string }
  | { type: "done"; request_id?: string }
  | { type: "error"; title?: string; message?: string; error_code?: string; status_code?: number };

export type RealtimeTranscriptResult = {
  text: string;
  provider: "cartesia";
  model: string;
  metadata: {
    requestId?: string;
    partialTranscript?: string;
  };
};

export type RealtimeSpeechToTextClient = {
  ready: Promise<void>;
  stop(): Promise<RealtimeTranscriptResult>;
  cancel(): void;
};

type RealtimeSpeechToTextInput = {
  session: RealtimeVoiceTranscriptionSession;
  stream: MediaStream;
  onTranscriptUpdate?: (transcript: string) => void;
  audioContextFactory?: (sampleRate: number) => AudioContext;
  WebSocketConstructor?: typeof WebSocket;
};

const PCM_ENCODING = "pcm_s16le";
const AUDIO_CHUNK_MS = 100;
const FINAL_TRANSCRIPT_TIMEOUT_MS = 12_000;

export async function createCartesiaRealtimeSpeechToTextClient(
  input: RealtimeSpeechToTextInput,
): Promise<RealtimeSpeechToTextClient> {
  const WebSocketImpl = input.WebSocketConstructor ?? WebSocket;
  const audioContext = input.audioContextFactory?.(input.session.sampleRate)
    ?? new AudioContext({ sampleRate: input.session.sampleRate });
  const ws = new WebSocketImpl(cartesiaRealtimeSttUrl(input.session));
  ws.binaryType = "arraybuffer";

  const source = audioContext.createMediaStreamSource(input.stream);
  const silence = audioContext.createGain();
  silence.gain.value = 0;

  let processorCleanup: (() => void) | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  let stopRequested = false;
  let settled = false;
  let partialTranscript = "";
  let finalTranscript = "";
  let requestId: string | undefined;
  let finalResolve: ((result: RealtimeTranscriptResult) => void) | null = null;
  let finalReject: ((error: Error) => void) | null = null;
  let finalTimer: number | null = null;

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const finalTranscriptPromise = new Promise<RealtimeTranscriptResult>((resolve, reject) => {
    finalResolve = resolve;
    finalReject = reject;
  });

  ws.addEventListener("open", () => {
    readyResolve?.();
  });

  ws.addEventListener("message", (event) => {
    const message = parseCartesiaMessage(event.data);
    if (!message) {
      return;
    }

    if ("request_id" in message && typeof message.request_id === "string") {
      requestId = message.request_id;
    }

    if (message.type === "turn.update" || message.type === "turn.eager_end") {
      const transcript = normalizeTranscript(message.transcript);
      if (transcript) {
        partialTranscript = transcript;
        input.onTranscriptUpdate?.(transcript);
      }
      return;
    }

    if (message.type === "turn.end") {
      finalTranscript = normalizeTranscript(message.transcript) || partialTranscript;
      resolveFinal();
      return;
    }

    if (message.type === "error") {
      rejectFinal(new Error(cartesiaErrorMessage(message)));
    }
  });

  ws.addEventListener("error", () => {
    const error = new Error("realtime_speech_to_text_connection_failed");
    readyReject?.(error);
    rejectFinal(error);
  });

  ws.addEventListener("close", () => {
    stopAudio();
    if (!stopRequested && !settled) {
      rejectFinal(new Error("realtime_speech_to_text_closed"));
      return;
    }

    if (stopRequested && !settled) {
      resolveFinal();
    }
  });

  await ready;
  processorCleanup = await connectAudioProcessor({
    audioContext,
    source,
    silence,
    sampleRate: audioContext.sampleRate,
    onChunk: (chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    },
  });

  return {
    ready,
    async stop() {
      stopRequested = true;
      stopAudio();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "close" }));
      }
      finalTimer = window.setTimeout(() => {
        resolveFinal();
      }, FINAL_TRANSCRIPT_TIMEOUT_MS);

      return finalTranscriptPromise;
    },
    cancel() {
      stopRequested = true;
      stopAudio();
      rejectFinal(new DOMException("Voice transcription cancelled.", "AbortError"));
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
  };

  function stopAudio() {
    processorCleanup?.();
    processorCleanup = null;
    source.disconnect();
    silence.disconnect();
    input.stream.getTracks().forEach((track) => track.stop());
    void audioContext.close().catch(() => undefined);
  }

  function resolveFinal() {
    if (settled) {
      return;
    }

    settled = true;
    clearFinalTimer();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    finalResolve?.({
      text: (finalTranscript || partialTranscript).trim(),
      provider: "cartesia",
      model: input.session.model,
      metadata: {
        requestId,
        ...(partialTranscript ? { partialTranscript } : {}),
      },
    });
  }

  function rejectFinal(error: Error) {
    if (settled) {
      return;
    }

    settled = true;
    clearFinalTimer();
    finalReject?.(error);
  }

  function clearFinalTimer() {
    if (finalTimer !== null) {
      window.clearTimeout(finalTimer);
      finalTimer = null;
    }
  }
}

export function cartesiaRealtimeSttUrl(session: RealtimeVoiceTranscriptionSession): string {
  const url = new URL(`${session.websocketUrl.replace(/\/+$/, "")}/stt/turns/websocket`);
  url.searchParams.set("model", session.model);
  url.searchParams.set("encoding", session.encoding || PCM_ENCODING);
  url.searchParams.set("sample_rate", String(session.sampleRate));
  url.searchParams.set("cartesia_version", session.apiVersion);
  url.searchParams.set("access_token", session.accessToken);
  return url.toString();
}

export function float32ToPcm16(samples: Float32Array<ArrayBufferLike>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

async function connectAudioProcessor(input: {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  silence: GainNode;
  sampleRate: number;
  onChunk: (chunk: ArrayBuffer) => void;
}): Promise<() => void> {
  if (input.audioContext.audioWorklet) {
    return connectAudioWorkletProcessor(input);
  }

  return connectScriptProcessor(input);
}

async function connectAudioWorkletProcessor(input: {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  silence: GainNode;
  sampleRate: number;
  onChunk: (chunk: ArrayBuffer) => void;
}): Promise<() => void> {
  const moduleUrl = URL.createObjectURL(new Blob([`
class CartesiaPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel);
    }
    return true;
  }
}
registerProcessor("cartesia-pcm-processor", CartesiaPcmProcessor);
`], { type: "text/javascript" }));

  await input.audioContext.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const node = new AudioWorkletNode(input.audioContext, "cartesia-pcm-processor");
  const sender = createChunkedPcmSender(input.sampleRate, input.onChunk);
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    sender.push(event.data);
  };
  input.source.connect(node);
  node.connect(input.silence);
  input.silence.connect(input.audioContext.destination);

  return () => {
    node.port.onmessage = null;
    node.disconnect();
  };
}

function connectScriptProcessor(input: {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  silence: GainNode;
  sampleRate: number;
  onChunk: (chunk: ArrayBuffer) => void;
}): () => void {
  const processor = input.audioContext.createScriptProcessor(4096, 1, 1);
  const sender = createChunkedPcmSender(input.sampleRate, input.onChunk);
  processor.onaudioprocess = (event) => {
    sender.push(event.inputBuffer.getChannelData(0));
  };
  input.source.connect(processor);
  processor.connect(input.silence);
  input.silence.connect(input.audioContext.destination);

  return () => {
    processor.onaudioprocess = null;
    processor.disconnect();
  };
}

function createChunkedPcmSender(
  sampleRate: number,
  onChunk: (chunk: ArrayBuffer) => void,
) {
  const targetSamples = Math.max(1, Math.floor(sampleRate * (AUDIO_CHUNK_MS / 1_000)));
  let pending: Float32Array<ArrayBufferLike> = new Float32Array(0);

  return {
    push(samples: Float32Array) {
      pending = concatFloat32(pending, samples);
      while (pending.length >= targetSamples) {
      const chunk = pending.slice(0, targetSamples);
        pending = pending.slice(targetSamples);
        onChunk(float32ToPcm16(chunk));
      }
    },
  };
}

function concatFloat32(
  left: Float32Array<ArrayBufferLike>,
  right: Float32Array<ArrayBufferLike>,
): Float32Array<ArrayBufferLike> {
  if (left.length === 0) {
    return right.slice();
  }

  const next = new Float32Array(left.length + right.length);
  next.set(left, 0);
  next.set(right, left.length);
  return next;
}

function parseCartesiaMessage(value: unknown): CartesiaTurnEvent | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && "type" in parsed
      ? parsed as CartesiaTurnEvent
      : null;
  } catch {
    return null;
  }
}

function normalizeTranscript(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cartesiaErrorMessage(error: Extract<CartesiaTurnEvent, { type: "error" }>): string {
  return error.message || error.title || error.error_code || "realtime_speech_to_text_failed";
}
