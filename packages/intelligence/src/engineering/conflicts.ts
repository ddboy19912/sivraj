import type {
  EngineeringInstructionScope,
  EngineeringMemoryType,
} from "./taxonomy.js";

export type EngineeringInstructionRecord = {
  id?: string | null;
  statement: string;
  normalizedStatement?: string | null;
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  confidence?: number | null;
  createdAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type EngineeringInstructionIssueType = "conflict" | "stale";

export type EngineeringInstructionIssue = {
  issueType: EngineeringInstructionIssueType;
  reason:
    | "package_manager_conflict"
    | "frontend_framework_conflict"
    | "runtime_version_conflict"
    | "direct_use_avoid_conflict"
    | "temporary_instruction_expired"
    | "valid_until_expired";
  severity: "low" | "medium" | "high";
  candidateId: string | null;
  existingId: string | null;
  subject: string | null;
  scope: EngineeringInstructionScope;
  evidence: {
    candidateStatementHash: string;
    existingStatementHash?: string;
  };
  metadata: Record<string, unknown>;
};

export type EngineeringInstructionIssueDetectionInput = {
  candidate: EngineeringInstructionRecord;
  existingInstructions: EngineeringInstructionRecord[];
  now?: Date;
  temporaryTtlDays?: number;
};

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
const FRONTEND_FRAMEWORKS = ["vite", "next.js", "nextjs"] as const;

export function detectEngineeringInstructionIssues(
  input: EngineeringInstructionIssueDetectionInput,
): EngineeringInstructionIssue[] {
  const now = input.now ?? new Date();
  const issues: EngineeringInstructionIssue[] = [];
  const candidateText = normalizedStatement(input.candidate);

  issues.push(...detectCandidateStaleness(input.candidate, {
    now,
    temporaryTtlDays: input.temporaryTtlDays ?? 30,
  }));

  for (const existing of input.existingInstructions) {
    if (!scopesCanConflict(input.candidate.scope, existing.scope)) {
      continue;
    }

    const existingText = normalizedStatement(existing);
    const packageConflict = detectChoiceConflict(
      candidateText,
      existingText,
      PACKAGE_MANAGERS,
    );

    if (packageConflict) {
      issues.push(buildConflictIssue({
        reason: "package_manager_conflict",
        severity: "medium",
        candidate: input.candidate,
        existing,
        metadata: packageConflict,
      }));
      continue;
    }

    const frameworkConflict = detectChoiceConflict(
      candidateText,
      existingText,
      FRONTEND_FRAMEWORKS,
    );

    if (frameworkConflict) {
      issues.push(buildConflictIssue({
        reason: "frontend_framework_conflict",
        severity: "medium",
        candidate: input.candidate,
        existing,
        metadata: frameworkConflict,
      }));
      continue;
    }

    const runtimeConflict = detectRuntimeVersionConflict(candidateText, existingText);

    if (runtimeConflict) {
      issues.push(buildConflictIssue({
        reason: "runtime_version_conflict",
        severity: "medium",
        candidate: input.candidate,
        existing,
        metadata: runtimeConflict,
      }));
      continue;
    }

    const directConflict = detectDirectUseAvoidConflict(candidateText, existingText);

    if (directConflict) {
      issues.push(buildConflictIssue({
        reason: "direct_use_avoid_conflict",
        severity: "high",
        candidate: input.candidate,
        existing,
        metadata: directConflict,
      }));
    }
  }

  return dedupeIssues(issues);
}

function detectCandidateStaleness(
  candidate: EngineeringInstructionRecord,
  input: { now: Date; temporaryTtlDays: number },
): EngineeringInstructionIssue[] {
  const issues: EngineeringInstructionIssue[] = [];
  const validUntil = readDate(candidate.metadata?.["validUntil"]);

  if (validUntil && validUntil.getTime() < input.now.getTime()) {
    issues.push({
      issueType: "stale",
      reason: "valid_until_expired",
      severity: "high",
      candidateId: candidate.id ?? null,
      existingId: null,
      subject: candidate.subject,
      scope: candidate.scope,
      evidence: {
        candidateStatementHash: hashString(normalizedStatement(candidate)),
      },
      metadata: {
        validUntil: validUntil.toISOString(),
      },
    });
  }

  const createdAt = readDate(candidate.createdAt);

  if (candidate.scope === "temporary" && createdAt) {
    const ageMs = input.now.getTime() - createdAt.getTime();
    const ttlMs = input.temporaryTtlDays * 24 * 60 * 60 * 1000;

    if (ageMs > ttlMs) {
      issues.push({
        issueType: "stale",
        reason: "temporary_instruction_expired",
        severity: "medium",
        candidateId: candidate.id ?? null,
        existingId: null,
        subject: candidate.subject,
        scope: candidate.scope,
        evidence: {
          candidateStatementHash: hashString(normalizedStatement(candidate)),
        },
        metadata: {
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          temporaryTtlDays: input.temporaryTtlDays,
        },
      });
    }
  }

  return issues;
}

function detectChoiceConflict(
  candidateText: string,
  existingText: string,
  choices: readonly string[],
): Record<string, string> | null {
  const candidateChoice = findChoice(candidateText, choices);
  const existingChoice = findChoice(existingText, choices);

  if (!candidateChoice || !existingChoice || candidateChoice === existingChoice) {
    return null;
  }

  return {
    candidateChoice,
    existingChoice,
  };
}

function detectRuntimeVersionConflict(
  candidateText: string,
  existingText: string,
): Record<string, string> | null {
  const candidateNode = /\bnode(?:\.js)?\s*(?:version|v)?\s*(\d{2})\b/.exec(candidateText)?.[1];
  const existingNode = /\bnode(?:\.js)?\s*(?:version|v)?\s*(\d{2})\b/.exec(existingText)?.[1];

  if (candidateNode && existingNode && candidateNode !== existingNode) {
    return {
      runtime: "node",
      candidateVersion: candidateNode,
      existingVersion: existingNode,
    };
  }

  return null;
}

function detectDirectUseAvoidConflict(
  candidateText: string,
  existingText: string,
): Record<string, string> | null {
  const candidateUse = extractUseAvoidSignal(candidateText);
  const existingUse = extractUseAvoidSignal(existingText);

  if (
    !candidateUse ||
    !existingUse ||
    candidateUse.tool !== existingUse.tool ||
    candidateUse.intent === existingUse.intent
  ) {
    return null;
  }

  return {
    tool: candidateUse.tool,
    candidateIntent: candidateUse.intent,
    existingIntent: existingUse.intent,
  };
}

function extractUseAvoidSignal(text: string): {
  intent: "use" | "avoid";
  tool: string;
} | null {
  const avoidMatch = /\b(?:avoid|never use|do not use|don't use)\s+([a-z0-9_.-]+)/.exec(text);

  if (avoidMatch?.[1]) {
    return {
      intent: "avoid",
      tool: normalizeToolName(avoidMatch[1]),
    };
  }

  const useMatch = /\b(?:use|prefer)\s+([a-z0-9_.-]+)/.exec(text);

  if (useMatch?.[1]) {
    return {
      intent: "use",
      tool: normalizeToolName(useMatch[1]),
    };
  }

  return null;
}

function buildConflictIssue(input: {
  reason: EngineeringInstructionIssue["reason"];
  severity: EngineeringInstructionIssue["severity"];
  candidate: EngineeringInstructionRecord;
  existing: EngineeringInstructionRecord;
  metadata: Record<string, unknown>;
}): EngineeringInstructionIssue {
  return {
    issueType: "conflict",
    reason: input.reason,
    severity: input.severity,
    candidateId: input.candidate.id ?? null,
    existingId: input.existing.id ?? null,
    subject: input.candidate.subject ?? input.existing.subject,
    scope: input.candidate.scope,
    evidence: {
      candidateStatementHash: hashString(normalizedStatement(input.candidate)),
      existingStatementHash: hashString(normalizedStatement(input.existing)),
    },
    metadata: input.metadata,
  };
}

function scopesCanConflict(
  candidateScope: EngineeringInstructionScope,
  existingScope: EngineeringInstructionScope,
): boolean {
  return candidateScope === existingScope ||
    candidateScope === "global_user" ||
    existingScope === "global_user" ||
    candidateScope === "organization" ||
    existingScope === "organization";
}

function findChoice(text: string, choices: readonly string[]): string | null {
  return choices.find((choice) => {
    const escaped = choice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(`\\b${escaped}\\b`).test(text);
  }) ?? null;
}

function normalizedStatement(record: EngineeringInstructionRecord): string {
  return (record.normalizedStatement ?? record.statement)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[.,;:]+$/, "");
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dedupeIssues(
  issues: EngineeringInstructionIssue[],
): EngineeringInstructionIssue[] {
  const seen = new Set<string>();
  const deduped: EngineeringInstructionIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.issueType}:${issue.reason}:${issue.candidateId}:${issue.existingId}:${issue.evidence.candidateStatementHash}:${issue.evidence.existingStatementHash ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
