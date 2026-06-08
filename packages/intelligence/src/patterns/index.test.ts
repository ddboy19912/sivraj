import { describe, expect, it } from "vitest";
import { detectPatterns, type PatternSignal } from "./index.js";
import {
  run_detectpatterns_detects_repeated_goal_subjects_across_current_and_histo,
  run_detectpatterns_does_not_detect_a_pattern_from_one_isolated_signal,
  run_detectpatterns_detects_repeated_behavior_themes_across_different_proje,
  run_detectpatterns_detects_repeated_engineering_failure_themes,
  run_detectpatterns_keeps_pattern_output_free_of_private_statement_text
} from "./index.test-scenarios.js";

describe("detectPatterns", () => {
  it("detects repeated goal subjects across current and historical signals", () => run_detectpatterns_detects_repeated_goal_subjects_across_current_and_histo());
});

describe("detectPatterns", () => {
  it("does not detect a pattern from one isolated signal", () => run_detectpatterns_does_not_detect_a_pattern_from_one_isolated_signal());
});

describe("detectPatterns", () => {
  it("detects repeated behavior themes across different project subjects", () => run_detectpatterns_detects_repeated_behavior_themes_across_different_proje());
});

describe("detectPatterns", () => {
  it("detects repeated engineering failure themes", () => run_detectpatterns_detects_repeated_engineering_failure_themes());
});

describe("detectPatterns", () => {
  it("keeps pattern output free of private statement text", () => run_detectpatterns_keeps_pattern_output_free_of_private_statement_text());
});
