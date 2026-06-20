export type RealtimePcmAudioPlayer = {
  pushPcm16(bytes: Uint8Array): void;
  close(): void;
  cancel(): void;
  readonly done: Promise<void>;
  readonly started: boolean;
};

type RealtimePcmAudioPlayerInput = {
  sampleRate: number;
  leadTimeSeconds?: number;
  onStarted?: () => void;
  audioContextFactory?: (sampleRate: number) => AudioContext;
  setTimeoutImpl?: typeof window.setTimeout;
  clearTimeoutImpl?: typeof window.clearTimeout;
};

const DEFAULT_LEAD_TIME_SECONDS = 0.03;

export function createRealtimePcmAudioPlayer(
  input: RealtimePcmAudioPlayerInput,
): RealtimePcmAudioPlayer {
  const audioContext = input.audioContextFactory?.(input.sampleRate)
    ?? new AudioContext({ sampleRate: input.sampleRate });
  const setTimer = input.setTimeoutImpl ?? window.setTimeout.bind(window);
  const clearTimer = input.clearTimeoutImpl ?? window.clearTimeout.bind(window);
  const sources = new Set<AudioBufferSourceNode>();
  const leadTime = input.leadTimeSeconds ?? DEFAULT_LEAD_TIME_SECONDS;
  let nextStartTime = 0;
  let started = false;
  let closed = false;
  let cancelled = false;
  let finishTimer: number | null = null;
  let doneResolve: (() => void) | null = null;

  const done = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  function resolveDone() {
    if (finishTimer !== null) {
      clearTimer(finishTimer);
      finishTimer = null;
    }
    doneResolve?.();
    doneResolve = null;
  }

  function scheduleDoneIfClosed() {
    if (!closed || cancelled || !doneResolve) {
      return;
    }

    if (!started) {
      resolveDone();
      return;
    }

    const remainingMs = Math.max(0, (nextStartTime - audioContext.currentTime) * 1_000);
    if (finishTimer !== null) {
      clearTimer(finishTimer);
    }
    finishTimer = setTimer(resolveDone, remainingMs + 25);
  }

  return {
    pushPcm16(bytes: Uint8Array) {
      if (closed || cancelled || bytes.byteLength === 0) {
        return;
      }

      const samples = pcm16ToFloat32(bytes);
      if (samples.length === 0) {
        return;
      }

      void audioContext.resume?.();
      const buffer = audioContext.createBuffer(1, samples.length, input.sampleRate);
      buffer.copyToChannel(samples, 0);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.addEventListener("ended", () => {
        sources.delete(source);
      }, { once: true });

      if (nextStartTime <= audioContext.currentTime) {
        nextStartTime = audioContext.currentTime + leadTime;
      }

      const startTime = nextStartTime;
      source.start(startTime);
      sources.add(source);
      nextStartTime = startTime + buffer.duration;

      if (!started) {
        started = true;
        input.onStarted?.();
      }
      scheduleDoneIfClosed();
    },
    close() {
      closed = true;
      scheduleDoneIfClosed();
    },
    cancel() {
      cancelled = true;
      closed = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Source nodes throw if they have already ended; cancellation should stay idempotent.
        }
      }
      sources.clear();
      resolveDone();
    },
    done,
    get started() {
      return started;
    },
  };
}

export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(new ArrayBuffer(sampleCount * 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    samples[index] = sample < 0 ? sample / 32_768 : sample / 32_767;
  }

  return samples;
}
