export const ENGINEERING_MEMORY_TYPES = [
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
] as const;

export type EngineeringMemoryType = typeof ENGINEERING_MEMORY_TYPES[number];

export const ENGINEERING_INSTRUCTION_SCOPES = [
  "global_user",
  "project",
  "organization",
  "agent_specific",
  "temporary",
] as const;

export type EngineeringInstructionScope =
  typeof ENGINEERING_INSTRUCTION_SCOPES[number];

export const ENGINEERING_INSTRUCTION_LIFECYCLES = [
  "candidate",
  "approved",
  "active",
  "superseded",
  "rejected",
] as const;

export type EngineeringInstructionLifecycle =
  typeof ENGINEERING_INSTRUCTION_LIFECYCLES[number];

export const ENGINEERING_SOURCE_KINDS = [
  "agent_instruction_file",
  "repo_documentation",
  "source_code_config",
  "github_import",
  "chat_conversation",
  "voice_conversation",
  "agent_writeback",
  "manual_note",
  "unknown",
] as const;

export type EngineeringSourceKind = typeof ENGINEERING_SOURCE_KINDS[number];

export type EngineeringSourceDetectionInput = {
  path?: string | null;
  fileName?: string | null;
  sourceType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type EngineeringSourceDetectionResult = {
  sourceKind: EngineeringSourceKind;
  matchedBy: "path" | "fileName" | "sourceType" | "metadata" | "none";
  normalizedPath: string | null;
  isAgentInstructionFile: boolean;
};

export type EngineeringInstructionScopeClassificationInput = {
  instruction: string;
  sourceKind?: EngineeringSourceKind | null;
  path?: string | null;
  fileName?: string | null;
  sourceType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type EngineeringInstructionScopeClassification = {
  scope: EngineeringInstructionScope;
  confidence: number;
  reason: string;
  signals: string[];
};

const AGENT_INSTRUCTION_BASENAMES = new Set([
  "claude.md",
  "agents.md",
  "agent.md",
  "skill.md",
  ".cursorrules",
  "copilot-instructions.md",
]);

const REPO_DOCUMENTATION_BASENAMES = new Set([
  "readme.md",
  "readme",
  "contributing.md",
  "codeowners",
  "architecture.md",
  "deployment.md",
]);

const SOURCE_CODE_CONFIG_BASENAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "eslint.config.js",
  "eslint.config.mjs",
  ".eslintrc",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  "vite.config.ts",
  "vite.config.js",
  "docker-compose.yml",
  "docker-compose.yaml",
  "dockerfile",
  ".env",
  ".env.example",
  ".env.local",
  ".env.test",
]);

export function detectEngineeringSourceKind(
  input: EngineeringSourceDetectionInput,
): EngineeringSourceDetectionResult {
  const normalizedPath = resolveNormalizedPath(input);
  const pathMatch = detectSourceKindFromPath(normalizedPath, input.path ? "path" : "fileName");

  if (pathMatch) {
    return pathMatch;
  }

  const sourceKindFromMetadata = sourceKindForMetadata(input.metadata);

  if (sourceKindFromMetadata) {
    return buildSourceDetectionResult(sourceKindFromMetadata, "metadata", normalizedPath);
  }

  const sourceKindFromSourceType = sourceKindForSourceType(input.sourceType);

  if (sourceKindFromSourceType) {
    return buildSourceDetectionResult(sourceKindFromSourceType, "sourceType", normalizedPath);
  }

  return buildSourceDetectionResult("unknown", "none", normalizedPath);
}

function resolveNormalizedPath(input: EngineeringSourceDetectionInput): string | null {
  return normalizePath(
    input.path ??
      input.fileName ??
      readStringMetadata(input.metadata, "fileName") ??
      readStringMetadata(input.metadata, "path") ??
      null,
  );
}

function buildSourceDetectionResult(
  sourceKind: EngineeringSourceKind,
  matchedBy: EngineeringSourceDetectionResult["matchedBy"],
  normalizedPath: string | null,
): EngineeringSourceDetectionResult {
  return {
    sourceKind,
    matchedBy,
    normalizedPath,
    isAgentInstructionFile: sourceKind === "agent_instruction_file",
  };
}

function detectSourceKindFromPath(
  normalizedPath: string | null,
  matchedBy: "path" | "fileName",
): EngineeringSourceDetectionResult | null {
  if (!normalizedPath) {
    return null;
  }

  if (isAgentInstructionFilePath(normalizedPath)) {
    return buildSourceDetectionResult("agent_instruction_file", matchedBy, normalizedPath);
  }

  if (isRepoDocumentationPath(normalizedPath)) {
    return buildSourceDetectionResult("repo_documentation", matchedBy, normalizedPath);
  }

  if (isSourceCodeConfigPath(normalizedPath)) {
    return buildSourceDetectionResult("source_code_config", matchedBy, normalizedPath);
  }

  return null;
}

export function isAgentInstructionFile(pathOrFileName: string): boolean {
  return isAgentInstructionFilePath(normalizePath(pathOrFileName));
}

export function isEngineeringMemoryType(
  value: string,
): value is EngineeringMemoryType {
  return includesString(ENGINEERING_MEMORY_TYPES, value);
}

export function isEngineeringInstructionScope(
  value: string,
): value is EngineeringInstructionScope {
  return includesString(ENGINEERING_INSTRUCTION_SCOPES, value);
}

export function isEngineeringInstructionLifecycle(
  value: string,
): value is EngineeringInstructionLifecycle {
  return includesString(ENGINEERING_INSTRUCTION_LIFECYCLES, value);
}

export function isEngineeringSourceKind(
  value: string,
): value is EngineeringSourceKind {
  return includesString(ENGINEERING_SOURCE_KINDS, value);
}

export function classifyEngineeringInstructionScope(
  input: EngineeringInstructionScopeClassificationInput,
): EngineeringInstructionScopeClassification {
  const instruction = normalizeText(input.instruction);
  const sourceDetection = detectEngineeringSourceKind(input);
  const sourceKind = input.sourceKind ?? sourceDetection.sourceKind;
  const metadataScope = readStringMetadata(input.metadata, "engineeringInstructionScope");

  if (metadataScope && isEngineeringInstructionScope(metadataScope)) {
    return {
      scope: metadataScope,
      confidence: 0.95,
      reason: "metadata_scope",
      signals: ["metadata.engineeringInstructionScope"],
    };
  }

  if (hasTemporarySignal(instruction)) {
    return {
      scope: "temporary",
      confidence: 0.82,
      reason: "temporary_language",
      signals: ["temporary_phrase"],
    };
  }

  if (hasAgentSpecificSignal(instruction, sourceDetection.normalizedPath)) {
    return {
      scope: "agent_specific",
      confidence: 0.85,
      reason: "agent_specific_language_or_path",
      signals: ["agent_name_or_instruction_file"],
    };
  }

  if (hasOrganizationSignal(instruction)) {
    return {
      scope: "organization",
      confidence: 0.78,
      reason: "organization_or_team_language",
      signals: ["organization_phrase"],
    };
  }

  if (hasGlobalUserPreferenceSignal(instruction)) {
    return {
      scope: "global_user",
      confidence: 0.74,
      reason: "global_user_preference_language",
      signals: ["first_person_preference"],
    };
  }

  if (
    sourceKind === "agent_instruction_file" ||
    sourceKind === "repo_documentation" ||
    sourceKind === "source_code_config" ||
    sourceKind === "github_import" ||
    sourceKind === "agent_writeback"
  ) {
    return {
      scope: "project",
      confidence: 0.7,
      reason: "project_source_default",
      signals: [sourceKind],
    };
  }

  return {
    scope: "project",
    confidence: 0.55,
    reason: "conservative_project_default",
    signals: [],
  };
}

function isAgentInstructionFilePath(normalizedPath: string | null): boolean {
  if (!normalizedPath) {
    return false;
  }

  const basename = pathBasename(normalizedPath);

  return AGENT_INSTRUCTION_BASENAMES.has(basename) ||
    normalizedPath.startsWith(".cursor/rules/") ||
    normalizedPath.includes("/.cursor/rules/") ||
    normalizedPath === ".github/copilot-instructions.md" ||
    normalizedPath.endsWith("/.github/copilot-instructions.md");
}

function isRepoDocumentationPath(normalizedPath: string): boolean {
  const basename = pathBasename(normalizedPath);

  return REPO_DOCUMENTATION_BASENAMES.has(basename) ||
    normalizedPath.includes("/docs/") ||
    normalizedPath.includes("/documentation/");
}

function isSourceCodeConfigPath(normalizedPath: string): boolean {
  return SOURCE_CODE_CONFIG_BASENAMES.has(pathBasename(normalizedPath));
}

const SOURCE_KIND_BY_SOURCE_TYPE: Record<string, EngineeringSourceKind> = {
  github: "github_import",
  chat_export: "chat_conversation",
  slack_export: "chat_conversation",
  whatsapp_export: "chat_conversation",
  voice_conversation: "voice_conversation",
  voice_note: "voice_conversation",
  markdown: "manual_note",
  note: "manual_note",
  onboarding_self_description: "manual_note",
};

function sourceKindForSourceType(sourceType: string | null | undefined):
  | EngineeringSourceKind
  | null {
  return sourceType ? SOURCE_KIND_BY_SOURCE_TYPE[sourceType] ?? null : null;
}

function sourceKindForMetadata(metadata: Record<string, unknown> | null | undefined):
  | EngineeringSourceKind
  | null {
  const value = readStringMetadata(metadata, "engineeringSourceKind");

  if (value && isEngineeringSourceKind(value)) {
    return value;
  }

  const uploadKind = readStringMetadata(metadata, "uploadKind");

  if (uploadKind === "agent_writeback") {
    return "agent_writeback";
  }

  const importer = readStringMetadata(metadata, "importer");

  if (importer === "sivraj_agent_api") {
    return "agent_writeback";
  }

  return null;
}

function normalizePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pathBasename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function readStringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function includesString<const TValue extends string>(
  values: readonly TValue[],
  value: string,
): value is TValue {
  return values.includes(value as TValue);
}

function hasTemporarySignal(value: string): boolean {
  return /\b(for now|temporarily|temporary|this week|this sprint|this task|until launch|during launch|for this launch|for this phase|right now)\b/.test(value);
}

function hasAgentSpecificSignal(value: string, normalizedPath: string | null): boolean {
  if (normalizedPath && isAgentInstructionFilePath(normalizedPath)) {
    return true;
  }

  return /\b(codex|claude code|claude|cursor|copilot|coding agent|agent should|agents should|ai agent)\b/.test(value);
}

function hasOrganizationSignal(value: string): boolean {
  return /\b(our team|the team|company-wide|org-wide|organization|organisation|engineering team|at [a-z0-9][a-z0-9 -]+ we|within [a-z0-9][a-z0-9 -]+)\b/.test(value);
}

function hasGlobalUserPreferenceSignal(value: string): boolean {
  return /\b(i prefer|i always|i usually|i want|i don't want|i do not want|my preference|my default|across repos|across projects|for all repos|forever)\b/.test(value);
}
