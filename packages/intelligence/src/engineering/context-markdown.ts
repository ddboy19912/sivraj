import type { EngineeringInstructionIssue } from "./conflicts.js";
import type {
  CodingAgentContextPacket,
  CodingAgentContextPacketItem,
  CodingAgentContextQuality,
  EngineeringProfileEvidenceRef,
} from "./profile.js";

type ContextRuleLineOptions = {
  emptyMessage: string;
  showCandidatePrefix?: boolean;
};

type CandidateNoticeOptions = {
  when: "items_include_candidate" | "include_candidate_flag";
  items?: CodingAgentContextPacketItem[];
  includeCandidate?: boolean;
  message: string;
  blankLineBeforeBullet?: boolean;
};

type ContextQualitySummaryOptions = {
  includeStrengthsRisks?: boolean;
  recommendationLimit?: number;
};

type ContextIssueSectionOptions = {
  title?: string;
  limit?: number;
};

function formatAgentContextRuleLine(item: CodingAgentContextPacketItem): string {
  const prefix = item.status === "candidate" ? "[CANDIDATE] " : "";
  const line = item.agentContextLine || fallbackAgentContextLine(item);

  return `- ${prefix}${line} Evidence: ${item.evidence.candidateMemoryId}`;
}

export function appendContextRuleLines(
  lines: string[],
  items: CodingAgentContextPacketItem[],
  options: ContextRuleLineOptions,
): void {
  if (items.length === 0) {
    lines.push(`- ${options.emptyMessage}`);
    return;
  }

  for (const item of items) {
    if (options.showCandidatePrefix === false && item.status === "candidate") {
      lines.push(`- ${item.agentContextLine || fallbackAgentContextLine(item)} Evidence: ${item.evidence.candidateMemoryId}`);
      continue;
    }

    lines.push(formatAgentContextRuleLine(item));
  }
}

export function appendCandidateNoticeSection(
  lines: string[],
  options: CandidateNoticeOptions,
): void {
  const shouldShow = options.when === "include_candidate_flag"
    ? Boolean(options.includeCandidate)
    : (options.items ?? []).some((item) => item.status === "candidate");

  if (!shouldShow) {
    return;
  }

  lines.push("");
  lines.push("## Candidate Notice");

  if (options.blankLineBeforeBullet) {
    lines.push("");
  }

  lines.push(`- ${options.message}`);
}

export function appendContextQualitySummary(
  lines: string[],
  quality: CodingAgentContextQuality,
  options: ContextQualitySummaryOptions = {},
): void {
  lines.push("## Context Quality");
  lines.push(`- Score: ${qualityPercent(quality.score)} (${quality.label})`);
  lines.push(`- Ready for agent: ${quality.readyForAgent ? "yes" : "no"}`);

  if (options.includeStrengthsRisks) {
    if (quality.strengths.length > 0) {
      lines.push(`- Strengths: ${quality.strengths.join("; ")}`);
    }

    if (quality.risks.length > 0) {
      lines.push(`- Risks: ${quality.risks.join("; ")}`);
    }
  }

  const recommendationLimit = options.recommendationLimit ?? 3;

  for (const recommendation of quality.recommendations.slice(0, recommendationLimit)) {
    lines.push(`- ${recommendation}`);
  }
}

export function appendItemEvidenceMap(
  lines: string[],
  items: CodingAgentContextPacketItem[],
): void {
  if (items.length === 0) {
    lines.push("- No evidence refs.");
    return;
  }

  for (const item of items) {
    lines.push(formatDetailedEvidenceLine(item.evidence));
  }
}

export function appendPacketEvidenceRefs(
  lines: string[],
  evidence: EngineeringProfileEvidenceRef[],
): void {
  for (const ref of evidence) {
    lines.push(
      `- Candidate ${ref.candidateMemoryId}; artifact ${ref.sourceArtifactId}; fragment ${ref.memoryFragmentId}; evidence ${ref.evidenceHash}`,
    );
  }
}

export function appendPacketWarnings(lines: string[], warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  lines.push("");
  lines.push("## Warnings");

  for (const warning of warnings) {
    lines.push(`- ${warning}`);
  }
}

export function appendPacketIssues(
  lines: string[],
  issues: EngineeringInstructionIssue[],
  options: ContextIssueSectionOptions = {},
): void {
  const limitedIssues = options.limit ? issues.slice(0, options.limit) : issues;

  if (limitedIssues.length === 0) {
    return;
  }

  lines.push("");
  lines.push(options.title ?? "## Context Issues");

  if (options.title === "## Review Notes") {
    lines.push("");
  }

  for (const issue of limitedIssues) {
    lines.push(formatContextIssueLine(issue));
  }
}

export function appendExportProjectContext(
  lines: string[],
  packet: CodingAgentContextPacket,
  label: "Name" | "Project" = "Name",
): void {
  lines.push(
    "",
    `- ${label}: ${packet.project.name || "Unknown"}`,
    `- Repo: ${repoNameFromFingerprint(packet.project.repoFingerprint)}`,
    `- Stack: ${formatRepoStack(packet.project.repoFingerprint) || "Unknown"}`,
    `- Sivraj quality: ${qualityPercent(packet.quality.score)} (${packet.quality.label})`,
    "",
    "## Privacy Boundary",
    "",
  );
}

export function finalizeMarkdown(lines: string[]): string {
  return `${lines.join("\n").trim()}\n`;
}

function qualityPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatRepoStack(
  fingerprint: CodingAgentContextPacket["project"]["repoFingerprint"],
): string {
  return [
    fingerprint.packageManager,
    ...fingerprint.frameworks,
  ].filter(Boolean).join(", ");
}

export function repoNameFromFingerprint(
  fingerprint: CodingAgentContextPacket["project"]["repoFingerprint"],
): string {
  return fingerprint.repoName || fingerprint.packageName || "Unknown";
}

const FALLBACK_AGENT_CONTEXT_LINE_BUILDERS: Partial<
  Record<CodingAgentContextPacketItem["type"], (subject: string | null) => string | null>
> = {
  tool_preference: (subject) => (
    subject ? `Use ${subject} when this project or task calls for that tool.` : null
  ),
  coding_preference: (subject) => (
    subject ? `Respect the user's coding preference around ${subject}.` : null
  ),
  testing_practice: (subject) => (
    subject
      ? `Follow the source-backed testing practice for ${subject}.`
      : "Follow the source-backed testing practice before handoff."
  ),
  security_boundary: (subject) => (
    subject
      ? `Respect the source-backed security boundary for ${subject}.`
      : "Respect the source-backed security boundary."
  ),
  project_convention: (subject) => (
    subject ? `Follow the source-backed project convention for ${subject}.` : null
  ),
};

export function fallbackAgentContextLine(item: {
  type?: CodingAgentContextPacketItem["type"];
  engineeringMemoryType?: CodingAgentContextPacketItem["type"];
  subject: string | null;
  agentContextLine?: string;
}): string {
  if (item.agentContextLine?.trim()) {
    return item.agentContextLine;
  }

  const type = item.type ?? item.engineeringMemoryType ?? "agent_instruction";
  const subject = item.subject?.trim() || null;
  const specialized = FALLBACK_AGENT_CONTEXT_LINE_BUILDERS[type]?.(subject);

  if (specialized) {
    return specialized;
  }

  const readableType = type.replace(/_/g, " ");

  return subject
    ? `Apply the source-backed ${readableType} for ${subject}.`
    : `Apply this source-backed ${readableType}.`;
}

function formatContextIssueLine(issue: EngineeringInstructionIssue): string {
  return `- ${issue.severity}: ${issue.reason}; candidate ${issue.candidateId || "unknown"}; existing ${issue.existingId || "none"}`;
}

function formatDetailedEvidenceLine(ref: EngineeringProfileEvidenceRef): string {
  return `- ${ref.candidateMemoryId}: artifact ${ref.sourceArtifactId}; fragment ${ref.memoryFragmentId}; evidence ${ref.evidenceHash}`;
}

