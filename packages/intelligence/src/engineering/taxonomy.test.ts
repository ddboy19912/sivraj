import { describe, expect, it } from "vitest";
import {
  ENGINEERING_INSTRUCTION_LIFECYCLES,
  ENGINEERING_INSTRUCTION_SCOPES,
  ENGINEERING_MEMORY_TYPES,
  classifyEngineeringInstructionScope,
  detectEngineeringSourceKind,
  isAgentInstructionFile,
  isEngineeringInstructionLifecycle,
  isEngineeringInstructionScope,
  isEngineeringMemoryType,
} from "./index.js";
import {
  run_engineering_taxonomy_defines_stable_engineering_memory_categories,
  run_engineering_taxonomy_defines_instruction_scopes_and_lifecycle_states,
  run_engineering_taxonomy_detects_known_agent_instruction_files_by_path,
  run_engineering_taxonomy_does_not_treat_normal_repository_docs_as_agent_instruct,
  run_engineering_taxonomy_classifies_engineering_source_kind_from_file_path,
  run_engineering_taxonomy_classifies_engineering_source_kind_from_source_type_or_,
  run_engineering_taxonomy_classifies_repo_instruction_files_as_project_scoped_by_,
  run_engineering_taxonomy_classifies_explicit_user_preferences_as_global_user_sco,
  run_engineering_taxonomy_classifies_named_coding_agent_rules_as_agent_specific,
  run_engineering_taxonomy_classifies_launch_phase_instructions_as_temporary_befor,
  run_engineering_taxonomy_classifies_team_wide_rules_as_organization_scope,
  run_engineering_taxonomy_honors_explicit_metadata_scope_override
} from "./taxonomy.test-scenarios.js";

describe("engineering taxonomy", () => {
  it("defines stable engineering memory categories", () => run_engineering_taxonomy_defines_stable_engineering_memory_categories());
});

describe("engineering taxonomy", () => {
  it("defines instruction scopes and lifecycle states", () => run_engineering_taxonomy_defines_instruction_scopes_and_lifecycle_states());
});

describe("engineering taxonomy", () => {
  it("detects known agent instruction files by path", () => run_engineering_taxonomy_detects_known_agent_instruction_files_by_path());
});

describe("engineering taxonomy", () => {
  it("does not treat normal repository docs as agent instruction files", () => run_engineering_taxonomy_does_not_treat_normal_repository_docs_as_agent_instruct());
});

describe("engineering taxonomy", () => {
  it("classifies engineering source kind from file path", () => run_engineering_taxonomy_classifies_engineering_source_kind_from_file_path());
});

describe("engineering taxonomy", () => {
  it("classifies engineering source kind from source type or metadata", () => run_engineering_taxonomy_classifies_engineering_source_kind_from_source_type_or_());
});

describe("engineering taxonomy", () => {
  it("classifies repo instruction files as project-scoped by default", () => run_engineering_taxonomy_classifies_repo_instruction_files_as_project_scoped_by_());
});

describe("engineering taxonomy", () => {
  it("classifies explicit user preferences as global user scope", () => run_engineering_taxonomy_classifies_explicit_user_preferences_as_global_user_sco());
});

describe("engineering taxonomy", () => {
  it("classifies named coding-agent rules as agent-specific", () => run_engineering_taxonomy_classifies_named_coding_agent_rules_as_agent_specific());
});

describe("engineering taxonomy", () => {
  it("classifies launch-phase instructions as temporary before broader defaults", () => run_engineering_taxonomy_classifies_launch_phase_instructions_as_temporary_befor());
});

describe("engineering taxonomy", () => {
  it("classifies team-wide rules as organization scope", () => run_engineering_taxonomy_classifies_team_wide_rules_as_organization_scope());
});

describe("engineering taxonomy", () => {
  it("honors explicit metadata scope override", () => run_engineering_taxonomy_honors_explicit_metadata_scope_override());
});
