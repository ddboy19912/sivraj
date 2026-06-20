import { describe, expect, it } from "vitest";
import {
  cartesiaRealtimeSttUrl,
  float32ToPcm16,
} from "@/lib/voice/realtime-stt";

describe("cartesiaRealtimeSttUrl", () => {
  it("builds the Cartesia turn-detection websocket URL", () => {
    const url = new URL(cartesiaRealtimeSttUrl({
      provider: "cartesia",
      accessToken: "token-123",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai/",
      model: "ink-2",
      encoding: "pcm_s16le",
      sampleRate: 48_000,
      apiVersion: "2026-03-01",
    }));

    expect(url.origin).toBe("wss://api.cartesia.ai");
    expect(url.pathname).toBe("/stt/turns/websocket");
    expect(url.searchParams.get("model")).toBe("ink-2");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("sample_rate")).toBe("48000");
    expect(url.searchParams.get("cartesia_version")).toBe("2026-03-01");
    expect(url.searchParams.get("access_token")).toBe("token-123");
  });
});

describe("float32ToPcm16", () => {
  it("encodes clamped little-endian PCM16 samples", () => {
    const encoded = float32ToPcm16(new Float32Array([-2, -1, 0, 1, 2]));
    const view = new DataView(encoded);

    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(-32768);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(6, true)).toBe(32767);
    expect(view.getInt16(8, true)).toBe(32767);
  });
});
