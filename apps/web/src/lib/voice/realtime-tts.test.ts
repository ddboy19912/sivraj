import { describe, expect, it } from "vitest";
import { cartesiaRealtimeTtsUrl } from "@/lib/voice/realtime-tts";

describe("cartesiaRealtimeTtsUrl", () => {
  it("builds the Cartesia text-to-speech websocket URL", () => {
    const url = new URL(cartesiaRealtimeTtsUrl({
      provider: "cartesia",
      accessToken: "tts-token",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai/",
      model: "sonic-3.5",
      voiceId: "voice-123",
      language: "en",
      encoding: "pcm_s16le",
      sampleRate: 44_100,
      apiVersion: "2026-03-01",
    }));

    expect(url.origin).toBe("wss://api.cartesia.ai");
    expect(url.pathname).toBe("/tts/websocket");
    expect(url.searchParams.get("cartesia_version")).toBe("2026-03-01");
    expect(url.searchParams.get("access_token")).toBe("tts-token");
  });
});
