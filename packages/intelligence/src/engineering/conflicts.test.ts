import { describe, expect, it } from "vitest";
import {
  detectEngineeringInstructionIssues,
  type EngineeringInstructionRecord,
} from "./index.js";
import {
  run_detectengineeringins_detects_package_manager_conflicts,
  run_detectengineeringins_detects_frontend_framework_conflicts,
  run_detectengineeringins_detects_runtime_version_conflicts,
  run_detectengineeringins_detects_direct_use_avoid_contradictions,
  run_detectengineeringins_marks_expired_temporary_instructions_as_stale,
  run_detectengineeringins_marks_valid_until_expired_instructions_as_stale,
  run_detectengineeringins_does_not_compare_unrelated_project_scoped_rules_across_
} from "./conflicts.test-scenarios.js";

describe("detectEngineeringInstructionIssues", () => {
  it("detects package manager conflicts", () => run_detectengineeringins_detects_package_manager_conflicts());
});

describe("detectEngineeringInstructionIssues", () => {
  it("detects frontend framework conflicts", () => run_detectengineeringins_detects_frontend_framework_conflicts());
});

describe("detectEngineeringInstructionIssues", () => {
  it("detects runtime version conflicts", () => run_detectengineeringins_detects_runtime_version_conflicts());
});

describe("detectEngineeringInstructionIssues", () => {
  it("detects direct use/avoid contradictions", () => run_detectengineeringins_detects_direct_use_avoid_contradictions());
});

describe("detectEngineeringInstructionIssues", () => {
  it("marks expired temporary instructions as stale", () => run_detectengineeringins_marks_expired_temporary_instructions_as_stale());
});

describe("detectEngineeringInstructionIssues", () => {
  it("marks valid-until expired instructions as stale", () => run_detectengineeringins_marks_valid_until_expired_instructions_as_stale());
});

describe("detectEngineeringInstructionIssues", () => {
  it("does not compare unrelated project-scoped rules across projects", () => run_detectengineeringins_does_not_compare_unrelated_project_scoped_rules_across_());
});
