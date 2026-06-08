import { performance } from "node:perf_hooks";

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

export function readBenchmarkAudioData(record) {
  if (Array.isArray(record.data)) {
    return record.data[0];
  }

  return record.output;
}

export function readBenchmarkAudio(output) {
  if (!isRecord(output)) {
    return "";
  }

  const audio = readBenchmarkAudioData(output);
  return typeof audio === "string" ? audio : "";
}

export function readBenchmarkOk(completed) {
  return completed?.success === true;
}

function readEstimationNumber(estimation, key) {
  const value = estimation?.[key];
  return value ?? null;
}

function hasBenchmarkFailure(completed) {
  return Boolean(completed && completed.success === false && completed.output);
}

function readFailedOutputError(completed) {
  if (!hasBenchmarkFailure(completed)) {
    return undefined;
  }

  return typeof completed.output.error === "string" ? completed.output.error : undefined;
}

export function buildBenchmarkSummary(estimation, completed, audio) {
  return {
    ok: readBenchmarkOk(completed),
    rank: readEstimationNumber(estimation, "rank"),
    queueSize: readEstimationNumber(estimation, "queue_size"),
    audioBase64Bytes: audio.length,
    error: readFailedOutputError(completed),
  };
}

export function summarizeBenchmark(estimation, completed) {
  return buildBenchmarkSummary(
    estimation,
    completed,
    readBenchmarkAudio(completed?.output),
  );
}

export function extractBenchmarkResult(events) {
  const estimation = events.find((event) => event.msg === "estimation");
  const completed = events.find((event) => event.msg === "process_completed");

  return summarizeBenchmark(estimation, completed);
}

async function joinGradioQueue(serviceUrl, sessionHash, text, apiKey) {
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

  return Math.round(joinMs);
}

async function readGradioStream(serviceUrl, sessionHash) {
  const streamStarted = performance.now();
  const response = await fetch(
    `${serviceUrl}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
  );
  const body = await response.text();
  const streamMs = performance.now() - streamStarted;

  return {
    events: parseGradioEvents(body),
    streamMs: Math.round(streamMs),
  };
}

function parseGradioEvents(body) {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
}

export async function benchmarkVoiceRequest(serviceUrl, label, text, apiKey) {
  const sessionHash = `bench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = performance.now();
  const joinMs = await joinGradioQueue(serviceUrl, sessionHash, text, apiKey);
  const { events, streamMs } = await readGradioStream(serviceUrl, sessionHash);
  const result = extractBenchmarkResult(events);

  return {
    label,
    ...result,
    totalMs: Math.round(performance.now() - started),
    joinMs,
    streamMs,
  };
}
