import { describe, expect, it } from "vitest";
import {
  buildBenchmarkSummary,
  extractBenchmarkResult,
  readBenchmarkAudio,
  readBenchmarkAudioData,
  readBenchmarkOk,
  summarizeBenchmark,
} from "./benchmark-helpers.mjs";

describe("benchmark result helpers", () => {
  it("reads audio from gradio output shapes", () => {
    expect(readBenchmarkAudioData({ data: ["audio-bytes"] })).toBe("audio-bytes");
    expect(readBenchmarkAudioData({ output: "fallback" })).toBe("fallback");
    expect(readBenchmarkAudio({ data: ["audio-bytes"] })).toBe("audio-bytes");
    expect(readBenchmarkAudio({ output: "fallback" })).toBe("fallback");
    expect(readBenchmarkAudio(null)).toBe("");
  });

  it("reads benchmark success flags", () => {
    expect(readBenchmarkOk({ success: true })).toBe(true);
    expect(readBenchmarkOk({ success: false })).toBe(false);
  });

  it("builds benchmark summaries from parts", () => {
    expect(buildBenchmarkSummary(
      { rank: 3, queue_size: 2 },
      { success: true },
      "audio",
    )).toEqual({
      ok: true,
      rank: 3,
      queueSize: 2,
      audioBase64Bytes: 5,
      error: undefined,
    });
  });

  it("summarizes completed gradio benchmark events", () => {
    expect(summarizeBenchmark(
      { rank: 1, queue_size: 0 },
      { success: true, output: { data: ["audio-bytes"] } },
    )).toEqual({
      ok: true,
      rank: 1,
      queueSize: 0,
      audioBase64Bytes: 11,
      error: undefined,
    });
  });

  it("captures benchmark failures", () => {
    expect(summarizeBenchmark(undefined, {
      success: false,
      output: { error: "synthesis_failed" },
    })).toEqual({
      ok: false,
      rank: null,
      queueSize: null,
      audioBase64Bytes: 0,
      error: "synthesis_failed",
    });
  });

  it("extracts benchmark results from event streams", () => {
    expect(extractBenchmarkResult([
      { msg: "estimation", rank: 2, queue_size: 1 },
      {
        msg: "process_completed",
        success: true,
        output: { data: ["audio"] },
      },
    ])).toEqual({
      ok: true,
      rank: 2,
      queueSize: 1,
      audioBase64Bytes: 5,
      error: undefined,
    });
  });
});
