export type AgentContextPreset =
  | "codex"
  | "claude_code"
  | "cursor"
  | "generic_mcp";

export type AgentMcpClient =
  | "generic_json"
  | "codex"
  | "claude_code"
  | "vscode"
  | "cursor"
  | "windsurf"
  | "cline";

export type AgentMcpTransport = "stdio" | "http";

export type AgentContextExportFormat = "markdown" | "mdc" | "json";

export type AgentContextTargetFile =
  | "AGENTS.md"
  | "CLAUDE.md"
  | ".cursor/rules/sivraj.mdc"
  | "sivraj-context.json";

export type AgentContextScope =
  | "agent:context:read"
  | "agent:sources:read"
  | "agent:project_profile:read"
  | "agent:memory:search"
  | "agent:writeback:create";

export type AgentContextQuality = {
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

export type AgentContextPolicy = {
  rawArtifactsIncluded: boolean;
  decryptedMemoryIncluded: boolean;
  plaintextStatementsIncluded: boolean;
  derivedEngineeringContextIncluded: boolean;
  scope: "memory:read";
  agentScopesAccepted: string[];
};

export type AgentContextExport = {
  preset: AgentContextPreset;
  format: AgentContextExportFormat;
  targetFile: AgentContextTargetFile;
  content: string;
  evidence: Array<Record<string, unknown>>;
  warnings: string[];
  quality: AgentContextQuality;
  includedCandidate: boolean;
  itemCount: number;
};

export type AgentContextInventory = {
  candidateEngineeringMemoryCount: number;
  canonicalEngineeringMemoryCount: number;
  engineeringMemoryCount: number;
  engineeringSourceCount: number;
  agentInstructionSourceCount: number;
  sourceBackedEngineeringMemoryCount: number;
  exportableItemCount: number;
};

export type AgentContextProfileSummary = {
  totalEngineeringMemories: number;
  includedContextItems: number;
  evidenceRefs: number;
  warnings: string[];
  issues: Array<Record<string, unknown>>;
  quality: AgentContextQuality;
  repoFingerprint: Record<string, unknown>;
  inventory: AgentContextInventory;
};

export type AgentContextResponse = {
  policy: AgentContextPolicy;
  relationship: {
    sivraj: string;
    codingAgents: string;
    handoff: string;
  };
  contextPacket: Record<string, unknown>;
  contextMarkdown: string;
  contextExport: AgentContextExport;
  profileSummary: AgentContextProfileSummary;
};

export type AgentEngineeringReviewCandidateStatus =
  | "candidate"
  | "approved"
  | "rejected"
  | "superseded";

export type AgentEngineeringReviewAction =
  | "keep_active"
  | "reject"
  | "supersede"
  | "needs_review";

export type AgentEngineeringReviewCandidate = {
  id: string;
  memoryType: string;
  engineeringMemoryType: string;
  scope: string;
  status: AgentEngineeringReviewCandidateStatus;
  subject: string | null;
  agentContextLine: string | null;
  confidenceScore: number | null;
  evidenceHash: string | null;
  evidenceLength: number | null;
  statementStorageRef: string | null;
  sourceArtifactId: string;
  memoryFragmentId: string;
  metadata: Record<string, unknown>;
};

export type AgentEngineeringReviewIssue = {
  issueType: string;
  reason: string;
  severity: "low" | "medium" | "high" | string;
  subject: string | null;
  scope: string | null;
  candidate: AgentEngineeringReviewCandidate | null;
  existing: AgentEngineeringReviewCandidate | null;
  metadata: Record<string, unknown>;
};

export type AgentEngineeringReviewQueueResponse = {
  policy: AgentContextPolicy;
  summary: {
    totalEngineeringMemories: number;
    pendingCandidateCount: number;
    issueCount: number;
    quality: AgentContextQuality;
  };
  repoFingerprint: Record<string, unknown>;
  candidates: AgentEngineeringReviewCandidate[];
  issues: AgentEngineeringReviewIssue[];
};

export type AgentEngineeringReviewActionResponse = {
  candidateId: string;
  action: AgentEngineeringReviewAction;
  status: AgentEngineeringReviewCandidateStatus;
  feedbackId: string | null;
};

export type AgentTokenResponse = {
  token: string;
  tokenType: "Bearer";
  subjectType: "agent";
  clientId: string;
  grantId: string;
  twinId: string;
  scopes: AgentContextScope[];
  expiresAt: string;
};

export type AgentClientGrantStatus = "active" | "revoked" | "expired";

export type AgentClientGrant = {
  clientId: string;
  grantId: string;
  name: string;
  type: string;
  scopes: AgentContextScope[];
  memoryDomains: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: AgentClientGrantStatus;
  metadata: Record<string, unknown>;
};

export type AgentClientsResponse = {
  policy: {
    rawArtifactsIncluded: boolean;
    scope: "memory:read";
  };
  clients: AgentClientGrant[];
};

export type AgentClientRevokeResponse = {
  grantId: string;
  clientId: string;
  revokedAt: string;
  status: "revoked";
};
