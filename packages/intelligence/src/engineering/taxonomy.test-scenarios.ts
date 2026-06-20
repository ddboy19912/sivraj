import { expect } from "vitest";

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

export async function run_engineering_taxonomy_defines_stable_engineering_memory_categories() {
  expect(ENGINEERING_MEMORY_TYPES).toEqual([
      "user_skill",
      "coding_preference",
      "architecture_decision",
      "project_convention",
      "style_rule",
      "testing_practice",
      "deployment_environment",
      "security_boundary",
      "recurring_bug",
      "tool_preference",
      "agent_instruction",
    ]);
    expect(isEngineeringMemoryType("security_boundary")).toBe(true);
    expect(isEngineeringMemoryType("private_journal")).toBe(false);
}

export async function run_engineering_taxonomy_defines_instruction_scopes_and_lifecycle_states() {
  expect(ENGINEERING_INSTRUCTION_SCOPES).toEqual([
      "global_user",
      "project",
      "organization",
      "agent_specific",
      "temporary",
    ]);
    expect(ENGINEERING_INSTRUCTION_LIFECYCLES).toEqual([
      "candidate",
      "approved",
      "active",
      "superseded",
      "rejected",
    ]);
    expect(isEngineeringInstructionScope("project")).toBe(true);
    expect(isEngineeringInstructionScope("forever")).toBe(false);
    expect(isEngineeringInstructionLifecycle("candidate")).toBe(true);
    expect(isEngineeringInstructionLifecycle("deleted")).toBe(false);
}

export async function run_engineering_taxonomy_detects_known_agent_instruction_files_by_path() {
  expect(isAgentInstructionFile("CLAUDE.md")).toBe(true);
    expect(isAgentInstructionFile("AGENTS.md")).toBe(true);
    expect(isAgentInstructionFile("AGENT.md")).toBe(true);
    expect(isAgentInstructionFile("skills/sivraj/SKILL.md")).toBe(true);
    expect(isAgentInstructionFile(".cursorrules")).toBe(true);
    expect(isAgentInstructionFile(".cursor/rules/project.mdc")).toBe(true);
    expect(isAgentInstructionFile(".github/copilot-instructions.md")).toBe(true);
}

export async function run_engineering_taxonomy_does_not_treat_normal_repository_docs_as_agent_instruct() {
  expect(isAgentInstructionFile("README.md")).toBe(false);
    expect(isAgentInstructionFile("docs/ARCHITECTURE.md")).toBe(false);
    expect(isAgentInstructionFile("package.json")).toBe(false);
}

export async function run_engineering_taxonomy_classifies_engineering_source_kind_from_file_path() {
  expect(detectEngineeringSourceKind({ path: "CLAUDE.md" })).toMatchObject({
      sourceKind: "agent_instruction_file",
      matchedBy: "path",
      normalizedPath: "claude.md",
      isAgentInstructionFile: true,
    });
    expect(detectEngineeringSourceKind({ path: "docs/ARCHITECTURE.md" })).toMatchObject({
      sourceKind: "repo_documentation",
      matchedBy: "path",
      isAgentInstructionFile: false,
    });
    expect(detectEngineeringSourceKind({ path: "package.json" })).toMatchObject({
      sourceKind: "source_code_config",
      matchedBy: "path",
      isAgentInstructionFile: false,
    });
}

export async function run_engineering_taxonomy_classifies_engineering_source_kind_from_source_type_or_() {
  expect(detectEngineeringSourceKind({ sourceType: "github" })).toMatchObject({
      sourceKind: "github_import",
      matchedBy: "sourceType",
    });
    expect(detectEngineeringSourceKind({ sourceType: "voice_conversation" })).toMatchObject({
      sourceKind: "voice_conversation",
      matchedBy: "sourceType",
    });
    expect(detectEngineeringSourceKind({
      metadata: { engineeringSourceKind: "agent_instruction_file" },
    })).toMatchObject({
      sourceKind: "agent_instruction_file",
      matchedBy: "metadata",
    });
    expect(detectEngineeringSourceKind({
      sourceType: "note",
      metadata: { uploadKind: "agent_writeback", importer: "sivraj_agent_api" },
    })).toMatchObject({
      sourceKind: "agent_writeback",
      matchedBy: "metadata",
    });
}

export async function run_engineering_taxonomy_classifies_repo_instruction_files_as_project_scoped_by_() {
  expect(classifyEngineeringInstructionScope({
      instruction: "Use pnpm in this repo.",
      path: "AGENTS.md",
    })).toMatchObject({
      scope: "agent_specific",
      reason: "agent_specific_language_or_path",
      signals: ["agent_name_or_instruction_file"],
    });

    expect(classifyEngineeringInstructionScope({
      instruction: "Use pnpm in this repo.",
      path: "README.md",
    })).toMatchObject({
      scope: "project",
      reason: "project_source_default",
      signals: ["repo_documentation"],
    });
}

export async function run_engineering_taxonomy_classifies_explicit_user_preferences_as_global_user_sco() {
  expect(classifyEngineeringInstructionScope({
      instruction: "I prefer production-grade implementation over MVP shortcuts.",
      sourceType: "note",
    })).toMatchObject({
      scope: "global_user",
      reason: "global_user_preference_language",
      signals: ["first_person_preference"],
    });
}

export async function run_engineering_taxonomy_classifies_named_coding_agent_rules_as_agent_specific() {
  expect(classifyEngineeringInstructionScope({
      instruction: "Codex should run focused tests before final response.",
      sourceType: "note",
    })).toMatchObject({
      scope: "agent_specific",
      reason: "agent_specific_language_or_path",
      signals: ["agent_name_or_instruction_file"],
    });
}

export async function run_engineering_taxonomy_classifies_launch_phase_instructions_as_temporary_befor() {
  expect(classifyEngineeringInstructionScope({
      instruction: "For this launch week, prioritize speed over polish.",
      path: "README.md",
    })).toMatchObject({
      scope: "temporary",
      reason: "temporary_language",
      signals: ["temporary_phrase"],
    });
}

export async function run_engineering_taxonomy_classifies_team_wide_rules_as_organization_scope() {
  expect(classifyEngineeringInstructionScope({
      instruction: "Our engineering team requires security reviews before deploys.",
      sourceType: "chat_export",
    })).toMatchObject({
      scope: "organization",
      reason: "organization_or_team_language",
      signals: ["organization_phrase"],
    });
}

export async function run_engineering_taxonomy_honors_explicit_metadata_scope_override() {
  expect(classifyEngineeringInstructionScope({
      instruction: "Use pnpm in this repo.",
      metadata: { engineeringInstructionScope: "global_user" },
    })).toMatchObject({
      scope: "global_user",
      confidence: 0.95,
      reason: "metadata_scope",
      signals: ["metadata.engineeringInstructionScope"],
    });
}
