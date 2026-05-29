import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

function readEnv() {
  return Object.fromEntries(
    readFileSync(new URL("../../.env", import.meta.url), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
        return [line.slice(0, index), value];
      }),
  );
}

const env = readEnv();
const serviceUrl = (env.VOICE_SERVICE_URL ?? "").replace(/\/+$/, "");
const apiKey = env.VOICE_SERVICE_API_KEY ?? "";

if (!serviceUrl) {
  throw new Error("VOICE_SERVICE_URL is missing from .env");
}

async function benchmark(label, text) {
  const sessionHash = `bench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = performance.now();
  const joinStarted = performance.now();
  const join = await fetch(`${serviceUrl}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: [text, "warm_operator", "en", "", 0, "", "", apiKey],
      event_data: null,
      fn_index: 0,
      trigger_id: 12,
      session_hash: sessionHash,
    }),
  });
  const joinMs = performance.now() - joinStarted;

  if (!join.ok) {
    throw new Error(`queue join failed ${join.status}: ${await join.text()}`);
  }

  const streamStarted = performance.now();
  const response = await fetch(
    `${serviceUrl}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
  );
  const body = await response.text();
  const streamMs = performance.now() - streamStarted;
  const totalMs = performance.now() - started;
  const events = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
  const estimation = events.find((event) => event.msg === "estimation");
  const completed = events.find((event) => event.msg === "process_completed");
  const output = completed?.output;
  const audio = output?.data?.[0] ?? output?.output ?? "";

  return {
    label,
    ok: completed?.success === true,
    totalMs: Math.round(totalMs),
    joinMs: Math.round(joinMs),
    streamMs: Math.round(streamMs),
    rank: estimation?.rank ?? null,
    queueSize: estimation?.queue_size ?? null,
    audioBase64Bytes: typeof audio === "string" ? audio.length : 0,
    error: completed?.success === false ? output?.error : undefined,
  };
}

const cases = [
  ["short-1", "Hello from Sivraj."],
  ["short-2", "Hello from Sivraj."],
  [
    "longer",
    "Hello from Sivraj. I am testing voice latency for a Jarvis style assistant response.",
  ],
];

for (const [label, text] of cases) {
  const result = await benchmark(label, text);
  console.log(JSON.stringify(result));
}
