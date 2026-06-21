import type {
  EngineeringInstructionScope,
  EngineeringMemoryType,
} from "./taxonomy.js";
import {
  detectEngineeringInstructionIssues,
  type EngineeringInstructionIssue,
  type EngineeringInstructionRecord,
} from "./conflicts.js";
import {
  appendCandidateNoticeSection,
  appendContextQualitySummary,
  appendContextRuleLines,
  appendExportProjectContext,
  appendItemEvidenceMap,
  appendPacketEvidenceRefs,
  appendPacketIssues,
  appendPacketWarnings,
  fallbackAgentContextLine,
  finalizeMarkdown,
  formatRepoStack,
  repoNameFromFingerprint,
} from "./context-markdown.js";
import {
  looksLikeSecretValue,
  PROFILE_EXACT_BLOCKED_METADATA_KEYS,
  sanitizeSecureMetadataRecord,
} from "../extraction-utils.js";
import { normalizeRepoFingerprint } from "./repo-fingerprint.js";

export type EngineeringProfileMemoryStatus =
  | "candidate"
  | "approved"
  | "rejected"
  | "superseded"
  | "active";

export type EngineeringProfileMemoryRecord = {
  id: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  memoryType: string;
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  confidence: number;
  status?: EngineeringProfileMemoryStatus | string | null;
  evidenceHash: string;
  evidenceLength: number | null;
  metadata?: Record<string, unknown> | null;
};

export type EngineeringProfileCategoryKey =
  | "userSkills"
  | "architectureDecisions"
  | "projectConventions"
  | "styleRules"
  | "deploymentEnvironment"
  | "securityBoundaries"
  | "recurringBugs"
  | "codingPreferences"
  | "toolPreferences"
  | "agentInstructions"
  | "testingPractices";

export type EngineeringProfileEvidenceRef = {
  candidateMemoryId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  evidenceHash: string;
  evidenceLength: number | null;
};

export type EngineeringProfileEntry = {
  id: string;
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  confidence: number;
  status: EngineeringProfileMemoryStatus;
  evidence: EngineeringProfileEvidenceRef;
  metadata: Record<string, unknown>;
};

export type EngineeringRepoFingerprint = {
  projectId: string | null;
  projectName: string | null;
  repoName: string | null;
  packageName: string | null;
  gitRemote: string | null;
  packageManager: string | null;
  frameworks: string[];
  lockfiles: string[];
  rootMarkers: string[];
};

export type EngineeringProjectProfile = {
  purpose: "engineering_project_profile";
  project: {
    id: string | null;
    name: string | null;
    repoFingerprint: EngineeringRepoFingerprint;
  };
  generatedAt: string;
  counts: {
    total: number;
    byType: Record<EngineeringMemoryType, number>;
    byScope: Record<EngineeringInstructionScope, number>;
    byStatus: Record<EngineeringProfileMemoryStatus, number>;
  };
  categories: Record<EngineeringProfileCategoryKey, EngineeringProfileEntry[]>;
  evidence: EngineeringProfileEvidenceRef[];
  warnings: string[];
};

export type EngineeringProjectProfileInput = {
  projectId?: string | null;
  projectName?: string | null;
  repoFingerprint?: Partial<EngineeringRepoFingerprint> | null;
  memories: EngineeringProfileMemoryRecord[];
  now?: Date;
  includeCandidate?: boolean;
  includeRejected?: boolean;
  maxEntriesPerCategory?: number;
};

export type CodingAgentContextScope = {
  includeGlobalUser: boolean;
  includeProject: boolean;
  includeOrganization: boolean;
  includeAgentSpecific: boolean;
  includeTemporary: boolean;
};

export type CodingAgentContextPacketSectionKey =
  | "userSkills"
  | "userPreferences"
  | "architectureRules"
  | "projectConventions"
  | "styleRules"
  | "deploymentEnvironment"
  | "securityBoundaries"
  | "knownPitfalls"
  | "agentInstructions"
  | "testingPractices";

export type CodingAgentContextPacketItem = {
  id: string;
  type: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  agentContextLine: string;
  confidence: number;
  status: EngineeringProfileMemoryStatus;
  metadata: Record<string, unknown>;
  evidence: EngineeringProfileEvidenceRef;
};

export type CodingAgentContextQuality = {
  score: number;
  label: "excellent" | "good" | "usable" | "weak" | "risky";
  readyForAgent: boolean;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  metrics: {
    totalItems: number;
    approvedOrActiveItems: number;
    candidateItems: number;
    evidenceRefs: number;
    issueCount: number;
    highSeverityIssueCount: number;
    repoMatchedItems: number;
    weakUnknownSourceItems: number;
    sectionCoverage: number;
  };
};

export type CodingAgentContextPacket = {
  purpose: "coding_agent_context";
  project: EngineeringProjectProfile["project"];
  generatedAt: string;
  scope: CodingAgentContextScope;
  counts: {
    totalItems: number;
    evidenceRefs: number;
  };
  sections: Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]>;
  evidence: EngineeringProfileEvidenceRef[];
  issues: EngineeringInstructionIssue[];
  quality: CodingAgentContextQuality;
  warnings: string[];
};

export type CodingAgentContextMarkdownOptions = {
  title?: string;
  mode?: "handoff" | "review";
  maxItemsPerSection?: number;
};

export type CodingAgentExportPreset = "codex" | "claude_code" | "cursor" | "generic_mcp";

export type CodingAgentExportFormat = "markdown" | "mdc" | "json";

export type CodingAgentExportTargetFile =
  | "AGENTS.md"
  | "CLAUDE.md"
  | ".cursor/rules/sivraj.mdc"
  | "sivraj-context.json";

export type CodingAgentContextExport = {
  preset: CodingAgentExportPreset;
  format: CodingAgentExportFormat;
  targetFile: CodingAgentExportTargetFile;
  content: string;
  evidence: EngineeringProfileEvidenceRef[];
  warnings: string[];
  quality: CodingAgentContextQuality;
  includedCandidate: boolean;
  itemCount: number;
};

export type CodingAgentContextExportOptions = {
  preset?: CodingAgentExportPreset;
  includeCandidate?: boolean;
  maxItems?: number;
  maxItemsPerSection?: number;
};

export type EngineeringInstructionPatch = {
  preset: CodingAgentExportPreset;
  format: CodingAgentExportFormat;
  targetFile: CodingAgentExportTargetFile;
  operation: "create_or_replace";
  content: string;
  suggestedMarkdown: string;
  evidence: EngineeringProfileEvidenceRef[];
  warnings: string[];
  quality: CodingAgentContextQuality;
  includedCandidate: boolean;
  itemCount: number;
};

export type EngineeringInstructionPatchOptions = {
  preset?: CodingAgentExportPreset;
  targetFile?: CodingAgentExportTargetFile;
  includeCandidate?: boolean;
  maxItems?: number;
};

export type CodingAgentContextPacketInput = {
  profile: EngineeringProjectProfile;
  includeCandidate?: boolean;
  includeSuperseded?: boolean;
  scope?: Partial<CodingAgentContextScope>;
  maxItemsPerSection?: number;
};

const CATEGORY_FOR_TYPE: Record<EngineeringMemoryType, EngineeringProfileCategoryKey> = {
  user_skill: "userSkills",
  architecture_decision: "architectureDecisions",
  project_convention: "projectConventions",
  style_rule: "styleRules",
  deployment_environment: "deploymentEnvironment",
  security_boundary: "securityBoundaries",
  recurring_bug: "recurringBugs",
  coding_preference: "codingPreferences",
  tool_preference: "toolPreferences",
  agent_instruction: "agentInstructions",
  testing_practice: "testingPractices",
};

const CATEGORY_KEYS: EngineeringProfileCategoryKey[] = [
  "userSkills",
  "architectureDecisions",
  "projectConventions",
  "styleRules",
  "deploymentEnvironment",
  "securityBoundaries",
  "recurringBugs",
  "codingPreferences",
  "toolPreferences",
  "agentInstructions",
  "testingPractices",
];

const PROFILE_STATUSES: EngineeringProfileMemoryStatus[] = [
  "candidate",
  "approved",
  "rejected",
  "superseded",
  "active",
];

const ENGINEERING_MEMORY_TYPES: EngineeringMemoryType[] = [
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
];

const ENGINEERING_SCOPES: EngineeringInstructionScope[] = [
  "global_user",
  "project",
  "organization",
  "agent_specific",
  "temporary",
];

export function buildEngineeringProjectProfile(
  input: EngineeringProjectProfileInput,
): EngineeringProjectProfile {
  const includeCandidate = input.includeCandidate ?? true;
  const includeRejected = input.includeRejected ?? false;
  const maxEntriesPerCategory = clampMaxEntries(input.maxEntriesPerCategory);
  const categories = emptyCategories();
  const warnings = new Set<string>();
  const repoFingerprint = normalizeRepoFingerprint({
    projectId: input.projectId,
    projectName: input.projectName,
    ...input.repoFingerprint,
  });
  const selected = input.memories
    .map((memory) => normalizeProfileMemory(memory, warnings))
    .filter((memory): memory is EngineeringProfileEntry => Boolean(memory))
    .map((memory) => annotateEntryForRepo(memory, repoFingerprint, warnings))
    .filter((memory) => includeCandidate || memory.status !== "candidate")
    .filter((memory) => includeRejected || memory.status !== "rejected")
    .sort(compareProfileEntries);

  for (const memory of selected) {
    const categoryKey = CATEGORY_FOR_TYPE[memory.engineeringMemoryType];
    const category = categories[categoryKey];

    if (category.length < maxEntriesPerCategory) {
      category.push(memory);
    }
  }

  const entries = CATEGORY_KEYS.flatMap((key) => categories[key]);

  return {
    purpose: "engineering_project_profile",
    project: {
      id: input.projectId ?? null,
      name: input.projectName ?? null,
      repoFingerprint,
    },
    generatedAt: (input.now ?? new Date()).toISOString(),
    counts: {
      total: entries.length,
      byType: countBy(entries, ENGINEERING_MEMORY_TYPES, (entry) => entry.engineeringMemoryType),
      byScope: countBy(entries, ENGINEERING_SCOPES, (entry) => entry.scope),
      byStatus: countBy(entries, PROFILE_STATUSES, (entry) => entry.status),
    },
    categories,
    evidence: dedupeEvidence(entries.map((entry) => entry.evidence)),
    warnings: Array.from(warnings).sort(),
  };
}

export function buildCodingAgentContextPacket(
  input: CodingAgentContextPacketInput,
): CodingAgentContextPacket {
  const scope = normalizeContextScope(input.scope);
  const maxItemsPerSection = clampMaxEntries(input.maxItemsPerSection);
  const includeCandidate = input.includeCandidate ?? false;
  const includeSuperseded = input.includeSuperseded ?? false;
  const sections = collectContextPacketSections({
    categories: input.profile.categories,
    scope,
    includeCandidate,
    includeSuperseded,
    maxItemsPerSection,
  });
  const items = Object.values(sections).flat();
  const evidence = dedupeEvidence(items.map((item) => item.evidence));
  const issues = detectContextIssues(items, input.profile.generatedAt);
  const quality = scoreCodingAgentContext({ items, evidence, issues });
  const warnings = buildContextPacketWarnings({
    profileWarnings: input.profile.warnings,
    issues,
    quality,
    itemCount: items.length,
  });

  return {
    purpose: "coding_agent_context",
    project: input.profile.project,
    generatedAt: input.profile.generatedAt,
    scope,
    counts: {
      totalItems: items.length,
      evidenceRefs: evidence.length,
    },
    sections,
    evidence,
    issues,
    quality,
    warnings,
  };
}

export function formatCodingAgentContextMarkdown(
  packet: CodingAgentContextPacket,
  options: CodingAgentContextMarkdownOptions = {},
): string {
  return options.mode === "review"
    ? formatReviewCodingAgentContextMarkdown(packet, options)
    : formatHandoffCodingAgentContextMarkdown(packet, options);
}

export function buildCodingAgentContextExport(
  packet: CodingAgentContextPacket,
  options: CodingAgentContextExportOptions = {},
): CodingAgentContextExport {
  const preset = options.preset ?? "codex";
  const maxItems = clampMaxEntries(options.maxItems ?? options.maxItemsPerSection);
  const includeCandidate = options.includeCandidate ?? false;
  const normalizedSections = normalizePacketSections(packet.sections);
  const items = selectHandoffItems(normalizedSections, maxItems)
    .filter((item) => includeCandidate || item.status !== "candidate");
  const evidence = dedupeEvidence(items.map((item) => item.evidence));
  const warnings = new Set(packet.warnings);

  if (items.length === 0) {
    warnings.add("coding_agent_export_empty");
  }

  if (includeCandidate && items.some((item) => item.status === "candidate")) {
    warnings.add("coding_agent_export_includes_candidate_context");
  }

  const targetFile = targetFileForPreset(preset);
  const format = formatForPreset(preset);
  const content = formatPresetContent({
    packet,
    preset,
    targetFile,
    items,
    includeCandidate,
    maxItems,
  });

  return {
    preset,
    format,
    targetFile,
    content,
    evidence,
    warnings: Array.from(warnings).filter(isUserFacingExportWarning).sort(),
    quality: packet.quality,
    includedCandidate: includeCandidate,
    itemCount: items.length,
  };
}

export function buildEngineeringInstructionPatch(
  packet: CodingAgentContextPacket,
  options: EngineeringInstructionPatchOptions = {},
): EngineeringInstructionPatch {
  const preset = normalizePresetForTarget(options.preset, options.targetFile);
  const contextExport = buildCodingAgentContextExport(packet, {
    preset,
    includeCandidate: options.includeCandidate,
    maxItems: options.maxItems,
  });
  const warnings = new Set(packet.warnings);

  for (const warning of contextExport.warnings) {
    warnings.add(warning);
  }

  if (contextExport.itemCount === 0) {
    warnings.add("instruction_patch_empty");
  }

  if (contextExport.includedCandidate) {
    warnings.add("instruction_patch_includes_candidate_context");
  }

  return {
    preset,
    format: contextExport.format,
    targetFile: options.targetFile ?? contextExport.targetFile,
    operation: "create_or_replace",
    content: contextExport.content,
    suggestedMarkdown: contextExport.content,
    evidence: contextExport.evidence,
    warnings: Array.from(warnings).sort(),
    quality: packet.quality,
    includedCandidate: contextExport.includedCandidate,
    itemCount: contextExport.itemCount,
  };
}

function formatHandoffCodingAgentContextMarkdown(
  packet: CodingAgentContextPacket,
  options: CodingAgentContextMarkdownOptions,
): string {
  const items = selectHandoffItems(
    normalizePacketSections(packet.sections),
    clampMaxEntries(options.maxItemsPerSection),
  );
  const lines = [
    `# ${options.title?.trim() || "Sivraj Coding Agent Context"}`,
    "",
    "Use this as persistent engineering context from Sivraj. Current user instructions and repository-local files still take priority.",
    "",
    "## Project",
    `- Name: ${packet.project.name || "Unknown"}`,
    `- Repo: ${repoNameFromFingerprint(packet.project.repoFingerprint)}`,
    `- Stack: ${formatRepoStack(packet.project.repoFingerprint) || "Unknown"}`,
    `- Generated: ${packet.generatedAt}`,
    "",
    "## Privacy Boundary",
    "- Raw private memories and uploaded file bodies are not included.",
    "- Exported rules are derived engineering context lines, backed by evidence IDs.",
    "",
    "## Apply These Rules",
  ];

  appendContextRuleLines(lines, items, { emptyMessage: "No coding-agent context exported yet." });
  appendCandidateNoticeSection(lines, {
    when: "items_include_candidate",
    items,
    message: "Candidate rules are usable for testing, but should be approved before becoming permanent default agent behavior.",
  });
  lines.push("");
  appendContextQualitySummary(lines, packet.quality);
  lines.push("");
  lines.push("## Evidence");
  appendItemEvidenceMap(lines, items);
  appendPacketWarnings(lines, packet.warnings);
  appendPacketIssues(lines, packet.issues);

  return finalizeMarkdown(lines);
}

function formatReviewCodingAgentContextMarkdown(
  packet: CodingAgentContextPacket,
  options: CodingAgentContextMarkdownOptions,
): string {
  const maxItemsPerSection = clampMaxEntries(options.maxItemsPerSection);
  const normalizedSections = normalizePacketSections(packet.sections);
  const agentSpecificItems = selectAgentSpecificReviewItems(normalizedSections, maxItemsPerSection);
  const lines = [
    `# ${options.title?.trim() || "Sivraj Engineering Context Review"}`,
    "",
    "Use this packet to inspect what Sivraj knows before creating a concise coding-agent handoff.",
    "",
    "## Project",
    `- Name: ${packet.project.name || "Unknown"}`,
    `- ID: ${packet.project.id || "Unknown"}`,
    `- Repo: ${repoNameFromFingerprint(packet.project.repoFingerprint)}`,
    `- Stack: ${formatRepoStack(packet.project.repoFingerprint) || "Unknown"}`,
    `- Generated: ${packet.generatedAt}`,
    "",
    "## Privacy Boundary",
    "- Raw private memories are not included.",
    "- Plaintext source statements are not included.",
    "- Every item is source-backed by Sivraj evidence IDs.",
    "",
  ];

  appendAgentSpecificPrioritySection(lines, agentSpecificItems);
  lines.push("");
  appendContextQualitySummary(lines, packet.quality, { includeStrengthsRisks: true });
  lines.push("");
  appendReviewContextSections(lines, normalizedSections, agentSpecificItems, maxItemsPerSection);
  lines.push("## Evidence");
  appendPacketEvidenceRefs(lines, packet.evidence);
  appendPacketWarnings(lines, packet.warnings);
  appendPacketIssues(lines, packet.issues);

  return finalizeMarkdown(lines);
}

function formatInstructionPatchMarkdown(input: {
  packet: CodingAgentContextPacket;
  targetFile: CodingAgentExportTargetFile;
  items: CodingAgentContextPacketItem[];
  includeCandidate: boolean;
}): string {
  const { packet, targetFile, items, includeCandidate } = input;
  const lines = [
    `# ${targetFile === "CLAUDE.md" ? "Claude Code" : "Agent"} Instructions`,
    "",
    "<!-- Generated by Sivraj from source-backed engineering memory. Review before committing. -->",
    "",
    "## Priority",
    "",
    "- Follow current user instructions first.",
    "- Follow repository-local files and direct maintainer instructions before this generated file when they conflict.",
    "",
    "## Project Context",
  ];

  appendExportProjectContext(lines, packet, "Project");
  lines.push(
    "- Raw private memories are not included in this file.",
    "- Uploaded document bodies and plaintext source statements are not included.",
    "- Rules below are derived from repo-safe Sivraj engineering memory.",
    "",
    "## Working Rules",
    "",
  );
  appendContextRuleLines(lines, items, {
    emptyMessage: "No approved repo-safe engineering rules are ready for export yet.",
    includeEvidenceRefs: false,
  });
  appendCandidateNoticeSection(lines, {
    when: "include_candidate_flag",
    includeCandidate,
    message: "Candidate rules are included for testing only. Approve them in Sivraj before relying on them as permanent repo policy.",
    blankLineBeforeBullet: true,
  });
  appendPacketIssues(lines, packet.issues, { title: "## Review Notes", limit: 8 });

  return finalizeMarkdown(lines);
}

function formatCursorRulesMdc(input: {
  packet: CodingAgentContextPacket;
  items: CodingAgentContextPacketItem[];
  includeCandidate: boolean;
}): string {
  const { packet, items, includeCandidate } = input;
  const lines = [
    "---",
    "description: Sivraj source-backed engineering context for Cursor",
    "alwaysApply: true",
    "---",
    "",
    "# Sivraj Cursor Rules",
    "",
    "Apply these source-backed rules when working in this repository. Current user instructions and local repository files take priority.",
    "",
    "## Project",
  ];

  appendExportProjectContext(lines, packet);
  lines.push(
    "- Raw private memories are not included.",
    "- Uploaded document bodies and plaintext source statements are not included.",
    "- Rules are derived from repo-safe Sivraj engineering memory.",
    "",
    "## Rules",
    "",
  );
  appendContextRuleLines(lines, items, {
    emptyMessage: "No approved repo-safe engineering rules are ready for Cursor yet.",
    includeEvidenceRefs: false,
  });
  appendCandidateNoticeSection(lines, {
    when: "include_candidate_flag",
    includeCandidate,
    message: "Candidate rules are included for testing only. Approve them in Sivraj before making them permanent Cursor rules.",
    blankLineBeforeBullet: true,
  });
  return finalizeMarkdown(lines);
}

function formatGenericMcpJson(input: {
  packet: CodingAgentContextPacket;
  items: CodingAgentContextPacketItem[];
  includeCandidate: boolean;
}): string {
  const { packet, items, includeCandidate } = input;

  return `${JSON.stringify({
    purpose: "sivraj_coding_agent_context_export",
    preset: "generic_mcp",
    generatedAt: packet.generatedAt,
    project: packet.project,
    privacyBoundary: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
    },
    priority: [
      "Current user instructions override this packet.",
      "Repository-local files override this packet when they conflict.",
    ],
    includeCandidate,
    issues: packet.issues,
    rules: items.map((item) => ({
      type: item.type,
      scope: item.scope,
      status: item.status,
      confidence: item.confidence,
      subject: item.subject,
      line: item.agentContextLine || fallbackAgentContextLine(item),
      safeMetadata: sanitizeExportMetadata(item.metadata),
    })),
    warnings: packet.warnings.filter((warning) => !warning.startsWith("context_quality:")),
  }, null, 2)}\n`;
}

function formatPresetContent(input: {
  packet: CodingAgentContextPacket;
  preset: CodingAgentExportPreset;
  targetFile: CodingAgentExportTargetFile;
  items: CodingAgentContextPacketItem[];
  includeCandidate: boolean;
  maxItems: number;
}): string {
  if (input.preset === "generic_mcp") {
    return formatGenericMcpJson(input);
  }

  if (input.preset === "cursor") {
    return formatCursorRulesMdc(input);
  }

  return formatInstructionPatchMarkdown({
    packet: input.packet,
    targetFile: input.targetFile,
    items: input.items,
    includeCandidate: input.includeCandidate,
  });
}

function targetFileForPreset(preset: CodingAgentExportPreset): CodingAgentExportTargetFile {
  if (preset === "claude_code") {
    return "CLAUDE.md";
  }

  if (preset === "cursor") {
    return ".cursor/rules/sivraj.mdc";
  }

  if (preset === "generic_mcp") {
    return "sivraj-context.json";
  }

  return "AGENTS.md";
}

function formatForPreset(preset: CodingAgentExportPreset): CodingAgentExportFormat {
  if (preset === "cursor") {
    return "mdc";
  }

  if (preset === "generic_mcp") {
    return "json";
  }

  return "markdown";
}

function isUserFacingExportWarning(warning: string): boolean {
  return !warning.startsWith("context_quality:");
}

function normalizePresetForTarget(
  preset: CodingAgentExportPreset | undefined,
  targetFile: CodingAgentExportTargetFile | undefined,
): CodingAgentExportPreset {
  if (preset) {
    return preset;
  }

  if (targetFile === "CLAUDE.md") {
    return "claude_code";
  }

  if (targetFile === ".cursor/rules/sivraj.mdc") {
    return "cursor";
  }

  if (targetFile === "sivraj-context.json") {
    return "generic_mcp";
  }

  return "codex";
}

function sanitizeExportMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const key of [
    "sourceKind",
    "source_file",
    "sourceFile",
    "fileName",
    "path",
    "tool",
    "framework",
    "packageManager",
    "packageName",
    "repoName",
    "repositoryName",
    "gitRemote",
    "boundary",
    "category",
    "repoMatchScore",
  ]) {
    if (metadata[key] !== undefined) {
      safe[key] = metadata[key];
    }
  }

  return safe;
}

function normalizeProfileMemory(
  memory: EngineeringProfileMemoryRecord,
  warnings: Set<string>,
): EngineeringProfileEntry | null {
  if (!memory.id || !memory.sourceArtifactId || !memory.memoryFragmentId || !memory.evidenceHash) {
    warnings.add("engineering_profile_memory_missing_evidence_ref");
    return null;
  }

  return {
    id: memory.id,
    engineeringMemoryType: memory.engineeringMemoryType,
    scope: memory.scope,
    subject: memory.subject,
    confidence: clampConfidence(memory.confidence),
    status: normalizeStatus(memory.status),
    evidence: {
      candidateMemoryId: memory.id,
      sourceArtifactId: memory.sourceArtifactId,
      memoryFragmentId: memory.memoryFragmentId,
      evidenceHash: memory.evidenceHash,
      evidenceLength: memory.evidenceLength,
    },
    metadata: sanitizeSecureMetadataRecord(memory.metadata, {
      allowAgentContextLine: true,
      exactBlockedKeys: PROFILE_EXACT_BLOCKED_METADATA_KEYS,
    }),
  };
}

function emptyCategories(): Record<EngineeringProfileCategoryKey, EngineeringProfileEntry[]> {
  return {
    userSkills: [],
    architectureDecisions: [],
    projectConventions: [],
    styleRules: [],
    deploymentEnvironment: [],
    securityBoundaries: [],
    recurringBugs: [],
    codingPreferences: [],
    toolPreferences: [],
    agentInstructions: [],
    testingPractices: [],
  };
}

function emptyContextSections(): Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]> {
  return {
    userSkills: [],
    userPreferences: [],
    architectureRules: [],
    projectConventions: [],
    styleRules: [],
    deploymentEnvironment: [],
    securityBoundaries: [],
    knownPitfalls: [],
    agentInstructions: [],
    testingPractices: [],
  };
}

const CONTEXT_SECTION_KEYS: CodingAgentContextPacketSectionKey[] = [
  "agentInstructions",
  "userSkills",
  "userPreferences",
  "projectConventions",
  "architectureRules",
  "styleRules",
  "testingPractices",
  "deploymentEnvironment",
  "securityBoundaries",
  "knownPitfalls",
];

const CONTEXT_SECTION_FOR_CATEGORY: Record<EngineeringProfileCategoryKey, CodingAgentContextPacketSectionKey | null> = {
  userSkills: "userSkills",
  architectureDecisions: "architectureRules",
  projectConventions: "projectConventions",
  styleRules: "styleRules",
  deploymentEnvironment: "deploymentEnvironment",
  securityBoundaries: "securityBoundaries",
  recurringBugs: "knownPitfalls",
  codingPreferences: "userPreferences",
  toolPreferences: "userPreferences",
  agentInstructions: "agentInstructions",
  testingPractices: "testingPractices",
};

const HUMANIZED_CONTEXT_SECTION: Record<CodingAgentContextPacketSectionKey, string> = {
  agentInstructions: "Agent Instructions",
  userSkills: "User Skills",
  userPreferences: "User Coding Preferences",
  projectConventions: "Project Conventions",
  architectureRules: "Architecture Decisions",
  styleRules: "Style Rules",
  testingPractices: "Testing Practices",
  deploymentEnvironment: "Deployment Environment",
  securityBoundaries: "Security Boundaries",
  knownPitfalls: "Known Pitfalls",
};

const SCOPE_VISIBILITY_FLAG: Record<EngineeringInstructionScope, keyof CodingAgentContextScope> = {
  global_user: "includeGlobalUser",
  project: "includeProject",
  organization: "includeOrganization",
  agent_specific: "includeAgentSpecific",
  temporary: "includeTemporary",
};

function humanizeContextSection(key: CodingAgentContextPacketSectionKey): string {
  return HUMANIZED_CONTEXT_SECTION[key];
}

function collectContextPacketSections(input: {
  categories: EngineeringProjectProfile["categories"];
  scope: CodingAgentContextScope;
  includeCandidate: boolean;
  includeSuperseded: boolean;
  maxItemsPerSection: number;
}): Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]> {
  const sections = emptyContextSections();

  for (const [categoryKey, entries] of Object.entries(input.categories) as Array<[
    EngineeringProfileCategoryKey,
    EngineeringProfileEntry[],
  ]>) {
    const sectionKey = contextSectionForCategory(categoryKey);

    if (!sectionKey) {
      continue;
    }

    for (const entry of entries) {
      if (!shouldIncludeProfileEntry(entry, input.scope, input.includeCandidate, input.includeSuperseded)) {
        continue;
      }

      if (sections[sectionKey].length >= input.maxItemsPerSection) {
        continue;
      }

      sections[sectionKey].push(profileEntryToContextItem(entry));
    }
  }

  for (const key of CONTEXT_SECTION_KEYS) {
    sections[key] = dedupeContextItems(sections[key]);
  }

  return sections;
}

function shouldIncludeProfileEntry(
  entry: EngineeringProfileEntry,
  scope: CodingAgentContextScope,
  includeCandidate: boolean,
  includeSuperseded: boolean,
): boolean {
  if (!scopeAllowsEntry(scope, entry.scope)) {
    return false;
  }

  if (entry.status === "rejected") {
    return false;
  }

  if (entry.status === "candidate" && !includeCandidate) {
    return false;
  }

  return !(entry.status === "superseded" && !includeSuperseded);
}

function profileEntryToContextItem(entry: EngineeringProfileEntry): CodingAgentContextPacketItem {
  return {
    id: entry.id,
    type: entry.engineeringMemoryType,
    scope: entry.scope,
    subject: entry.subject,
    agentContextLine: readAgentContextLine(entry),
    confidence: entry.confidence,
    status: entry.status,
    metadata: entry.metadata,
    evidence: entry.evidence,
  };
}

function buildContextPacketWarnings(input: {
  profileWarnings: string[];
  issues: EngineeringInstructionIssue[];
  quality: CodingAgentContextQuality;
  itemCount: number;
}): string[] {
  const warnings = new Set(input.profileWarnings);

  for (const issue of input.issues) {
    warnings.add(`context_${issue.issueType}:${issue.reason}`);
  }

  if (!input.quality.readyForAgent) {
    warnings.add(`context_quality:${input.quality.label}`);
  }

  if (input.itemCount === 0) {
    warnings.add("coding_agent_context_packet_empty");
  }

  return Array.from(warnings).sort();
}

function selectAgentSpecificReviewItems(
  sections: Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]>,
  maxItems: number,
): CodingAgentContextPacketItem[] {
  return Object.values(sections)
    .flat()
    .filter((item) => item.scope === "agent_specific")
    .filter(uniqueContextItemPredicate())
    .slice(0, maxItems);
}

function appendAgentSpecificPrioritySection(
  lines: string[],
  agentSpecificItems: CodingAgentContextPacketItem[],
): void {
  lines.push("## High Priority For This Agent");
  appendContextRuleLines(lines, agentSpecificItems, {
    emptyMessage: "No agent-specific context exported.",
    showCandidatePrefix: false,
  });
}

function appendReviewContextSections(
  lines: string[],
  normalizedSections: Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]>,
  agentSpecificItems: CodingAgentContextPacketItem[],
  maxItemsPerSection: number,
): void {
  for (const sectionKey of CONTEXT_SECTION_KEYS) {
    const items = sectionKey === "agentInstructions" && normalizedSections.agentInstructions.length === 0
      ? agentSpecificItems
      : normalizedSections[sectionKey].slice(0, maxItemsPerSection);
    lines.push(`## ${humanizeContextSection(sectionKey)}`);

    if (items.length === 0) {
      lines.push("- No context exported.");
      lines.push("");
      continue;
    }

    for (const item of items) {
      lines.push(formatContextItem(item));
    }

    lines.push("");
  }
}

function formatContextItem(item: CodingAgentContextPacketItem): string {
  const line = item.agentContextLine || fallbackAgentContextLine(item);
  const parts = [
    `type: ${item.type}`,
    `scope: ${item.scope}`,
    `status: ${item.status}`,
    `confidence: ${item.confidence.toFixed(2)}`,
  ].filter(Boolean);
  const metadata = formatSafeMetadata(item.metadata);
  const evidence = `evidence: ${item.evidence.candidateMemoryId}`;

  return metadata
    ? `- ${line}\n  - ${parts.join("; ")}; ${metadata}; ${evidence}`
    : `- ${line}\n  - ${parts.join("; ")}; ${evidence}`;
}

function normalizePacketSections(
  sections: Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]>,
): Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]> {
  const normalized = emptyContextSections();

  for (const key of CONTEXT_SECTION_KEYS) {
    normalized[key] = dedupeContextItems(
      sections[key].map((item) => ({
        ...item,
        agentContextLine: item.agentContextLine || fallbackAgentContextLine(item),
      })),
    );
  }

  return normalized;
}

function dedupeContextItems(items: CodingAgentContextPacketItem[]): CodingAgentContextPacketItem[] {
  const deduped = new Map<string, CodingAgentContextPacketItem>();

  for (const item of items) {
    const line = item.agentContextLine || fallbackAgentContextLine(item);
    const key = `${item.type}:${item.scope}:${normalizeContextLine(line)}`;
    const previous = deduped.get(key);

    if (!previous || rankContextItem(item) > rankContextItem(previous)) {
      deduped.set(key, {
        ...item,
        agentContextLine: line,
      });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => rankContextItem(right) - rankContextItem(left));
}

function selectHandoffItems(
  sections: Record<CodingAgentContextPacketSectionKey, CodingAgentContextPacketItem[]>,
  maxItems: number,
): CodingAgentContextPacketItem[] {
  const allItems = Object.values(sections).flat();
  const strongItems = allItems.filter((item) => !isWeakUnknownSourceItem(item));
  const candidates = strongItems.length > 0 ? strongItems : allItems;
  const deduped = new Map<string, CodingAgentContextPacketItem>();

  for (const item of candidates) {
    if (item.status === "rejected" || item.status === "superseded") {
      continue;
    }

    const line = item.agentContextLine || fallbackAgentContextLine(item);
    const key = normalizeContextLine(line);
    const previous = deduped.get(key);

    if (!previous || rankHandoffItem(item) > rankHandoffItem(previous)) {
      deduped.set(key, {
        ...item,
        agentContextLine: line,
      });
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => rankHandoffItem(right) - rankHandoffItem(left))
    .slice(0, maxItems);
}

function uniqueContextItemPredicate() {
  const seen = new Set<string>();

  return (item: CodingAgentContextPacketItem): boolean => {
    const key = `${item.type}:${normalizeContextLine(item.agentContextLine || fallbackAgentContextLine(item))}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  };
}

function rankContextItem(item: CodingAgentContextPacketItem): number {
  const statusScore = statusRank(item.status) * 10;
  const confidenceScore = Math.round(item.confidence * 10);
  const repoScore = readNumberMetadata(item.metadata["repoMatchScore"]) * 3;
  const repoPenalty = readNumberMetadata(item.metadata["repoConflictScore"]) * -8;

  return statusScore + confidenceScore + repoScore + repoPenalty;
}

function rankHandoffItem(item: CodingAgentContextPacketItem): number {
  const scopeScore = item.scope === "agent_specific"
    ? 8
    : item.scope === "project"
      ? 6
      : item.scope === "global_user"
        ? 5
        : item.scope === "organization"
          ? 4
          : 1;
  const sourceScore = sourceKindOf(item) === "unknown" ? -8 : 4;
  const line = item.agentContextLine || fallbackAgentContextLine(item);
  const lineScore = isGenericFallbackLine(line) ? -4 : 4;

  return rankContextItem(item) + scopeScore + sourceScore + lineScore;
}

function normalizeContextLine(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isWeakUnknownSourceItem(item: CodingAgentContextPacketItem): boolean {
  return sourceKindOf(item) === "unknown" && isGenericFallbackLine(item.agentContextLine || fallbackAgentContextLine(item));
}

function isGenericFallbackLine(value: string): boolean {
  return /^(apply|follow|respect) (this|the) source-backed /i.test(value.trim());
}

function sourceKindOf(item: CodingAgentContextPacketItem): string {
  const value = item.metadata["sourceKind"];

  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

function formatSafeMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata)
    .filter(([key]) => [
      "sourceKind",
      "source_file",
      "sourceFile",
      "fileName",
      "path",
      "tool",
      "framework",
      "runtime",
      "packageManager",
      "packageName",
      "repoName",
      "repositoryName",
      "gitRemote",
      "boundary",
      "category",
      "repoMatchScore",
    ].includes(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return entries.length > 0 ? entries.join("; ") : "";
}

function readAgentContextLine(entry: EngineeringProfileEntry): string {
  const direct = readSafeContextLine(entry.metadata["agentContextLine"]);

  if (direct) {
    return direct;
  }

  const nested = readRecord(entry.metadata["engineeringMetadata"]);
  const nestedLine = readSafeContextLine(nested["agentContextLine"]);

  return nestedLine ?? fallbackAgentContextLine(entry);
}

function readSafeContextLine(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  if (trimmed.length < 8 || looksLikeSecretValue(trimmed)) {
    return null;
  }

  return trimmed.length <= 260 ? trimmed : `${trimmed.slice(0, 257).trimEnd()}...`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function contextSectionForCategory(
  key: EngineeringProfileCategoryKey,
): CodingAgentContextPacketSectionKey | null {
  return CONTEXT_SECTION_FOR_CATEGORY[key];
}

const DEFAULT_CONTEXT_SCOPE: CodingAgentContextScope = {
  includeGlobalUser: true,
  includeProject: true,
  includeOrganization: true,
  includeAgentSpecific: true,
  includeTemporary: false,
};

function normalizeContextScope(scope: Partial<CodingAgentContextScope> | undefined): CodingAgentContextScope {
  return { ...DEFAULT_CONTEXT_SCOPE, ...scope };
}

function scopeAllowsEntry(scope: CodingAgentContextScope, entryScope: EngineeringInstructionScope): boolean {
  return scope[SCOPE_VISIBILITY_FLAG[entryScope]];
}

function compareProfileEntries(left: EngineeringProfileEntry, right: EngineeringProfileEntry): number {
  const repoScore = readNumberMetadata(right.metadata["repoMatchScore"]) -
    readNumberMetadata(left.metadata["repoMatchScore"]);

  if (repoScore !== 0) {
    return repoScore;
  }

  const statusScore = statusRank(right.status) - statusRank(left.status);

  if (statusScore !== 0) {
    return statusScore;
  }

  return right.confidence - left.confidence;
}

function annotateEntryForRepo(
  entry: EngineeringProfileEntry,
  fingerprint: EngineeringRepoFingerprint,
  warnings: Set<string>,
): EngineeringProfileEntry {
  const repoMatchScore = calculateRepoMatchScore(entry, fingerprint);
  const repoConflictScore = calculateRepoConflictScore(entry, fingerprint);
  const metadata = {
    ...entry.metadata,
    ...(repoMatchScore > 0 ? { repoMatchScore } : {}),
    ...(repoConflictScore > 0 ? { repoConflictScore } : {}),
  };

  if (repoConflictScore > 0) {
    warnings.add(`repo_context_mismatch:${entry.id}`);
  }

  return {
    ...entry,
    metadata,
  };
}

function calculateRepoMatchScore(entry: EngineeringProfileEntry, fingerprint: EngineeringRepoFingerprint): number {
  const metadata = entry.metadata;
  const line = readAgentContextLine(entry);

  return REPO_MATCH_RULES.reduce((score, rule) => score + rule({ entry, fingerprint, metadata, line }), 0);
}

const REPO_MATCH_RULES: Array<(input: {
  entry: EngineeringProfileEntry;
  fingerprint: EngineeringRepoFingerprint;
  metadata: Record<string, unknown>;
  line: string;
}) => number> = [
  ({ fingerprint, metadata }) => (
    fingerprint.projectId && normalizedEquals(metadata["projectId"], fingerprint.projectId) ? 6 : 0
  ),
  ({ fingerprint, line }) => (
    fingerprint.projectName && textMatches(line, fingerprint.projectName) ? 3 : 0
  ),
  ({ fingerprint, metadata, line }) => {
    if (!fingerprint.repoName) {
      return 0;
    }

    return (
      normalizedEquals(metadata["repoName"], fingerprint.repoName) ||
      normalizedEquals(metadata["repositoryName"], fingerprint.repoName) ||
      textMatches(line, fingerprint.repoName)
    ) ? 5 : 0;
  },
  ({ fingerprint, metadata, line }) => {
    if (!fingerprint.packageName) {
      return 0;
    }

    return (
      normalizedEquals(metadata["packageName"], fingerprint.packageName) ||
      textMatches(line, fingerprint.packageName)
    ) ? 5 : 0;
  },
  ({ fingerprint, metadata }) => (
    fingerprint.gitRemote &&
    normalizedEquals(normalizeGitRemote(readStringMetadata(metadata["gitRemote"])), fingerprint.gitRemote)
      ? 6
      : 0
  ),
  ({ fingerprint, metadata, line }) => {
    if (!fingerprint.packageManager) {
      return 0;
    }

    return (
      normalizedEquals(metadata["packageManager"], fingerprint.packageManager) ||
      textMatches(line, fingerprint.packageManager)
    ) ? 3 : 0;
  },
  ({ fingerprint, metadata, line }) => fingerprint.frameworks.reduce((score, framework) => (
    normalizedEquals(metadata["framework"], framework) || textMatches(line, framework)
      ? score + 2
      : score
  ), 0),
];

function packageManagerConflictScore(text: string, fingerprint: EngineeringRepoFingerprint): number {
  if (!fingerprint.packageManager) {
    return 0;
  }

  const managers = ["pnpm", "npm", "yarn", "bun"].filter((manager) => textHasWord(text, manager));

  return managers.length > 0 && !managers.includes(fingerprint.packageManager) ? 1 : 0;
}

function frameworkConflictScore(text: string, fingerprint: EngineeringRepoFingerprint): number {
  if (fingerprint.frameworks.length === 0) {
    return 0;
  }

  const mentionsNext = textHasWord(text, "next") || textHasWord(text, "nextjs");
  const mentionsVite = textHasWord(text, "vite");
  const repoUsesVite = fingerprint.frameworks.includes("vite");
  const repoUsesNext = fingerprint.frameworks.some((framework) =>
    framework === "next" || framework === "nextjs" || framework === "next.js");

  return (repoUsesVite && mentionsNext) || (repoUsesNext && mentionsVite) ? 1 : 0;
}

function calculateRepoConflictScore(entry: EngineeringProfileEntry, fingerprint: EngineeringRepoFingerprint): number {
  const metadata = entry.metadata;
  const line = readAgentContextLine(entry);
  const text = normalizeContextLine(`${line} ${entry.subject ?? ""} ${Object.values(metadata).join(" ")}`);

  return packageManagerConflictScore(text, fingerprint) + frameworkConflictScore(text, fingerprint);
}

function detectContextIssues(
  items: CodingAgentContextPacketItem[],
  generatedAt: string,
): EngineeringInstructionIssue[] {
  const records: EngineeringInstructionRecord[] = items.map((item) => ({
    id: item.id,
    statement: item.agentContextLine || fallbackAgentContextLine(item),
    engineeringMemoryType: item.type,
    scope: item.scope,
    subject: item.subject,
    confidence: item.confidence,
    metadata: item.metadata,
  }));
  const issues: EngineeringInstructionIssue[] = [];

  for (let index = 0; index < records.length; index += 1) {
    issues.push(...detectEngineeringInstructionIssues({
      candidate: records[index]!,
      existingInstructions: records.slice(0, index),
      now: new Date(generatedAt),
    }));
  }

  return dedupeContextIssues(issues);
}

function dedupeContextIssues(issues: EngineeringInstructionIssue[]): EngineeringInstructionIssue[] {
  const deduped = new Map<string, EngineeringInstructionIssue>();

  for (const issue of issues) {
    deduped.set(`${issue.reason}:${issue.candidateId}:${issue.existingId}`, issue);
  }

  return Array.from(deduped.values()).sort((left, right) => issueRank(right) - issueRank(left));
}

function issueRank(issue: EngineeringInstructionIssue): number {
  return issue.severity === "high" ? 3 : issue.severity === "medium" ? 2 : 1;
}

function scoreCodingAgentContext(input: {
  items: CodingAgentContextPacketItem[];
  evidence: EngineeringProfileEvidenceRef[];
  issues: EngineeringInstructionIssue[];
}): CodingAgentContextQuality {
  const metrics = summarizeContextQualityMetrics(input);
  const feedback = buildContextQualityFeedback(metrics, input);
  const normalizedScore = Math.max(0, Math.min(1, Number(feedback.score.toFixed(2))));
  const label = qualityLabel(normalizedScore, {
    issueCount: input.issues.length,
    highSeverityIssueCount: metrics.highSeverityIssueCount,
    totalItems: metrics.totalItems,
  });

  if (feedback.recommendations.length === 0) {
    feedback.recommendations.push("Packet is suitable for coding-agent handoff; keep reviewing new candidate memories as they arrive.");
  }

  return {
    score: normalizedScore,
    label,
    readyForAgent: label === "excellent" || label === "good" || label === "usable",
    strengths: dedupeStrings(feedback.strengths),
    risks: dedupeStrings(feedback.risks),
    recommendations: dedupeStrings(feedback.recommendations),
    metrics: {
      totalItems: metrics.totalItems,
      approvedOrActiveItems: metrics.approvedOrActiveItems,
      candidateItems: metrics.candidateItems,
      evidenceRefs: input.evidence.length,
      issueCount: input.issues.length,
      highSeverityIssueCount: metrics.highSeverityIssueCount,
      repoMatchedItems: metrics.repoMatchedItems,
      weakUnknownSourceItems: metrics.weakUnknownSourceItems,
      sectionCoverage: Number(metrics.sectionCoverage.toFixed(2)),
    },
  };
}

function summarizeContextQualityMetrics(input: {
  items: CodingAgentContextPacketItem[];
  issues: EngineeringInstructionIssue[];
}) {
  const populatedSections = CONTEXT_SECTION_KEYS
    .filter((key) => input.items.some((item) => sectionContainsItem(key, item)))
    .length;

  return {
    totalItems: input.items.length,
    approvedOrActiveItems: input.items.filter((item) => item.status === "approved" || item.status === "active").length,
    candidateItems: input.items.filter((item) => item.status === "candidate").length,
    repoMatchedItems: input.items.filter((item) => readNumberMetadata(item.metadata["repoMatchScore"]) > 0).length,
    weakUnknownSourceItems: input.items.filter(isWeakUnknownSourceItem).length,
    highSeverityIssueCount: input.issues.filter((issue) => issue.severity === "high").length,
    sectionCoverage: CONTEXT_SECTION_KEYS.length === 0 ? 0 : populatedSections / CONTEXT_SECTION_KEYS.length,
  };
}

function buildContextQualityFeedback(
  metrics: ReturnType<typeof summarizeContextQualityMetrics>,
  input: {
    items: CodingAgentContextPacketItem[];
    evidence: EngineeringProfileEvidenceRef[];
    issues: EngineeringInstructionIssue[];
  },
) {
  const strengths: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  score += scoreContextItemVolume(metrics.totalItems, risks, recommendations);
  score += scoreContextEvidence(input.evidence.length, strengths);
  score += scoreApprovedContext(metrics.totalItems, metrics.approvedOrActiveItems, strengths, risks, recommendations);
  score += scoreRepoMatchedContext(metrics.totalItems, metrics.repoMatchedItems, strengths, risks, recommendations);
  score += scoreSectionCoverage(metrics.sectionCoverage);
  score -= penalizeCandidateHeavyContext(metrics.totalItems, metrics.candidateItems, metrics.approvedOrActiveItems, risks);
  score -= penalizeWeakUnknownSources(metrics.weakUnknownSourceItems, risks, recommendations);
  score -= penalizeContextIssues(input.issues.length, risks, recommendations);
  score -= penalizeHighSeverityIssues(metrics.highSeverityIssueCount, risks);

  return { score, strengths, risks, recommendations };
}

function scoreContextItemVolume(totalItems: number, risks: string[], recommendations: string[]): number {
  if (totalItems > 0) {
    return Math.min(0.22, totalItems * 0.035);
  }

  risks.push("No context items are available for export.");
  recommendations.push("Upload or approve engineering memories before using this packet with a coding agent.");
  return 0;
}

function scoreContextEvidence(evidenceCount: number, strengths: string[]): number {
  if (evidenceCount === 0) {
    return 0;
  }

  strengths.push("Context is source-backed with evidence references.");
  return Math.min(0.16, evidenceCount * 0.025);
}

function scoreApprovedContext(
  totalItems: number,
  approvedOrActiveItems: number,
  strengths: string[],
  risks: string[],
  recommendations: string[],
): number {
  if (approvedOrActiveItems > 0) {
    strengths.push("Approved or active memories are present.");
    return Math.min(0.24, approvedOrActiveItems * 0.04);
  }

  if (totalItems > 0) {
    risks.push("All exported context is still candidate status.");
    recommendations.push("Approve high-confidence engineering memories before production agent handoff.");
  }

  return 0;
}

function scoreRepoMatchedContext(
  totalItems: number,
  repoMatchedItems: number,
  strengths: string[],
  risks: string[],
  recommendations: string[],
): number {
  if (repoMatchedItems > 0) {
    strengths.push("Some context matches the current repo fingerprint.");
    return Math.min(0.18, repoMatchedItems * 0.045);
  }

  if (totalItems > 0) {
    risks.push("No exported context is explicitly matched to the current repo fingerprint.");
    recommendations.push("Pass repo name, package name, package manager, and framework metadata when requesting context.");
  }

  return 0;
}

function scoreSectionCoverage(sectionCoverage: number): number {
  return sectionCoverage > 0 ? Math.min(0.12, sectionCoverage * 0.12) : 0;
}

function penalizeCandidateHeavyContext(
  totalItems: number,
  candidateItems: number,
  approvedOrActiveItems: number,
  risks: string[],
): number {
  if (candidateItems > approvedOrActiveItems && totalItems > 0) {
    risks.push("Candidate memories outnumber approved or active memories.");
    return 0.08;
  }

  return 0;
}

function penalizeWeakUnknownSources(
  weakUnknownSourceItems: number,
  risks: string[],
  recommendations: string[],
): number {
  if (weakUnknownSourceItems === 0) {
    return 0;
  }

  risks.push("Some exported items have weak or unknown source metadata.");
  recommendations.push("Prefer agent instruction files, repo docs, and approved notes with clear source metadata.");
  return Math.min(0.12, weakUnknownSourceItems * 0.04);
}

function penalizeContextIssues(issueCount: number, risks: string[], recommendations: string[]): number {
  if (issueCount === 0) {
    return 0;
  }

  risks.push("Conflicting or stale context issues were detected.");
  recommendations.push("Review context issues before handing this packet to an autonomous coding agent.");
  return Math.min(0.24, issueCount * 0.08);
}

function penalizeHighSeverityIssues(highSeverityIssueCount: number, risks: string[]): number {
  if (highSeverityIssueCount === 0) {
    return 0;
  }

  risks.push("High-severity context issues are present.");
  return 0.2;
}

function sectionContainsItem(sectionKey: CodingAgentContextPacketSectionKey, item: CodingAgentContextPacketItem): boolean {
  return contextSectionForCategory(CATEGORY_FOR_TYPE[item.type]) === sectionKey;
}

function qualityLabel(
  score: number,
  metrics: { issueCount: number; highSeverityIssueCount: number; totalItems: number },
): CodingAgentContextQuality["label"] {
  if (metrics.totalItems === 0 || metrics.highSeverityIssueCount > 0) {
    return "risky";
  }

  if (metrics.issueCount > 0 && score < 0.7) {
    return "risky";
  }

  if (score >= 0.82) {
    return "excellent";
  }

  if (score >= 0.65) {
    return "good";
  }

  if (score >= 0.32) {
    return "usable";
  }

  return "weak";
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function statusRank(status: EngineeringProfileMemoryStatus): number {
  if (status === "active") {
    return 4;
  }

  if (status === "approved") {
    return 3;
  }

  if (status === "candidate") {
    return 2;
  }

  if (status === "superseded") {
    return 1;
  }

  return 0;
}

function normalizeStatus(value: EngineeringProfileMemoryRecord["status"]): EngineeringProfileMemoryStatus {
  return typeof value === "string" && PROFILE_STATUSES.includes(value as EngineeringProfileMemoryStatus)
    ? value as EngineeringProfileMemoryStatus
    : "candidate";
}

function countBy<TItem, TKey extends string>(
  items: TItem[],
  keys: readonly TKey[],
  getKey: (item: TItem) => TKey,
): Record<TKey, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<TKey, number>;

  for (const item of items) {
    counts[getKey(item)] += 1;
  }

  return counts;
}

function dedupeEvidence(evidenceRefs: EngineeringProfileEvidenceRef[]): EngineeringProfileEvidenceRef[] {
  const deduped = new Map<string, EngineeringProfileEvidenceRef>();

  for (const ref of evidenceRefs) {
    deduped.set(ref.candidateMemoryId, ref);
  }

  return Array.from(deduped.values());
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function clampMaxEntries(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 100) : 12;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => typeof item === "string" ? item.split(",") : [])
      .map((item) => item.trim().toLowerCase())
      .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
  }

  return [];
}

function normalizeGitRemote(value: unknown): string | null {
  const raw = normalizeNullableString(value);

  if (!raw) {
    return null;
  }

  return raw
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function normalizedEquals(value: unknown, expected: string): boolean {
  const actual = typeof value === "string" ? value : null;

  return actual !== null && normalizeContextLine(actual) === normalizeContextLine(expected);
}

function textMatches(text: string, expected: string): boolean {
  const normalized = normalizeContextLine(text);
  const target = normalizeContextLine(expected);

  return target.length > 0 && normalized.includes(target);
}

function textHasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(normalizeContextLine(word))}\\b`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readStringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberMetadata(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
