import { describe, expect, it } from "vitest";
import {
  buildCodingAgentContextPacket,
  buildCodingAgentContextExport,
  buildEngineeringProjectProfile,
  buildEngineeringInstructionPatch,
  formatCodingAgentContextMarkdown,
} from "./index.js";
import type { EngineeringProfileMemoryRecord } from "./profile.js";
import {
  run_buildengineeringproj_groups_engineering_memories_into_a_private_safe_project,
  run_buildengineeringproj_filters_rejected_memories_by_default_and_can_omit_candi,
  run_buildengineeringproj_keeps_secret_looking_metadata_out_of_the_profile,
  run_buildengineeringproj_records_warnings_for_memories_without_evidence_refs,
  run_buildcodingagentcont_builds_compact_agent_ready_context_from_active_and_appr,
  run_buildcodingagentcont_can_include_candidate_memories_and_filter_scope_for_a_n,
  run_buildcodingagentcont_dedupes_repeated_context_lines_and_gives_useful_fallbac,
  run_buildcodingagentcont_prioritizes_repo_matching_context_and_flags_conflicting,
  run_buildcodingagentcont_warns_when_filters_remove_all_usable_context,
  run_buildcodingagentcont_formats_a_private_safe_markdown_packet_for_coding_agent,
  run_buildcodingagentcont_builds_a_private_safe_agents_md_patch_from_approved_con,
  run_buildcodingagentcont_builds_cursor_and_generic_mcp_exports_from_the_same_sou
} from "./profile.test-scenarios.js";

describe("buildEngineeringProjectProfile", () => {
  it("groups engineering memories into a private-safe project profile", () => run_buildengineeringproj_groups_engineering_memories_into_a_private_safe_project());
});

describe("buildEngineeringProjectProfile", () => {
  it("filters rejected memories by default and can omit candidates", () => run_buildengineeringproj_filters_rejected_memories_by_default_and_can_omit_candi());
});

describe("buildEngineeringProjectProfile", () => {
  it("keeps secret-looking metadata out of the profile", () => run_buildengineeringproj_keeps_secret_looking_metadata_out_of_the_profile());
});

describe("buildEngineeringProjectProfile", () => {
  it("records warnings for memories without evidence refs", () => run_buildengineeringproj_records_warnings_for_memories_without_evidence_refs());
});

describe("buildCodingAgentContextPacket", () => {
  it("builds compact agent-ready context from active and approved profile entries", () => run_buildcodingagentcont_builds_compact_agent_ready_context_from_active_and_appr());
});

describe("buildCodingAgentContextPacket", () => {
  it("can include candidate memories and filter scope for a narrower packet", () => run_buildcodingagentcont_can_include_candidate_memories_and_filter_scope_for_a_n());
});

describe("buildCodingAgentContextPacket", () => {
  it("dedupes repeated context lines and gives useful fallback text for old candidates", () => run_buildcodingagentcont_dedupes_repeated_context_lines_and_gives_useful_fallbac());
});

describe("buildCodingAgentContextPacket", () => {
  it("prioritizes repo-matching context and flags conflicting instructions", () => run_buildcodingagentcont_prioritizes_repo_matching_context_and_flags_conflicting());
});

describe("buildCodingAgentContextPacket", () => {
  it("warns when filters remove all usable context", () => run_buildcodingagentcont_warns_when_filters_remove_all_usable_context());
});

describe("buildCodingAgentContextPacket", () => {
  it("formats a private-safe markdown packet for coding agents", () => run_buildcodingagentcont_formats_a_private_safe_markdown_packet_for_coding_agent());
});

describe("buildCodingAgentContextPacket", () => {
  it("builds a private-safe AGENTS.md patch from approved context", () => run_buildcodingagentcont_builds_a_private_safe_agents_md_patch_from_approved_con());
});

describe("buildCodingAgentContextPacket", () => {
  it("builds Cursor and generic MCP exports from the same source-backed context", () => run_buildcodingagentcont_builds_cursor_and_generic_mcp_exports_from_the_same_sou());
});
