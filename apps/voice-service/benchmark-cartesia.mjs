import { performance } from "node:perf_hooks";
import { readEnv } from "./benchmark-env.mjs";

const env = readEnv();
const apiKey = env.CARTESIA_API_KEY || env.VOICE_SERVICE_API_KEY;
const modelId = env.CARTESIA_MODEL_ID || "sonic-3.5";
const apiVersion = env.CARTESIA_VERSION || "2026-03-01";
const voiceId = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

if (!apiKey) {
  throw new Error("CARTESIA_API_KEY is missing from .env");
}

async function benchmark(label, transcript) {
  const started = performance.now();
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "cartesia-version": apiVersion,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model_id: modelId,
      transcript,
      voice: {
        mode: "id",
        id: voiceId,
      },
      output_format: {
        container: "wav",
        encoding: "pcm_f32le",
        sample_rate: 44_100,
      },
      language: "en",
      generation_config: {
        speed: 1,
        volume: 1,
      },
    }),
  });
  const audio = new Uint8Array(await response.arrayBuffer());
  const totalMs = performance.now() - started;

  console.log(JSON.stringify({
    label,
    ok: response.ok,
    status: response.status,
    totalMs: Math.round(totalMs),
    audioBytes: audio.byteLength,
    contentType: response.headers.get("content-type"),
  }));
}

await benchmark("short-1", "Hello from Sivraj.");
await benchmark("short-2", "Hello from Sivraj.");
await benchmark(
  "longer",
  "Hello from Sivraj. I am testing voice latency for a Jarvis style assistant response.",
);
