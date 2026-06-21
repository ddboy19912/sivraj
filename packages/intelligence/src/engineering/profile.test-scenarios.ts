import { expect } from "vitest";

import {
  buildCodingAgentContextPacket,
  buildCodingAgentContextExport,
  buildEngineeringProjectProfile,
  buildEngineeringInstructionPatch,
  formatCodingAgentContextMarkdown,
} from "./index.js";
import type { EngineeringProfileMemoryRecord } from "./profile.js";

const baseMemory: EngineeringProfileMemoryRecord = {
  id: "candidate-1",
  sourceArtifactId: "artifact-1",
  memoryFragmentId: "fragment-1",
  memoryType: "decision",
  engineeringMemoryType: "architecture_decision",
  scope: "project",
  subject: "Sivraj API",
  confidence: 0.9,
  status: "approved",
  evidenceHash: "evidence-hash-1",
  evidenceLength: 44,
  metadata: {
    sourceKind: "repo_documentation",
  },
};

export async function run_buildengineeringproj_groups_engineering_memories_into_a_private_safe_project() {
  const profile = buildEngineeringProjectProfile({
      projectId: "project-id",
      projectName: "Sivraj",
      now: new Date("2026-05-24T10:00:00.000Z"),
      memories: [
        baseMemory,
        {
          ...baseMemory,
          id: "candidate-2",
          memoryType: "project_update",
          engineeringMemoryType: "project_convention",
          subject: "Sivraj repo",
          evidenceHash: "evidence-hash-2",
          status: "candidate",
          metadata: {
            tool: "pnpm",
            statement: "This plaintext statement must not appear.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-3",
          memoryType: "decision",
          engineeringMemoryType: "security_boundary",
          subject: "Private memory storage",
          evidenceHash: "evidence-hash-3",
          status: "active",
          metadata: {
            boundary: "postgres_no_plaintext_private_memory",
          },
        },
      ],
    });

    expect(profile).toMatchObject({
      purpose: "engineering_project_profile",
      project: {
        id: "project-id",
        name: "Sivraj",
      },
      generatedAt: "2026-05-24T10:00:00.000Z",
      counts: {
        total: 3,
        byType: {
          architecture_decision: 1,
          project_convention: 1,
          security_boundary: 1,
        },
        byScope: {
          project: 3,
        },
        byStatus: {
          approved: 1,
          active: 1,
          candidate: 1,
        },
      },
    });
    expect(profile.categories.architectureDecisions).toHaveLength(1);
    expect(profile.categories.projectConventions).toHaveLength(1);
    expect(profile.categories.securityBoundaries).toHaveLength(1);
    expect(profile.evidence).toEqual([
      {
        candidateMemoryId: "candidate-1",
        sourceArtifactId: "artifact-1",
        memoryFragmentId: "fragment-1",
        evidenceHash: "evidence-hash-1",
        evidenceLength: 44,
      },
      {
        candidateMemoryId: "candidate-2",
        sourceArtifactId: "artifact-1",
        memoryFragmentId: "fragment-1",
        evidenceHash: "evidence-hash-2",
        evidenceLength: 44,
      },
      {
        candidateMemoryId: "candidate-3",
        sourceArtifactId: "artifact-1",
        memoryFragmentId: "fragment-1",
        evidenceHash: "evidence-hash-3",
        evidenceLength: 44,
      },
    ]);
    expect(JSON.stringify(profile)).not.toContain("plaintext statement");
}

export async function run_buildengineeringproj_filters_rejected_memories_by_default_and_can_omit_candi() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        baseMemory,
        {
          ...baseMemory,
          id: "candidate-rejected",
          status: "rejected",
          evidenceHash: "rejected-evidence",
        },
        {
          ...baseMemory,
          id: "candidate-candidate",
          status: "candidate",
          evidenceHash: "candidate-evidence",
        },
      ],
      includeCandidate: false,
    });

    expect(profile.counts.total).toBe(1);
    expect(profile.evidence.map((ref) => ref.candidateMemoryId)).toEqual(["candidate-1"]);
}

export async function run_buildengineeringproj_keeps_secret_looking_metadata_out_of_the_profile() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        {
          ...baseMemory,
          engineeringMemoryType: "deployment_environment",
          metadata: {
            variableNames: "DATABASE_URL,REDIS_URL,SUI_PRIVATE_KEY",
            connectionString: "postgresql://user:pass@localhost:5432/sivraj",
            secretValue: "suiprivkey1example",
            safeNote: "requires local Postgres and Redis",
          },
        },
      ],
    });

    expect(profile.categories.deploymentEnvironment[0]?.metadata).toEqual({
      variableNames: "DATABASE_URL,REDIS_URL,SUI_PRIVATE_KEY",
      safeNote: "requires local Postgres and Redis",
    });
    expect(JSON.stringify(profile)).not.toContain("suiprivkey1example");
    expect(JSON.stringify(profile)).not.toContain("user:pass");
}

export async function run_buildengineeringproj_records_warnings_for_memories_without_evidence_refs() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        {
          ...baseMemory,
          id: "",
        },
      ],
    });

    expect(profile.counts.total).toBe(0);
    expect(profile.warnings).toEqual(["engineering_profile_memory_missing_evidence_ref"]);
}

export async function run_buildcodingagentcont_builds_compact_agent_ready_context_from_active_and_appr() {
  const profile = buildEngineeringProjectProfile({
      projectId: "project-id",
      projectName: "Sivraj",
      now: new Date("2026-05-24T10:00:00.000Z"),
      memories: [
        baseMemory,
        {
          ...baseMemory,
          id: "candidate-security",
          engineeringMemoryType: "security_boundary",
          subject: "Private memory storage",
          status: "active",
          evidenceHash: "security-evidence",
          metadata: {
            boundary: "postgres_no_plaintext_private_memory",
          },
        },
        {
          ...baseMemory,
          id: "candidate-convention",
          engineeringMemoryType: "project_convention",
          memoryType: "project_update",
          subject: "Sivraj repo",
          status: "candidate",
          evidenceHash: "convention-evidence",
          metadata: {
            tool: "pnpm",
            statement: "Private text should not appear.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-agent",
          engineeringMemoryType: "agent_instruction",
          memoryType: "fact",
          scope: "agent_specific",
          subject: "git safety",
          status: "approved",
          evidenceHash: "agent-evidence",
          metadata: {
            agentContextLine: "Do not revert user changes unless explicitly requested.",
            extractor: "llm_structured_engineering_memory_extractor",
            model: "internal-model-name",
          },
        },
      ],
    });

    const packet = buildCodingAgentContextPacket({ profile });

    expect(packet).toMatchObject({
      purpose: "coding_agent_context",
      project: {
        id: "project-id",
        name: "Sivraj",
      },
      generatedAt: "2026-05-24T10:00:00.000Z",
      scope: {
        includeGlobalUser: true,
        includeProject: true,
        includeOrganization: true,
        includeAgentSpecific: true,
        includeTemporary: false,
      },
      counts: {
        totalItems: 3,
        evidenceRefs: 3,
      },
    });
    expect(packet.sections.architectureRules).toHaveLength(1);
    expect(packet.sections.securityBoundaries).toHaveLength(1);
    expect(packet.sections.projectConventions).toHaveLength(0);
    expect(packet.sections.agentInstructions).toHaveLength(1);
    expect(packet.sections.agentInstructions[0]).toMatchObject({
      agentContextLine: "Do not revert user changes unless explicitly requested.",
      metadata: {
        agentContextLine: "Do not revert user changes unless explicitly requested.",
      },
    });
    expect(packet.evidence.map((ref) => ref.candidateMemoryId)).toEqual([
      "candidate-1",
      "candidate-security",
      "candidate-agent",
    ]);
    expect(packet.quality).toMatchObject({
      readyForAgent: true,
      metrics: {
        totalItems: 3,
        approvedOrActiveItems: 3,
        candidateItems: 0,
        evidenceRefs: 3,
      },
    });
    expect(JSON.stringify(packet)).not.toContain("Private text should not appear");
    expect(JSON.stringify(packet)).not.toContain("internal-model-name");
}

export async function run_buildcodingagentcont_can_include_candidate_memories_and_filter_scope_for_a_n() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        baseMemory,
        {
          ...baseMemory,
          id: "candidate-global",
          engineeringMemoryType: "coding_preference",
          memoryType: "preference",
          scope: "global_user",
          subject: "frontend",
          status: "approved",
          evidenceHash: "global-evidence",
        },
        {
          ...baseMemory,
          id: "candidate-temporary",
          engineeringMemoryType: "agent_instruction",
          memoryType: "fact",
          scope: "temporary",
          subject: "current task",
          status: "approved",
          evidenceHash: "temporary-evidence",
        },
        {
          ...baseMemory,
          id: "candidate-style",
          engineeringMemoryType: "style_rule",
          memoryType: "preference",
          scope: "project",
          subject: "UI",
          status: "candidate",
          evidenceHash: "style-evidence",
        },
      ],
    });

    const packet = buildCodingAgentContextPacket({
      profile,
      includeCandidate: true,
      scope: {
        includeGlobalUser: false,
        includeTemporary: true,
      },
    });

    expect(packet.sections.userPreferences).toHaveLength(0);
    expect(packet.sections.styleRules).toHaveLength(1);
    expect(packet.sections.agentInstructions).toHaveLength(1);
    expect(packet.evidence.map((ref) => ref.candidateMemoryId)).toEqual([
      "candidate-1",
      "candidate-style",
      "candidate-temporary",
    ]);
}

export async function run_buildcodingagentcont_dedupes_repeated_context_lines_and_gives_useful_fallbac() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        {
          ...baseMemory,
          id: "candidate-pnpm",
          engineeringMemoryType: "tool_preference",
          memoryType: "preference",
          scope: "agent_specific",
          subject: "pnpm",
          status: "candidate",
          evidenceHash: "pnpm-evidence",
        },
        {
          ...baseMemory,
          id: "candidate-next-1",
          engineeringMemoryType: "project_convention",
          memoryType: "project_update",
          scope: "agent_specific",
          subject: "Next.js",
          status: "candidate",
          evidenceHash: "next-evidence-1",
          metadata: {
            agentContextLine: "Consult local Next.js docs before writing code.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-next-2",
          engineeringMemoryType: "project_convention",
          memoryType: "project_update",
          scope: "agent_specific",
          subject: "Next.js",
          status: "candidate",
          evidenceHash: "next-evidence-2",
          metadata: {
            agentContextLine: "Consult local Next.js docs before writing code.",
          },
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({ profile, includeCandidate: true });

    expect(packet.sections.userPreferences).toHaveLength(1);
    expect(packet.sections.userPreferences[0]?.agentContextLine).toBe(
      "Use pnpm when this project or task calls for that tool.",
    );
    expect(packet.sections.projectConventions).toHaveLength(1);

    const markdown = formatCodingAgentContextMarkdown(packet);
    expect(markdown.match(/Consult local Next\.js docs before writing code\./g)).toHaveLength(1);
    expect(markdown).toContain("## Apply These Rules");
    expect(markdown).toContain("Use pnpm when this project or task calls for that tool.");
    expect(markdown).not.toContain("## User Coding Preferences");
}

export async function run_buildcodingagentcont_prioritizes_repo_matching_context_and_flags_conflicting() {
  const profile = buildEngineeringProjectProfile({
      projectName: "Sivraj",
      repoFingerprint: {
        repoName: "sivraj",
        packageName: "sivraj",
        packageManager: "pnpm",
        frameworks: ["vite", "react"],
      },
      memories: [
        {
          ...baseMemory,
          id: "candidate-vite",
          engineeringMemoryType: "project_convention",
          memoryType: "project_update",
          scope: "agent_specific",
          subject: "Vite",
          status: "candidate",
          evidenceHash: "vite-evidence",
          metadata: {
            sourceKind: "agent_instruction_file",
            repoName: "sivraj",
            packageName: "sivraj",
            packageManager: "pnpm",
            framework: "vite",
            agentContextLine: "Use pnpm and Vite React patterns for the Sivraj web app.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-next",
          engineeringMemoryType: "project_convention",
          memoryType: "project_update",
          scope: "agent_specific",
          subject: "Next.js",
          status: "candidate",
          evidenceHash: "next-evidence",
          metadata: {
            sourceKind: "agent_instruction_file",
            repoName: "old-next-app",
            framework: "next.js",
            agentContextLine: "Use Next.js app router patterns for this project.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-npm",
          engineeringMemoryType: "tool_preference",
          memoryType: "preference",
          scope: "agent_specific",
          subject: "npm",
          status: "candidate",
          evidenceHash: "npm-evidence",
          metadata: {
            sourceKind: "manual_note",
            agentContextLine: "Use npm for package management.",
          },
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({ profile, includeCandidate: true });

    expect(packet.project.repoFingerprint).toMatchObject({
      repoName: "sivraj",
      packageName: "sivraj",
      packageManager: "pnpm",
      frameworks: ["vite", "react"],
    });
    expect(packet.sections.projectConventions[0]?.id).toBe("candidate-vite");
    expect(packet.warnings).toContain("context_conflict:frontend_framework_conflict");
    expect(packet.warnings).toContain("context_conflict:package_manager_conflict");
    expect(packet.warnings).toContain(`context_quality:${packet.quality.label}`);
    expect(packet.quality.readyForAgent).toBe(false);
    expect(
      buildCodingAgentContextExport(packet).warnings.some((warning) => warning.startsWith("context_quality:")),
    ).toBe(false);
    expect(packet.quality.risks).toContain("Conflicting or stale context issues were detected.");
    expect(packet.issues.map((issue) => issue.reason)).toEqual(
      expect.arrayContaining(["frontend_framework_conflict", "package_manager_conflict"]),
    );
}

export async function run_buildcodingagentcont_warns_when_filters_remove_all_usable_context() {
  const profile = buildEngineeringProjectProfile({
      memories: [
        {
          ...baseMemory,
          scope: "temporary",
          status: "approved",
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({
      profile,
      scope: {
        includeProject: false,
        includeTemporary: false,
      },
    });

    expect(packet.counts.totalItems).toBe(0);
    expect(packet.warnings).toContain("coding_agent_context_packet_empty");
    expect(packet.quality).toMatchObject({
      label: "risky",
      readyForAgent: false,
      metrics: {
        totalItems: 0,
      },
    });
}

export async function run_buildcodingagentcont_formats_a_private_safe_markdown_packet_for_coding_agent() {
  const profile = buildEngineeringProjectProfile({
      projectName: "Sivraj",
      now: new Date("2026-05-24T10:00:00.000Z"),
      memories: [
        {
          ...baseMemory,
          engineeringMemoryType: "agent_instruction",
          scope: "agent_specific",
          subject: "git safety",
          status: "approved",
          metadata: {
            sourceKind: "agent_instruction_file",
            source_file: "agents.md",
            statement: "Do not leak this raw statement.",
          },
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({ profile });

    const markdown = formatCodingAgentContextMarkdown(packet);

    expect(markdown).toContain("# Sivraj Coding Agent Context");
    expect(markdown).toContain("## Apply These Rules");
    expect(markdown).toContain("## Context Quality");
    expect(markdown).toContain("Apply the source-backed agent instruction for git safety.");
    expect(markdown).toContain("Evidence: candidate-1");
    expect(markdown).not.toContain("Do not leak this raw statement");
}

export async function run_buildcodingagentcont_builds_a_private_safe_agents_md_patch_from_approved_con() {
  const profile = buildEngineeringProjectProfile({
      projectName: "Sivraj",
      repoFingerprint: {
        repoName: "sivraj",
        packageManager: "pnpm",
        frameworks: ["vite", "react"],
      },
      memories: [
        {
          ...baseMemory,
          engineeringMemoryType: "agent_instruction",
          scope: "agent_specific",
          subject: "git safety",
          status: "approved",
          metadata: {
            sourceKind: "agent_instruction_file",
            agentContextLine: "Do not revert user changes unless explicitly requested.",
            statement: "Raw source statement must not appear.",
          },
        },
        {
          ...baseMemory,
          id: "candidate-only",
          engineeringMemoryType: "tool_preference",
          memoryType: "preference",
          subject: "pnpm",
          status: "candidate",
          evidenceHash: "candidate-only-evidence",
          metadata: {
            agentContextLine: "Use pnpm for package management.",
          },
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({ profile, includeCandidate: true });
    const patch = buildEngineeringInstructionPatch(packet);

    expect(patch).toMatchObject({
      targetFile: "AGENTS.md",
      operation: "create_or_replace",
      includedCandidate: false,
      itemCount: 1,
    });
    expect(patch.suggestedMarkdown).toContain("# Agent Instructions");
    expect(patch.suggestedMarkdown).toContain("Do not revert user changes unless explicitly requested.");
    expect(patch.suggestedMarkdown).not.toContain("Evidence:");
    expect(patch.suggestedMarkdown).not.toContain("Evidence Map");
    expect(patch.suggestedMarkdown).not.toContain("Sivraj quality");
    expect(patch.suggestedMarkdown).not.toContain("candidate-1");
    expect(patch.suggestedMarkdown).not.toContain("Use pnpm for package management.");
    expect(patch.suggestedMarkdown).not.toContain("Raw source statement");
    expect(patch.evidence.map((ref) => ref.candidateMemoryId)).toEqual(["candidate-1"]);
}

export async function run_buildcodingagentcont_builds_cursor_and_generic_mcp_exports_from_the_same_sou() {
  const profile = buildEngineeringProjectProfile({
      projectName: "Sivraj",
      repoFingerprint: {
        repoName: "sivraj",
        packageManager: "pnpm",
        frameworks: ["vite", "react"],
      },
      memories: [
        {
          ...baseMemory,
          engineeringMemoryType: "agent_instruction",
          scope: "agent_specific",
          subject: "git safety",
          status: "approved",
          metadata: {
            sourceKind: "agent_instruction_file",
            agentContextLine: "Do not revert user changes unless explicitly requested.",
            statement: "Raw source statement must not appear.",
          },
        },
      ],
    });
    const packet = buildCodingAgentContextPacket({ profile });
    const cursorExport = buildCodingAgentContextExport(packet, { preset: "cursor" });
    const mcpExport = buildCodingAgentContextExport(packet, { preset: "generic_mcp" });

    expect(cursorExport).toMatchObject({
      preset: "cursor",
      format: "mdc",
      targetFile: ".cursor/rules/sivraj.mdc",
      itemCount: 1,
    });
    expect(cursorExport.content).toContain("alwaysApply: true");
    expect(cursorExport.content).toContain("Do not revert user changes unless explicitly requested.");
    expect(cursorExport.content).not.toContain("Evidence:");
    expect(cursorExport.content).not.toContain("## Evidence");
    expect(cursorExport.content).not.toContain("Sivraj quality");
    expect(cursorExport.content).not.toContain("candidate-1");
    expect(cursorExport.content).not.toContain("Raw source statement");

    expect(mcpExport).toMatchObject({
      preset: "generic_mcp",
      format: "json",
      targetFile: "sivraj-context.json",
      itemCount: 1,
    });
    const parsed = JSON.parse(mcpExport.content) as { rules: Array<{ line: string }> };
    expect(parsed.rules[0]?.line).toBe("Do not revert user changes unless explicitly requested.");
    expect(mcpExport.content).not.toContain("\"quality\"");
    expect(mcpExport.content).not.toContain("\"evidence\"");
    expect(mcpExport.content).not.toContain("context_quality:");
    expect(mcpExport.content).not.toContain("candidate-1");
    expect(mcpExport.content).not.toContain("Raw source statement");
}
