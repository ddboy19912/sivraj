import { describe, expect, it } from "vitest";
import { extractInstructionCandidates } from "./index.js";
import {
  run_extracts_reusable_engineering_memories_with_safe_evidence_me,
  run_separates_project_conventions_from_global_user_preferences,
  run_accepts_explicit_broad_user_preferences_as_global_user_scope,
  run_extracts_plain_text_engineering_instructions_without_requiri,
  run_does_not_promote_normal_work_history_into_engineering_instru,
  run_does_not_turn_engineering_skill_facts_into_coding_preference,
  run_extracts_architecture_decisions_as_project_scoped_engineerin,
  run_extracts_recurring_engineering_bugs_without_inventing_root_c,
  run_extracts_project_conventions_and_style_rules_as_project_scop,
  run_extracts_deployment_environment_requirements_while_dropping_,
  run_extracts_security_boundaries_as_scoped_implementation_constr,
  run_rejects_malformed_or_non_engineering_extraction_rows,
  run_rejects_prompt_example_memories_without_source_evidence,
  run_extracts_repo_health_memories_deterministically_from_agent_w,
  run_extracts_review_copilot_memories_from_agent_writeback_user_c
} from "./extraction-test-scenarios.js";

describe("extractInstructionCandidates", () => {
it("extracts likely engineering instruction lines from markdown", () => {
    expect(extractInstructionCandidates(`
# Agent Rules

- Use rg before grep.
- Do not revert user changes.
- Run tests before final response.
- Nice weather today.
`)).toEqual([
      "Use rg before grep.",
      "Do not revert user changes.",
      "Run tests before final response.",
    ]);
  });

  it("finds plain written engineering instructions without explicit labels", () => {
    expect(extractInstructionCandidates(`
Today I want to add some notes.
When coding with me, always use pnpm and run focused tests before final response.
My secondary school story is not a coding rule.
In Sivraj, never store private memory plaintext in Postgres.
`)).toEqual([
      "When coding with me, always use pnpm and run focused tests before final response.",
      "In Sivraj, never store private memory plaintext in Postgres.",
    ]);
  });
});

describe("extractEngineeringMemories / extracts reusable engineering memories with safe e", () => {
  it("extracts reusable engineering memories with safe evidence metadata", () => run_extracts_reusable_engineering_memories_with_safe_evidence_me());
});

describe("extractEngineeringMemories / separates project conventions from global user pre", () => {
  it("separates project conventions from global user preferences", () => run_separates_project_conventions_from_global_user_preferences());
});

describe("extractEngineeringMemories / accepts explicit broad user preferences as global ", () => {
  it("accepts explicit broad user preferences as global user scope", () => run_accepts_explicit_broad_user_preferences_as_global_user_scope());
});

describe("extractEngineeringMemories / extracts plain text engineering instructions witho", () => {
  it("extracts plain text engineering instructions without requiring an instruction file", () => run_extracts_plain_text_engineering_instructions_without_requiri());
});

describe("extractEngineeringMemories / does not promote normal work history into engineer", () => {
  it("does not promote normal work history into engineering instructions", () => run_does_not_promote_normal_work_history_into_engineering_instru());
});

describe("extractEngineeringMemories / does not turn engineering skill facts into coding ", () => {
  it("does not turn engineering skill facts into coding preferences", () => run_does_not_turn_engineering_skill_facts_into_coding_preference());
});

describe("extractEngineeringMemories / extracts architecture decisions as project-scoped ", () => {
  it("extracts architecture decisions as project-scoped engineering memories", () => run_extracts_architecture_decisions_as_project_scoped_engineerin());
});

describe("extractEngineeringMemories / extracts recurring engineering bugs without invent", () => {
  it("extracts recurring engineering bugs without inventing root causes", () => run_extracts_recurring_engineering_bugs_without_inventing_root_c());
});

describe("extractEngineeringMemories / extracts project conventions and style rules as pr", () => {
  it("extracts project conventions and style rules as project-scoped memories", () => run_extracts_project_conventions_and_style_rules_as_project_scop());
});

describe("extractEngineeringMemories / extracts deployment environment requirements while", () => {
  it("extracts deployment environment requirements while dropping secret metadata", () => run_extracts_deployment_environment_requirements_while_dropping_());
});

describe("extractEngineeringMemories / extracts security boundaries as scoped implementat", () => {
  it("extracts security boundaries as scoped implementation constraints", () => run_extracts_security_boundaries_as_scoped_implementation_constr());
});

describe("extractEngineeringMemories / rejects malformed or non-engineering extraction ro", () => {
  it("rejects malformed or non-engineering extraction rows", () => run_rejects_malformed_or_non_engineering_extraction_rows());
});

describe("extractEngineeringMemories / rejects prompt examples without source evidence", () => {
  it("rejects prompt example memories without source evidence", () => run_rejects_prompt_example_memories_without_source_evidence());
});

describe("extractEngineeringMemories / extracts repo health memories deterministically fr", () => {
  it("extracts repo health memories deterministically from agent writebacks", () => run_extracts_repo_health_memories_deterministically_from_agent_w());
});

describe("extractEngineeringMemories / extracts review copilot memories from agent writeb", () => {
  it("extracts review copilot memories from agent writeback user corrections", () => run_extracts_review_copilot_memories_from_agent_writeback_user_c());
});
