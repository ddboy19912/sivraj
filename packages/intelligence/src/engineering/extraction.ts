import type { StructuredGenerator } from "@sivraj/llm";
import {
  asRecord,
  clampConfidence,
  dedupeByConfidence,
  looksLikeSecretValue,
  normalizeStatement,
  readLlmArrayField,
  readNumber,
  readString,
  sanitizeSecureMetadata,
  sha256Hex,
  truncateForExtraction,
} from "../extraction-utils.js";
import {
  classifyEngineeringInstructionScope,
  detectEngineeringSourceKind,
  isEngineeringInstructionScope,
  isEngineeringMemoryType,
  type EngineeringInstructionScope,
  type EngineeringMemoryType,
  type EngineeringSourceKind,
} from "./taxonomy.js";

export type ExtractedEngineeringMemory = {
  statement: string;
  normalizedStatement: string;
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  confidence: number;
  evidenceHash: string;
  evidenceLength: number;
  metadata: Record<string, unknown>;
};

export type EngineeringMemoryExtractionInput = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  sourceType: string;
  content: string;
  title?: string | null;
  path?: string | null;
  fileName?: string | null;
  metadata?: Record<string, unknown> | null;
  maxMemories?: number;
};

export type EngineeringMemoryExtractionResult = {
  memories: ExtractedEngineeringMemory[];
  metadata: {
    extractor: "llm_structured_engineering_memory_extractor";
    provider: string;
    model: string;
    sourceKind: EngineeringSourceKind;
    originalLength: number;
    candidateInstructionCount: number;
    returnedMemories: number;
    acceptedMemories: number;
    warnings: string[];
  };
};

const ENGINEERING_MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are Sivraj's private engineering-memory extraction engine.
Extract source-backed software engineering memories from repo instructions, docs, configs, chats, and voice transcripts.
Return only valid JSON.
Do not infer rules that are not supported by explicit text evidence.
Do not turn repo-local rules into global user preferences unless the source explicitly says they apply across repos/projects.
Do not include private evidence text beyond the short evidence field requested.`;

export async function extractEngineeringMemories(
  input: EngineeringMemoryExtractionInput,
  params: { generator: StructuredGenerator },
): Promise<EngineeringMemoryExtractionResult> {
  const maxMemories = clampMaxEngineeringMemories(input.maxMemories);
  const sourceDetection = detectEngineeringSourceKind(input);
  const candidateInstructions = extractInstructionCandidates(input.content);
  const generation = await params.generator.generateJson({
    system: ENGINEERING_MEMORY_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildEngineeringMemoryExtractionPrompt({
      input,
      maxMemories,
      sourceKind: sourceDetection.sourceKind,
      candidateInstructions,
    }),
    temperature: 0,
  });
  const { memories, warnings } = parseEngineeringMemoryResponse(
    generation.json,
    maxMemories,
    input,
    sourceDetection.sourceKind,
  );

  return {
    memories,
    metadata: {
      extractor: "llm_structured_engineering_memory_extractor",
      provider: generation.provider,
      model: generation.model,
      sourceKind: sourceDetection.sourceKind,
      originalLength: input.content.length,
      candidateInstructionCount: candidateInstructions.length,
      returnedMemories: readReturnedEngineeringMemoryCount(generation.json),
      acceptedMemories: memories.length,
      warnings,
    },
  };
}

export function extractInstructionCandidates(content: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    if (/^\s*#{1,6}\s+/.test(rawLine)) {
      continue;
    }

    const line = normalizeInstructionLine(rawLine);

    if (!line || line.length < 8 || line.length > 500) {
      continue;
    }

    if (!looksLikeEngineeringInstruction(line)) {
      continue;
    }

    const key = line.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(line);
  }

  return candidates.slice(0, 80);
}

function buildEngineeringMemoryExtractionPrompt(input: {
  input: EngineeringMemoryExtractionInput;
  maxMemories: number;
  sourceKind: EngineeringSourceKind;
  candidateInstructions: string[];
}): string {
  return JSON.stringify({
    task: "extract_engineering_memories",
    instructions: [
      "Return a JSON object with a memories array.",
      "Each memory must include statement, type, scope, subject, confidence, evidence, and metadata.",
      `Use at most ${input.maxMemories} high-signal engineering memories.`,
      "Allowed types: coding_preference, architecture_decision, project_convention, style_rule, testing_practice, deployment_environment, security_boundary, recurring_bug, tool_preference, agent_instruction.",
      "Allowed scopes: global_user, project, organization, agent_specific, temporary.",
      "Evidence must be a short exact snippet from the source text.",
      "Prefer durable engineering rules, preferences, decisions, conventions, boundaries, and recurring failures.",
      "Use architecture_decision when the source says a team/user chose, decided, adopted, rejected, replaced, or standardized on a framework, storage layer, API pattern, architecture, security boundary, or deployment approach.",
      "Architecture decisions should preserve the chosen option, rejected option when present, and the project/system subject when available.",
      "Use recurring_bug when the source describes repeated failures, flaky behavior, regression loops, frequent breakages, repeated error messages, or failure conditions the user/team keeps encountering.",
      "Recurring bugs should preserve the failing subsystem, trigger/cause when present, and symptom/error class without inventing a root cause.",
      "Use project_convention when the source describes repo/team defaults such as package manager, framework layout, route pattern, testing approach, config ownership, naming scheme, or where files belong.",
      "Use style_rule when the source describes code style, UI style, naming style, formatting, component style, copy tone, or review expectations.",
      "Project conventions and style rules should usually remain project scope unless the source explicitly says they are broad user preferences.",
      "Use deployment_environment when the source describes runtime services, deployment targets, Docker/local stack, required environment variables, wallets/accounts, network names, package IDs, policy IDs, public RPC URLs, or external service configuration.",
      "Never copy secret values, private keys, tokens, passwords, bearer tokens, API keys, mnemonics, or connection strings into statement, evidence, or metadata. Keep only safe variable names and setup requirements.",
      "Use security_boundary when the source describes privacy requirements, encryption requirements, auth or permission gates, no-plaintext storage/logging rules, secret-handling rules, data access boundaries, or storage responsibility boundaries.",
      "Security boundaries are implementation constraints. Prefer project or organization scope unless the source explicitly says the user applies the rule across all work.",
      "Agent writebacks are repo-health signals. Extract failed commands, flaky tests, build quirks, dependency/version issues, deployment gotchas, recurring bugs, and fixes that should help the next coding agent.",
      "Agent writeback user corrections are review-copilot signals. Extract recurring user review standards, such as testing expectations, security/privacy concerns, UI/style expectations, exact-root-cause preferences, and agent behavior corrections.",
      "Use recurring_bug for failing tests, flaky behavior, repeated build failures, command failures, regressions, or modules that repeatedly break.",
      "Use testing_practice for reliable verification commands or test workflows that the agent/user actually ran.",
      "Use deployment_environment for deployment/runtime/build environment gotchas, required services, public env variable names, and setup requirements.",
      "Reject generic product prose or non-engineering content.",
      "Do not turn repo-local rules into global user preferences unless the evidence explicitly says they are broad user preferences.",
      "Repo docs, source config, and GitHub imports default to project scope.",
      "Agent instruction files default to agent_specific scope.",
      "Only use global_user when the text clearly says it is the user's broad preference across work or repos.",
    ],
    source: {
      sourceType: input.input.sourceType,
      title: input.input.title ?? null,
      path: input.input.path ?? input.input.fileName ?? null,
      sourceKind: input.sourceKind,
      candidateInstructions: input.candidateInstructions,
      content: truncateForExtraction(input.input.content),
    },
    outputShape: {
      memories: [
        {
          statement: "The user prefers rg for repository search before slower alternatives.",
          type: "tool_preference",
          scope: "global_user",
          subject: "rg",
          confidence: 0.86,
          evidence: "Use rg before grep.",
          metadata: {
            category: "repo_search",
          },
        },
      ],
    },
  });
}

function parseEngineeringMemoryResponse(
  value: unknown,
  maxMemories: number,
  input: EngineeringMemoryExtractionInput,
  sourceKind: EngineeringSourceKind,
): {
  memories: ExtractedEngineeringMemory[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawMemories = readLlmArrayField(value, "memories");
  const parsedMemories = rawMemories
    .map((raw) => parseEngineeringMemory(raw, warnings, input, sourceKind))
    .filter((memory): memory is ExtractedEngineeringMemory => memory !== null);

  return {
    memories: dedupeByConfidence(
      [
        ...extractDeterministicRepoHealthMemories(input, sourceKind),
        ...parsedMemories,
      ],
      (memory) => `${memory.engineeringMemoryType}:${memory.scope}:${memory.normalizedStatement}`,
      maxMemories,
    ),
    warnings,
  };
}

function parseEngineeringMemory(
  raw: unknown,
  warnings: string[],
  input: EngineeringMemoryExtractionInput,
  sourceKind: EngineeringSourceKind,
): ExtractedEngineeringMemory | null {
  const record = asRecord(raw);
  const statement = readString(record["statement"]);
  const memoryType = readEngineeringMemoryType(record["type"]);
  const evidence = readString(record["evidence"]);

  if (!statement || !memoryType || !evidence) {
    warnings.push("engineering_memory_missing_required_fields");
    return null;
  }

  const normalizedStatement = normalizeStatement(statement);

  if (normalizedStatement.length < 12) {
    warnings.push("engineering_memory_statement_too_short");
    return null;
  }

  if (!hasRequiredEngineeringSignal(memoryType, statement, evidence)) {
    warnings.push("engineering_memory_insufficient_engineering_signal");
    return null;
  }

  const requestedScope = readEngineeringInstructionScope(record["scope"]);
  const fallbackScope = classifyEngineeringInstructionScope({
    instruction: evidence,
    sourceKind,
    path: input.path,
    fileName: input.fileName,
    sourceType: input.sourceType,
    metadata: input.metadata,
  });
  const scope = safeEngineeringScope({
    requestedScope,
    fallbackScope: fallbackScope.scope,
    statement,
    evidence,
    sourceKind,
    warnings,
  });
  const metadata = sanitizeSecureMetadata(record["metadata"]);

  return {
    statement: statement.trim().replace(/\s+/g, " "),
    normalizedStatement,
    engineeringMemoryType: memoryType,
    scope,
    subject: readString(record["subject"]),
    confidence: clampConfidence(readNumber(record["confidence"])),
    evidenceHash: sha256Hex(evidence),
    evidenceLength: evidence.length,
    metadata: {
      ...metadata,
      agentContextLine: buildAgentContextLine(statement, memoryType, readString(record["subject"])),
      sourceKind,
      scopeReason: fallbackScope.reason,
      scopeSignals: fallbackScope.signals.join(","),
    },
  };
}

function extractDeterministicRepoHealthMemories(
  input: EngineeringMemoryExtractionInput,
  sourceKind: EngineeringSourceKind,
): ExtractedEngineeringMemory[] {
  if (sourceKind !== "agent_writeback") {
    return [];
  }

  const sections = parseMarkdownSections(input.content);
  const context = {
    repo: readString(input.metadata?.["repo"]) ?? "repo",
    agentName: readString(input.metadata?.["agentName"]) ?? "coding-agent",
  };
  const memories = [
    ...extractBugFoundMemories(sections, context),
    ...extractTestRunMemories(sections, context),
    ...extractRepoHealthSignalMemories(sections, "commands run", context, {
      signal: "command_gotcha",
      statementPrefix: "Repo health: command/build gotcha observed",
      confidence: 0.78,
      agentContextLine: (value) => `Remember this command/build gotcha when working in ${context.repo}: ${value}`,
    }),
    ...extractRepoHealthSignalMemories(sections, "follow ups", context, {
      signal: "follow_up",
      statementPrefix: "Repo health follow-up",
      confidence: 0.72,
      agentContextLine: (value) => `Track this repo-health follow-up: ${value}`,
    }),
    ...extractUserCorrectionMemories(sections, context),
  ];

  return dedupeExtractedEngineeringMemories(memories).slice(0, 20);
}

type RepoHealthExtractionContext = {
  repo: string;
  agentName: string;
};

function extractBugFoundMemories(
  sections: Map<string, string[]>,
  context: RepoHealthExtractionContext,
): ExtractedEngineeringMemory[] {
  return (sections.get("bugs found") ?? []).map((value) => createRepoHealthMemory({
    statement: `Repo health: ${value}`,
    engineeringMemoryType: "recurring_bug",
    subject: context.repo,
    evidence: value,
    confidence: 0.9,
    metadata: {
      category: "repo_health",
      repo: context.repo,
      agentName: context.agentName,
      signal: "bug_found",
      agentContextLine: `Watch for this repo-health issue: ${value}`,
    },
  }));
}

function extractTestRunMemories(
  sections: Map<string, string[]>,
  context: RepoHealthExtractionContext,
): ExtractedEngineeringMemory[] {
  return (sections.get("tests run") ?? []).map((value) => {
    if (looksLikeFailureSignal(value)) {
      return createRepoHealthMemory({
        statement: `Repo health: test or verification failure observed: ${value}`,
        engineeringMemoryType: "recurring_bug",
        subject: context.repo,
        evidence: value,
        confidence: 0.84,
        metadata: {
          category: "repo_health",
          repo: context.repo,
          agentName: context.agentName,
          signal: "test_failure",
          agentContextLine: `Check this known verification failure before handoff: ${value}`,
        },
      });
    }

    return createRepoHealthMemory({
      statement: `Use this verification command or test workflow for ${context.repo}: ${value}`,
      engineeringMemoryType: "testing_practice",
      subject: context.repo,
      evidence: value,
      confidence: 0.72,
      metadata: {
        category: "repo_health",
        repo: context.repo,
        agentName: context.agentName,
        signal: "test_command",
        agentContextLine: `Use this source-backed verification step when relevant: ${value}`,
      },
    });
  });
}

function extractRepoHealthSignalMemories(
  sections: Map<string, string[]>,
  sectionKey: string,
  context: RepoHealthExtractionContext,
  options: {
    signal: string;
    statementPrefix: string;
    confidence: number;
    agentContextLine: (value: string) => string;
  },
): ExtractedEngineeringMemory[] {
  return (sections.get(sectionKey) ?? []).flatMap((value) => {
    if (!looksLikeFailureSignal(value) && !looksLikeBuildOrDependencySignal(value)) {
      return [];
    }

    return [createRepoHealthMemory({
      statement: `${options.statementPrefix}: ${value}`,
      engineeringMemoryType: looksLikeBuildOrDependencySignal(value) ? "deployment_environment" : "recurring_bug",
      subject: context.repo,
      evidence: value,
      confidence: options.confidence,
      metadata: {
        category: "repo_health",
        repo: context.repo,
        agentName: context.agentName,
        signal: options.signal,
        agentContextLine: options.agentContextLine(value),
      },
    })];
  });
}

function extractUserCorrectionMemories(
  sections: Map<string, string[]>,
  context: RepoHealthExtractionContext,
): ExtractedEngineeringMemory[] {
  return (sections.get("user corrections") ?? []).map((value) => {
    const reviewMemory = classifyReviewCopilotCorrection(value);

    return createAgentWritebackEngineeringMemory({
      statement: `Review preference: ${value}`,
      engineeringMemoryType: reviewMemory.type,
      scope: reviewMemory.scope,
      subject: reviewMemory.subject,
      evidence: value,
      confidence: reviewMemory.confidence,
      metadata: {
        category: "review_copilot",
        repo: context.repo,
        agentName: context.agentName,
        signal: "user_correction",
        agentContextLine: reviewMemory.agentContextLine,
      },
    });
  });
}

function createRepoHealthMemory(input: {
  statement: string;
  engineeringMemoryType: EngineeringMemoryType;
  subject: string;
  evidence: string;
  confidence: number;
  metadata: Record<string, unknown>;
}): ExtractedEngineeringMemory {
  return createAgentWritebackEngineeringMemory({
    ...input,
    scope: "project",
  });
}

function createAgentWritebackEngineeringMemory(input: {
  statement: string;
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string;
  evidence: string;
  confidence: number;
  metadata: Record<string, unknown>;
}): ExtractedEngineeringMemory {
  const normalizedStatement = normalizeStatement(input.statement);
  const agentContextLine = readString(input.metadata["agentContextLine"]);

  return {
    statement: input.statement,
    normalizedStatement,
    engineeringMemoryType: input.engineeringMemoryType,
    scope: input.scope,
    subject: input.subject,
    confidence: clampConfidence(input.confidence),
    evidenceHash: sha256Hex(input.evidence),
    evidenceLength: input.evidence.length,
    metadata: {
      ...sanitizeSecureMetadata(input.metadata),
      ...(agentContextLine ? { agentContextLine } : {}),
      sourceKind: "agent_writeback",
      extractor: "deterministic_repo_health_extractor",
    },
  };
}

function classifyReviewCopilotCorrection(value: string): {
  type: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string;
  confidence: number;
  agentContextLine: string;
} {
  if (/\b(private|privacy|encrypt|encrypted|encryption|plaintext|secret|token|key|auth|permission|security)\b/i.test(value)) {
    return {
      type: "security_boundary",
      scope: "agent_specific",
      subject: "review security standard",
      confidence: 0.86,
      agentContextLine: `Respect this user review security standard: ${value}`,
    };
  }

  if (/\b(test|tests|testing|verify|verification|typecheck|build|check|coverage|smoke)\b/i.test(value)) {
    return {
      type: "testing_practice",
      scope: "agent_specific",
      subject: "review testing standard",
      confidence: 0.84,
      agentContextLine: `Follow this user review testing standard: ${value}`,
    };
  }

  if (/\b(ui|ux|copy|style|design|layout|loading|empty state|error state|accessibility|responsive|naming|tone)\b/i.test(value)) {
    return {
      type: "style_rule",
      scope: "agent_specific",
      subject: "review style standard",
      confidence: 0.78,
      agentContextLine: `Apply this user review style standard: ${value}`,
    };
  }

  if (/\b(root[- ]cause|actual fix|fallback|retry|temporary|mvp|production|proper|best solution|do not|don't|must|should|agent|codex|claude|cursor)\b/i.test(value)) {
    return {
      type: "agent_instruction",
      scope: "agent_specific",
      subject: "review agent behavior",
      confidence: 0.82,
      agentContextLine: `Follow this user review correction in future coding-agent work: ${value}`,
    };
  }

  return {
    type: "coding_preference",
    scope: "agent_specific",
    subject: "review preference",
    confidence: 0.68,
    agentContextLine: `Remember this user review preference: ${value}`,
  };
}

function parseMarkdownSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);

    if (heading) {
      current = heading[1]?.trim().toLowerCase() ?? null;
      if (current && !sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }

    if (!current) {
      continue;
    }

    const listItem = rawLine.match(/^\s*[-*]\s+(.+?)\s*$/);
    const value = listItem?.[1]?.trim();

    if (value && value.length >= 4) {
      sections.get(current)?.push(value);
    }
  }

  return sections;
}

function dedupeExtractedEngineeringMemories(
  memories: ExtractedEngineeringMemory[],
): ExtractedEngineeringMemory[] {
  const deduped = new Map<string, ExtractedEngineeringMemory>();

  for (const memory of memories) {
    const key = `${memory.engineeringMemoryType}:${memory.normalizedStatement}`;
    const previous = deduped.get(key);

    if (!previous || memory.confidence > previous.confidence) {
      deduped.set(key, memory);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => right.confidence - left.confidence);
}

function looksLikeFailureSignal(value: string): boolean {
  return /\b(fail(?:ed|ing|ure)?|error|flaky|flake|timeout|timed out|regression|broken|breaks|crash|panic|exception|red|not passing|does not pass|cannot|could not|missing|blocked)\b/i
    .test(value);
}

function looksLikeBuildOrDependencySignal(value: string): boolean {
  return /\b(build|deploy|deployment|ci|docker|redis|postgres|database|migration|env|environment|dependency|version|package|install|node|pnpm|npm|vite|typescript|tsc|vercel|walrus|seal|sui)\b/i
    .test(value);
}

function buildAgentContextLine(
  statement: string,
  memoryType: EngineeringMemoryType,
  subject: string | null,
): string {
  const sanitized = sanitizeAgentContextLine(statement);

  if (sanitized) {
    return sanitized;
  }

  const readableType = memoryType.replace(/_/g, " ");

  return subject
    ? `Apply the source-backed ${readableType} for ${subject}.`
    : `Apply the source-backed ${readableType}.`;
}

function sanitizeAgentContextLine(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "");

  if (normalized.length < 8 || looksLikeSecretValue(normalized)) {
    return null;
  }

  const sentence = normalized.endsWith(".") ? normalized : `${normalized}.`;

  return sentence.length <= 240 ? sentence : `${sentence.slice(0, 237).trimEnd()}...`;
}

function safeEngineeringScope(input: {
  requestedScope: EngineeringInstructionScope | null;
  fallbackScope: EngineeringInstructionScope;
  statement: string;
  evidence: string;
  sourceKind: EngineeringSourceKind;
  warnings: string[];
}): EngineeringInstructionScope {
  if (!input.requestedScope) {
    return input.fallbackScope;
  }

  if (
    input.requestedScope === "global_user" &&
    input.sourceKind !== "manual_note" &&
    !hasGlobalUserPreferenceSignal(`${input.statement} ${input.evidence}`)
  ) {
    input.warnings.push("engineering_memory_global_scope_downgraded");
    return input.fallbackScope === "global_user" ? "project" : input.fallbackScope;
  }

  return input.requestedScope;
}

function normalizeInstructionLine(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ");
}

function looksLikeEngineeringInstruction(value: string): boolean {
  return /\b(use|prefer|avoid|never|always|must|should|run|test|build|deploy|deployment|runtime|service|local stack|lint|format|commit|branch|revert|decide|decided|decision|choose|chose|chosen|adopt|adopted|select|selected|standardize|standardized|replace|replaced|instead of|convention|conventions|style|styling|naming|folder|directory|layout|structure|component|route|routes|handler|schema|migration|fail|fails|failed|failing|failure|flaky|break|breaks|broken|regression|bug|error|exception|timeout|slow|bottleneck|retry|rpc|fetch failed|api|database|postgres|redis|docker|compose|vite|react|next\.?js|hono|drizzle|pnpm|npm|yarn|bun|typescript|javascript|rust|go|python|walrus|seal|sui|testnet|mainnet|package id|policy id|key server|wallet|funded|openrouter|llm|token_issuer|jwt_secret|database_url|redis_url|vite_api_url|encrypt|encrypted|encryption|decrypt|decrypted|ciphertext|plaintext|no-plaintext|auth|permission|access control|policy|secrets?|logging|logs?|security|privacy|private memory|candidate memory|storage boundary|codex|claude|cursor|agent|architecture|repo|monorepo|workspace|environment|env)\b/i
    .test(value);
}

const ENGINEERING_SIGNAL_PATTERNS: Partial<Record<EngineeringMemoryType, RegExp>> = {
  architecture_decision: /\b(decide|decided|decision|choose|chose|chosen|adopt|adopted|select|selected|standardize|standardized|replace|replaced|instead of|architecture|api|database|storage|framework|stack)\b/i,
  project_convention: /\b(this repo|this project|repo uses|project uses|we use|uses pnpm|workspace|monorepo|convention|conventions|folder|directory|layout|structure|route modules?|schema|migration|package scripts?)\b/i,
  style_rule: /\b(style|styling|naming|format|formatting|component|ui|copy|tone|review|keep|avoid|use|prefer|must|should)\b/i,
  testing_practice: /\b(test|tests|testing|typecheck|check|build|vitest|jest|playwright|cypress|run focused|verify|verification)\b/i,
  deployment_environment: /\b(deploy|deployment|runtime|environment|env|service|local stack|docker|compose|postgres|redis|database_url|redis_url|sui_|seal_|walrus_|vite_|token_issuer|jwt_secret|rpc|testnet|mainnet|package id|policy id|key server)\b/i,
  security_boundary: /\b(security|privacy|private memory|encrypt|encrypted|encryption|decrypt|ciphertext|plaintext|no-plaintext|auth|permission|access control|policy|secret|token|password|key|logging|logs|postgres stores refs|must not be stored)\b/i,
  recurring_bug: /\b(repeated|recurring|keeps?|again|twice|frequent|fail|fails|failed|failing|failure|flaky|break|breaks|broken|regression|bug|error|exception|timeout|slow|bottleneck|retry|rpc|fetch failed)\b/i,
  coding_preference: /\b(i prefer|prefer|always|never|avoid|must|should|when coding|when working with me|coding agents? should|agents? should|use [a-z0-9@._/-]+|run [a-z0-9:._/-]+|do not|don't|before final response|codex|claude|cursor|agent)\b/i,
  tool_preference: /\b(i prefer|prefer|always|never|avoid|must|should|when coding|when working with me|coding agents? should|agents? should|use [a-z0-9@._/-]+|run [a-z0-9:._/-]+|do not|don't|before final response|codex|claude|cursor|agent)\b/i,
  agent_instruction: /\b(i prefer|prefer|always|never|avoid|must|should|when coding|when working with me|coding agents? should|agents? should|use [a-z0-9@._/-]+|run [a-z0-9:._/-]+|do not|don't|before final response|codex|claude|cursor|agent)\b/i,
};

function hasRequiredEngineeringSignal(
  memoryType: EngineeringMemoryType,
  statement: string,
  evidence: string,
): boolean {
  const value = `${statement} ${evidence}`;
  const pattern = ENGINEERING_SIGNAL_PATTERNS[memoryType];

  if (!pattern) {
    return looksLikeEngineeringInstruction(value);
  }

  const target = memoryType === "coding_preference" ||
    memoryType === "tool_preference" ||
    memoryType === "agent_instruction"
    ? evidence
    : value;

  return pattern.test(target);
}

function readReturnedEngineeringMemoryCount(value: unknown): number {
  return readLlmArrayField(value, "memories").length;
}

function readEngineeringMemoryType(value: unknown): EngineeringMemoryType | null {
  return typeof value === "string" && isEngineeringMemoryType(value) ? value : null;
}

function readEngineeringInstructionScope(value: unknown): EngineeringInstructionScope | null {
  return typeof value === "string" && isEngineeringInstructionScope(value) ? value : null;
}

function clampMaxEngineeringMemories(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 50) : 20;
}

function hasGlobalUserPreferenceSignal(value: string): boolean {
  return /\b(i prefer|i always|i usually|i want|i don't want|i do not want|my preference|my default|across repos|across projects|for all repos|forever)\b/i.test(value);
}
