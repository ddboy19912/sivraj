import { describe, expect, it, vi } from "vitest";
import {
  createRealtimePcmAudioPlayer,
  pcm16ToFloat32,
} from "@/lib/voice/realtime-audio-player";

describe("pcm16ToFloat32", () => {
  it("decodes little-endian PCM16 into normalized float samples", () => {
    const samples = pcm16ToFloat32(new Uint8Array([
      0x00, 0x80,
      0x00, 0x00,
      0xff, 0x7f,
    ]));

    expect(Array.from(samples)).toEqual([-1, 0, 1]);
  });
});

describe("createRealtimePcmAudioPlayer", () => {
  it("schedules PCM chunks on a continuous audio timeline", () => {
    const context = new FakeAudioContext(4);
    const player = createRealtimePcmAudioPlayer({
      sampleRate: 4,
      leadTimeSeconds: 0.05,
      audioContextFactory: () => context as unknown as AudioContext,
    });

    player.pushPcm16(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));
    player.pushPcm16(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));

    expect(context.sources.map((source) => source.startTime)).toEqual([0.05, 1.05]);
  });

  it("recovers from underruns by restarting near currentTime", () => {
    const context = new FakeAudioContext(4);
    const player = createRealtimePcmAudioPlayer({
      sampleRate: 4,
      leadTimeSeconds: 0.05,
      audioContextFactory: () => context as unknown as AudioContext,
    });

    player.pushPcm16(new Uint8Array([0, 0, 0, 0]));
    context.currentTime = 5;
    player.pushPcm16(new Uint8Array([0, 0, 0, 0]));

    expect(context.sources.map((source) => source.startTime)).toEqual([0.05, 5.05]);
  });

  it("resolves done after the scheduled audio drains", async () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext(4);
    const player = createRealtimePcmAudioPlayer({
      sampleRate: 4,
      leadTimeSeconds: 0,
      audioContextFactory: () => context as unknown as AudioContext,
    });
    let resolved = false;
    void player.done.then(() => {
      resolved = true;
    });

    player.pushPcm16(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));
    player.close();
    await vi.advanceTimersByTimeAsync(1_024);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it("stops scheduled sources on cancel", async () => {
    const context = new FakeAudioContext(4);
    const player = createRealtimePcmAudioPlayer({
      sampleRate: 4,
      audioContextFactory: () => context as unknown as AudioContext,
    });

    player.pushPcm16(new Uint8Array([0, 0, 0, 0]));
    player.cancel();
    await player.done;

    expect(context.sources[0]?.stopped).toBe(true);
  });
});

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  readonly sources: FakeAudioBufferSourceNode[] = [];
  private readonly rate: number;

  constructor(rate: number) {
    this.rate = rate;
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(length, sampleRate);
  }

  createBufferSource() {
    const source = new FakeAudioBufferSourceNode();
    this.sources.push(source);
    return source;
  }

  resume = vi.fn(async () => undefined);

  get sampleRate() {
    return this.rate;
  }
}

class FakeAudioBuffer {
  readonly duration: number;
  readonly copied: Float32Array[] = [];
  readonly length: number;
  readonly sampleRate: number;

  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
  }

  copyToChannel(samples: Float32Array, _channel: number) {
    this.copied.push(samples);
  }
}

class FakeAudioBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  startTime: number | null = null;
  stopped = false;
  private endedListener: (() => void) | null = null;

  connect(_destination: unknown) {
    return undefined;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.endedListener = typeof listener === "function"
      ? () => listener(new Event("ended"))
      : () => listener.handleEvent(new Event("ended"));
  }

  start(startTime: number) {
    this.startTime = startTime;
  }

  stop() {
    this.stopped = true;
    this.endedListener?.();
  }
}
