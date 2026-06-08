import { describe, expect, it } from "vitest";
import { parseChatExport } from "./chat-export.js";
import {
  run_parsechatexport_extracts_common_message_arrays_from_json_exports,
  run_parsechatexport_falls_back_to_readable_text_for_non_json_exports,
  run_parsechatexport_extracts_chatgpt_conversation_export_mappings,
  run_parsechatexport_extracts_claude_conversation_exports,
  run_parsechatexport_returns_an_empty_parse_result_for_empty_exports
} from "./chat-export.test-scenarios.js";

describe("parseChatExport", () => {
  it("extracts common message arrays from json exports", () => run_parsechatexport_extracts_common_message_arrays_from_json_exports());
});

describe("parseChatExport", () => {
  it("falls back to readable text for non-json exports", () => run_parsechatexport_falls_back_to_readable_text_for_non_json_exports());
});

describe("parseChatExport", () => {
  it("extracts ChatGPT conversation export mappings", () => run_parsechatexport_extracts_chatgpt_conversation_export_mappings());
});

describe("parseChatExport", () => {
  it("extracts Claude conversation exports", () => run_parsechatexport_extracts_claude_conversation_exports());
});

describe("parseChatExport", () => {
  it("returns an empty parse result for empty exports", () => run_parsechatexport_returns_an_empty_parse_result_for_empty_exports());
});
