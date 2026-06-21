const AGENT_INSTRUCTION_TARGET_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "SKILL.md",
  ".cursorrules",
  ".cursor/rules/sivraj.mdc",
  ".github/copilot-instructions.md",
] as const;

export type AgentInstructionTargetFile = typeof AGENT_INSTRUCTION_TARGET_FILES[number];

export const AGENT_INSTRUCTION_SAVE_TARGETS = [
  "AGENTS.md",
  "CLAUDE.md",
  "SKILL.md",
] as const satisfies readonly AgentInstructionTargetFile[];

const AGENT_INSTRUCTION_BASENAMES = new Set([
  "agents.md",
  "claude.md",
  "agent.md",
  "skill.md",
  ".cursorrules",
  "copilot-instructions.md",
]);

export type AgentInstructionOrigin =
  | "upload"
  | "draft"
  | "chat_message"
  | "assistant_message"
  | "code_block"
  | "generated";

export function isAgentInstructionFileName(value: string): boolean {
  const normalized = normalizeInstructionPath(value);

  if (!normalized) {
    return false;
  }

  const basename = normalized.split("/").filter(Boolean).at(-1) ?? normalized;

  return AGENT_INSTRUCTION_BASENAMES.has(basename) ||
    normalized.endsWith(".mdc") ||
    normalized.startsWith(".cursor/rules/") ||
    normalized.includes("/.cursor/rules/") ||
    normalized === ".github/copilot-instructions.md" ||
    normalized.endsWith("/.github/copilot-instructions.md");
}

export function inferAgentInstructionTargetFile(value: string): AgentInstructionTargetFile | null {
  const normalized = normalizeInstructionPath(value);

  if (!normalized) {
    return null;
  }

  if (normalized.endsWith("claude.md")) {
    return "CLAUDE.md";
  }

  if (normalized.endsWith("skill.md")) {
    return "SKILL.md";
  }

  if (normalized.endsWith(".cursorrules")) {
    return ".cursorrules";
  }

  if (
    normalized === ".github/copilot-instructions.md" ||
    normalized.endsWith("/.github/copilot-instructions.md")
  ) {
    return ".github/copilot-instructions.md";
  }

  if (normalized.endsWith(".mdc")) {
    return ".cursor/rules/sivraj.mdc";
  }

  if (normalized.endsWith("agents.md") || normalized.endsWith("agent.md")) {
    return "AGENTS.md";
  }

  return null;
}

export function buildAgentInstructionMetadata(input: {
  targetFile: AgentInstructionTargetFile;
  origin: AgentInstructionOrigin;
  fileName?: string | null;
  uploadSurface?: "chat" | "brain" | "api";
}): Record<string, unknown> {
  return {
    artifactPurpose: "agent_skill_source",
    engineeringSourceKind: "agent_instruction_file",
    targetInstructionFile: input.targetFile,
    agentInstructionOrigin: input.origin,
    uploadSurface: input.uploadSurface ?? "chat",
    ...(input.fileName ? { agentInstructionFileName: sanitizeInstructionFileName(input.fileName) } : {}),
  };
}

export function agentInstructionMetadataForFile(file: File): Record<string, unknown> {
  if (!isAgentInstructionFileName(file.name)) {
    return {};
  }

  return buildAgentInstructionMetadata({
    targetFile: inferAgentInstructionTargetFile(file.name) ?? "AGENTS.md",
    origin: "upload",
    fileName: file.name,
    uploadSurface: "chat",
  });
}

export function agentInstructionLabel(targetFile: AgentInstructionTargetFile): string {
  if (targetFile === ".cursor/rules/sivraj.mdc") {
    return "Cursor rule";
  }

  if (targetFile === ".github/copilot-instructions.md") {
    return "Copilot instructions";
  }

  return targetFile;
}

export function normalizeSourceFileName(
  value: string,
  fallback = "source.md",
): string {
  const cleaned = value
    .replace(/["\r\n]/gu, "")
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.trim()
    .slice(0, 160);
  const fileName = cleaned && cleaned.length > 0 ? cleaned : fallback;

  return hasKnownTextExtension(fileName) ? fileName : `${fileName}.md`;
}

export function isMarkdownSourceFileName(value: string): boolean {
  const normalized = normalizeInstructionPath(value);

  return Boolean(
    normalized &&
      (
        normalized.endsWith(".md") ||
        normalized.endsWith(".markdown") ||
        normalized.endsWith(".mdx") ||
        normalized.endsWith(".mdc") ||
        normalized.endsWith(".cursorrules")
      ),
  );
}

export function sourceDisplayMetadataForFileName(fileName: string): Record<string, unknown> {
  return {
    sourceDisplayName: fileName,
    sourceFileExtension: readFileExtension(fileName),
  };
}

function normalizeInstructionPath(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function sanitizeInstructionFileName(value: string): string {
  const basename = value
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .at(-1) ?? value;

  return basename
    .replace(/["\r\n]/gu, "")
    .trim()
    .slice(0, 160) || "agent-skill.md";
}

function hasKnownTextExtension(value: string): boolean {
  return /\.[a-z0-9]{1,16}$/iu.test(value) || value === ".cursorrules";
}

function readFileExtension(value: string): string | null {
  if (value === ".cursorrules") {
    return ".cursorrules";
  }

  const match = /(\.[a-z0-9]{1,16})$/iu.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}
