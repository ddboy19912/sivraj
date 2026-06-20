import { expect } from "vitest";
import { extractEngineeringMemories } from "./index.js";

function agentWritebackInput(content: string) {
  return {
    twinId: "twin-id",
    sourceArtifactId: "artifact-id",
    memoryFragmentId: "fragment-id",
    sourceType: "note" as const,
    content,
    metadata: {
      uploadKind: "agent_writeback",
      importer: "sivraj_agent_api",
      agentName: "Codex",
      repo: "sivraj",
    },
  };
}

function emptyExtractionGenerator() {
  return {
    generator: {
      async generateJson() {
        return {
          provider: "openrouter",
          model: "google/gemini-2.5-flash-lite",
          json: { memories: [] },
        };
      },
    },
  };
}

export async function run_extracts_reusable_engineering_memories_with_safe_evidence_me() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "CLAUDE.md",
        content: [
          "Use rg before grep.",
          "Do not revert user changes.",
          "Run tests before final response.",
        ].join("\n"),
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "Coding agents should use rg before grep for repository search.",
                    type: "tool_preference",
                    scope: "global_user",
                    subject: "rg",
                    confidence: 0.9,
                    evidence: "Use rg before grep.",
                    metadata: { category: "repo_search", evidenceText: "must not persist" },
                  },
                  {
                    statement: "Coding agents should not revert user changes unless explicitly asked.",
                    type: "agent_instruction",
                    scope: "agent_specific",
                    subject: "git safety",
                    confidence: 0.92,
                    evidence: "Do not revert user changes.",
                    metadata: { category: "git_safety" },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Do not turn repo-local rules into global user preferences");
    expect(prompt).toContain("Use rg before grep.");
    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toMatchObject({
      statement: "Coding agents should not revert user changes unless explicitly asked.",
      engineeringMemoryType: "agent_instruction",
      scope: "agent_specific",
      subject: "git safety",
      evidenceLength: "Do not revert user changes.".length,
      metadata: {
        category: "git_safety",
        agentContextLine: "Coding agents should not revert user changes unless explicitly asked.",
        sourceKind: "agent_instruction_file",
      },
    });
    expect(result.memories[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.memories)).not.toContain("must not persist");
    expect(result.metadata).toMatchObject({
      extractor: "llm_structured_engineering_memory_extractor",
      provider: "openrouter",
      model: "google/gemini-2.5-flash-lite",
      sourceKind: "agent_instruction_file",
      candidateInstructionCount: 3,
      returnedMemories: 2,
      acceptedMemories: 2,
    });
}

export async function run_separates_project_conventions_from_global_user_preferences() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "README.md",
        content: "This repo uses Hono for API routes and Drizzle for schema.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "This project uses Hono for API routes.",
                    type: "project_convention",
                    scope: "project",
                    subject: "Hono",
                    confidence: 0.88,
                    evidence: "This repo uses Hono for API routes",
                    metadata: {},
                  },
                  {
                    statement: "The user prefers Drizzle for database schema.",
                    type: "tool_preference",
                    scope: "global_user",
                    subject: "Drizzle",
                    confidence: 0.7,
                    evidence: "Drizzle for schema",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "project_convention",
      scope: "project",
      subject: "Hono",
    });
    expect(result.metadata.warnings).toContain("engineering_memory_insufficient_engineering_signal");
}

export async function run_accepts_explicit_broad_user_preferences_as_global_user_scope() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "I prefer Vite React over Next.js when the API is standalone.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "The user prefers Vite React over Next.js when the API is standalone.",
                    type: "coding_preference",
                    scope: "global_user",
                    subject: "Vite React",
                    confidence: 0.9,
                    evidence: "I prefer Vite React over Next.js when the API is standalone.",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "coding_preference",
      scope: "global_user",
      subject: "Vite React",
    });
}

export async function run_extracts_plain_text_engineering_instructions_without_requiri() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "When coding with me, always use pnpm and run focused tests before final response.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "The user wants coding agents to use pnpm and run focused tests before final response.",
                    type: "agent_instruction",
                    scope: "global_user",
                    subject: "coding agent workflow",
                    confidence: 0.91,
                    evidence: "When coding with me, always use pnpm and run focused tests before final response.",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "agent_instruction",
      scope: "global_user",
      subject: "coding agent workflow",
      metadata: {
        agentContextLine: "The user wants coding agents to use pnpm and run focused tests before final response.",
        sourceKind: "manual_note",
      },
    });
    expect(result.metadata).toMatchObject({
      sourceKind: "manual_note",
      candidateInstructionCount: 1,
      acceptedMemories: 1,
    });
}

export async function run_does_not_promote_normal_work_history_into_engineering_instru() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "I worked with Polytope Labs on Hyperbridge.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "Coding agents should remember that the user worked with Polytope Labs on Hyperbridge.",
                    type: "agent_instruction",
                    scope: "global_user",
                    subject: "Polytope Labs",
                    confidence: 0.86,
                    evidence: "I worked with Polytope Labs on Hyperbridge.",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toEqual([]);
    expect(result.metadata).toMatchObject({
      sourceKind: "manual_note",
      candidateInstructionCount: 0,
      acceptedMemories: 0,
    });
    expect(result.metadata.warnings).toContain("engineering_memory_insufficient_engineering_signal");
}

export async function run_does_not_turn_engineering_skill_facts_into_coding_preference() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "I used TypeScript, React, Sui, Walrus, and Seal on Hyperbridge.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "The user prefers TypeScript, React, Sui, Walrus, and Seal.",
                    type: "coding_preference",
                    scope: "global_user",
                    subject: "TypeScript",
                    confidence: 0.82,
                    evidence: "I used TypeScript, React, Sui, Walrus, and Seal on Hyperbridge.",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toEqual([]);
    expect(result.metadata.warnings).toContain("engineering_memory_insufficient_engineering_signal");
}

export async function run_extracts_architecture_decisions_as_project_scoped_engineerin() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "docs/architecture.md",
        content: "We decided to use Vite React instead of Next.js because the API is standalone.",
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "This project chose Vite React over Next.js because the API is standalone.",
                    type: "architecture_decision",
                    scope: "project",
                    subject: "Vite React",
                    confidence: 0.93,
                    evidence: "We decided to use Vite React instead of Next.js because the API is standalone.",
                    metadata: {
                      chosen: "Vite React",
                      rejected: "Next.js",
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Use architecture_decision when the source says");
    expect(prompt).toContain("We decided to use Vite React instead of Next.js");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      statement: "This project chose Vite React over Next.js because the API is standalone.",
      engineeringMemoryType: "architecture_decision",
      scope: "project",
      subject: "Vite React",
      metadata: {
        chosen: "Vite React",
        rejected: "Next.js",
        sourceKind: "repo_documentation",
      },
    });
    expect(result.metadata).toMatchObject({
      sourceKind: "repo_documentation",
      candidateInstructionCount: 1,
      acceptedMemories: 1,
    });
}

export async function run_extracts_recurring_engineering_bugs_without_inventing_root_c() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "chat_export",
        content: "Walrus/Seal reads keep failing with RpcError: fetch failed during private memory decrypt. We have seen this twice this week.",
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "Walrus/Seal private-memory reads repeatedly fail with RpcError fetch failed during decrypt.",
                    type: "recurring_bug",
                    scope: "project",
                    subject: "Walrus/Seal private-memory reads",
                    confidence: 0.9,
                    evidence: "Walrus/Seal reads keep failing with RpcError: fetch failed during private memory decrypt.",
                    metadata: {
                      symptom: "RpcError fetch failed",
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Use recurring_bug when the source describes repeated failures");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "recurring_bug",
      scope: "project",
      subject: "Walrus/Seal private-memory reads",
      metadata: {
        symptom: "RpcError fetch failed",
        sourceKind: "chat_conversation",
      },
    });
    expect(JSON.stringify(result.memories)).not.toContain("twice this week");
}

export async function run_extracts_project_conventions_and_style_rules_as_project_scop() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "CONTRIBUTING.md",
        content: [
          "This repo uses pnpm workspace commands for all package scripts.",
          "API routes should live in Hono route modules.",
          "Keep UI cards at 8px radius or less.",
        ].join("\n"),
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "This project uses pnpm workspace commands for package scripts.",
                    type: "project_convention",
                    scope: "project",
                    subject: "Sivraj repo",
                    confidence: 0.88,
                    evidence: "This repo uses pnpm workspace commands for all package scripts.",
                    metadata: {
                      tool: "pnpm",
                    },
                  },
                  {
                    statement: "This project keeps UI cards at 8px radius or less.",
                    type: "style_rule",
                    scope: "project",
                    subject: "Sivraj UI",
                    confidence: 0.84,
                    evidence: "Keep UI cards at 8px radius or less.",
                    metadata: {
                      area: "ui",
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Use project_convention when the source describes");
    expect(prompt).toContain("Use style_rule when the source describes");
    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "project_convention",
      scope: "project",
      subject: "Sivraj repo",
      metadata: {
        tool: "pnpm",
        sourceKind: "repo_documentation",
      },
    });
    expect(result.memories[1]).toMatchObject({
      engineeringMemoryType: "style_rule",
      scope: "project",
      subject: "Sivraj UI",
      metadata: {
        area: "ui",
        sourceKind: "repo_documentation",
      },
    });
}

export async function run_extracts_deployment_environment_requirements_while_dropping_() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: ".env.example",
        content: [
          "DATABASE_URL=postgresql://user:pass@localhost:5432/sivraj",
          "REDIS_URL=redis://localhost:6379",
          "SUI_PRIVATE_KEY=suiprivkey1example",
          "TOKEN_ISSUER=sivraj",
        ].join("\n"),
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "The Sivraj local API/worker environment requires DATABASE_URL, REDIS_URL, SUI_PRIVATE_KEY, and TOKEN_ISSUER to be configured.",
                    type: "deployment_environment",
                    scope: "project",
                    subject: "Sivraj local environment",
                    confidence: 0.9,
                    evidence: "DATABASE_URL=... REDIS_URL=... SUI_PRIVATE_KEY=... TOKEN_ISSUER=sivraj",
                    metadata: {
                      variableNames: "DATABASE_URL,REDIS_URL,SUI_PRIVATE_KEY,TOKEN_ISSUER",
                      secretValue: "suiprivkey1example",
                      connectionString: "postgresql://user:pass@localhost:5432/sivraj",
                      safeNote: "requires local Postgres and Redis",
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Use deployment_environment when the source describes");
    expect(prompt).toContain("Never copy secret values");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "deployment_environment",
      scope: "project",
      subject: "Sivraj local environment",
      metadata: {
        variableNames: "DATABASE_URL,REDIS_URL,SUI_PRIVATE_KEY,TOKEN_ISSUER",
        safeNote: "requires local Postgres and Redis",
        sourceKind: "source_code_config",
      },
    });
    expect(JSON.stringify(result.memories)).not.toContain("suiprivkey1example");
    expect(JSON.stringify(result.memories)).not.toContain("user:pass");
}

export async function run_extracts_security_boundaries_as_scoped_implementation_constr() {
  let prompt = "";
    const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "docs/SECURITY.md",
        content: [
          "Private memory content must not be stored in Postgres.",
          "Postgres stores refs, hashes, audit, metadata, and graph records only.",
          "Never log plaintext memory or secrets.",
        ].join("\n"),
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;

            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  {
                    statement: "Sivraj private memory content must not be stored in Postgres.",
                    type: "security_boundary",
                    scope: "project",
                    subject: "Sivraj private memory storage",
                    confidence: 0.96,
                    evidence: "Private memory content must not be stored in Postgres.",
                    metadata: {
                      boundary: "postgres_no_plaintext_private_memory",
                      plaintextExample: "my secret diary",
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("Use security_boundary when the source describes");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      engineeringMemoryType: "security_boundary",
      scope: "project",
      subject: "Sivraj private memory storage",
      metadata: {
        boundary: "postgres_no_plaintext_private_memory",
        sourceKind: "github_import",
      },
    });
    expect(JSON.stringify(result.memories)).not.toContain("my secret diary");
}

export async function run_rejects_malformed_or_non_engineering_extraction_rows() {
  const result = await extractEngineeringMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "github",
        path: "README.md",
        content: "Welcome to the repo.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openrouter",
              model: "google/gemini-2.5-flash-lite",
              json: {
                memories: [
                  { statement: "Missing evidence", type: "project_convention", confidence: 0.8 },
                  {
                    statement: "Bad type",
                    type: "mood",
                    scope: "project",
                    evidence: "Bad type",
                    confidence: 0.8,
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toEqual([]);
    expect(result.metadata.warnings).toContain("engineering_memory_missing_required_fields");
}

export async function run_extracts_repo_health_memories_deterministically_from_agent_w() {
  const result = await extractEngineeringMemories(
      agentWritebackInput([
        "# Coding Agent Writeback",
        "",
        "Agent: Codex",
        "Repo: sivraj",
        "",
        "## Commands Run",
        "- pnpm build failed until Redis was running locally.",
        "",
        "## Tests Run",
        "- pnpm --filter @sivraj/api test",
        "- pnpm check failed with missing DATABASE_URL.",
        "",
        "## Bugs Found",
        "- Memory search decrypt was slow when too many encrypted fragments were selected.",
        "",
        "## Follow Ups",
        "- Add a CI note for Docker Postgres and Redis startup.",
      ].join("\n")),
      emptyExtractionGenerator(),
    );

    expect(result.metadata).toMatchObject({
      sourceKind: "agent_writeback",
      acceptedMemories: 5,
    });
    expect(result.memories.map((memory) => memory.engineeringMemoryType)).toEqual([
      "recurring_bug",
      "recurring_bug",
      "deployment_environment",
      "testing_practice",
      "deployment_environment",
    ]);
    expect(result.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          engineeringMemoryType: "recurring_bug",
          scope: "project",
          subject: "sivraj",
          metadata: expect.objectContaining({
            category: "repo_health",
            sourceKind: "agent_writeback",
            signal: "bug_found",
            agentContextLine: expect.stringContaining("Memory search decrypt was slow"),
          }),
        }),
        expect.objectContaining({
          engineeringMemoryType: "testing_practice",
          metadata: expect.objectContaining({
            signal: "test_command",
            agentContextLine: "Use this source-backed verification step when relevant: pnpm --filter @sivraj/api test",
          }),
        }),
      ]),
    );
}

export async function run_extracts_review_copilot_memories_from_agent_writeback_user_c() {
  const result = await extractEngineeringMemories(
      agentWritebackInput([
        "# Coding Agent Writeback",
        "",
        "Agent: Codex",
        "Repo: sivraj",
        "",
        "## User Corrections",
        "- User wants exact root-cause fixes, not just retries or fallbacks.",
        "- User flags plaintext private memory leaks aggressively.",
        "- User expects focused tests and a precise test plan before handoff.",
        "- User dislikes vague MVP language for frontier product work.",
      ].join("\n")),
      emptyExtractionGenerator(),
    );

    expect(result.metadata).toMatchObject({
      sourceKind: "agent_writeback",
      acceptedMemories: 4,
    });
    expect(result.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          engineeringMemoryType: "security_boundary",
          scope: "agent_specific",
          subject: "review security standard",
          metadata: expect.objectContaining({
            category: "review_copilot",
            signal: "user_correction",
            agentContextLine: "Respect this user review security standard: User flags plaintext private memory leaks aggressively.",
          }),
        }),
        expect.objectContaining({
          engineeringMemoryType: "testing_practice",
          scope: "agent_specific",
          subject: "review testing standard",
          metadata: expect.objectContaining({
            agentContextLine: "Follow this user review testing standard: User expects focused tests and a precise test plan before handoff.",
          }),
        }),
        expect.objectContaining({
          engineeringMemoryType: "agent_instruction",
          scope: "agent_specific",
          subject: "review agent behavior",
          metadata: expect.objectContaining({
            agentContextLine: "Follow this user review correction in future coding-agent work: User wants exact root-cause fixes, not just retries or fallbacks.",
          }),
        }),
      ]),
    );
}
