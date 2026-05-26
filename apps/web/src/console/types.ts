export type ConsolePage =
  | 'ingest'
  | 'artifact-status'
  | 'retrieval'
  | 'candidate-memories'
  | 'agent-permissions'
  | 'agent-writebacks'
  | 'agent-context'
  | 'engineering-review'
  | 'instruction-patch'
  | 'engineering-sources'
  | 'graph'
  | 'reflections'
  | 'connectors'
  | 'privacy'
  | 'api-guide'

export type ArtifactReceipt = {
  artifactId: string
  memoryFragmentId: string | null
  status: string
  storageMode: string
  sensitivity?: string
  rawStorageRef: string | null
  processingJobId?: string | null
  warning?: string | null
  skipped?: boolean
  reason?: string
}

export type ArtifactStatusEvent = {
  artifactId: string
  twinId: string
  sourceType: string
  status: string
  intelligenceStatus?: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'
  intelligenceStage?: 'entity_extraction' | 'memory_extraction'
  reason?: string
  occurredAt: string
}

export type ArtifactDetail = {
  id: string
  twinId: string
  sourceType: string
  ingestionStatus: string
  intelligenceStatus?: string
  processingReason?: string
  rawStorageRef: string | null
  hash: string | null
  ciphertextSha256?: string | null
  storageMode?: string | null
  processing?: Record<string, unknown>
  intelligence?: Record<string, unknown>
  memoryFragment: {
    id: string
    contentStorageRef: string | null
    contentSha256: string | null
  } | null
  counts: {
    candidateMemories: number
  }
  createdAt: string
  updatedAt: string
}

export type CandidateMemoryRow = {
  id: string
  canonicalMemoryId: string | null
  sourceArtifactId: string
  memoryType: string
  status: string
  subject: string | null
  confidenceScore: number | null
  statementStorageRef: string
  statementSha256: string
}

export type AgentClientRow = {
  clientId: string
  grantId: string
  name: string
  type: string
  scopes: string[]
  memoryDomains: string[]
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
  status: string
  metadata: Record<string, unknown>
}

export type AgentClientsResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    scope: string
  }
  clients: AgentClientRow[]
}

export type AgentWritebackRow = {
  id: string
  twinId: string
  clientId: string
  status: string
  agentName: string
  repo: string | null
  branch: string | null
  summarySha256: string | null
  rawStorageRef: string | null
  ciphertextSha256: string | null
  approvedArtifactId: string | null
  counts: {
    filesTouched: number
    commandsRun: number
    testsRun: number
    decisions: number
    bugsFound: number
    followUps: number
    userCorrections: number
  }
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  rejectedAt: string | null
}

export type AgentWritebacksResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    decryptedWritebackIncluded: boolean
    scope: string
  }
  writebacks: AgentWritebackRow[]
}

export type MemorySearchResult = {
  results: Array<{
    id: string
    sourceArtifactId: string
    content: string
    score: number
    matchedTerms: string[]
    canonicalMemoryId?: string | null
    citation?: {
      sourceArtifactId: string
    }
  }>
  policy?: {
    rawArtifactsIncluded: boolean
    scope: string
    privateFragmentsSkipped?: number
    searchMode?: string
    indexMatchCount?: number
    searchedFragmentCount?: number
    encryptedFragmentCount?: number
    selectedForDecryptCount?: number
    decryptedCandidateCount?: number
    decryptSkippedCount?: number
    duplicateResultsHidden?: number
    timing?: Record<string, number>
  }
}

export type PrivacyCheckResponse = {
  allChecksPassed: boolean
  checklist: Record<string, boolean>
  artifact: {
    id: string
    rawStorageRef: string | null
    ciphertextSha256?: string | null
  }
  memoryFragment: {
    id: string
    contentStorageRef: string | null
  } | null
  candidateMemories: Array<{ id: string; statementStorageRef: string }>
  reflections: Array<{ id: string; summaryStorageRef: string | null }>
}

export type GraphResponse = {
  nodes: Array<{
    id: string
    nodeType: string
    name: string
    normalizedName: string
    properties: Record<string, unknown>
    confidenceScore: number | null
  }>
  edges: Array<{
    id: string
    fromNodeId: string
    toNodeId: string
    edgeType: string
    evidenceMemoryIds: string[]
  }>
}

export type ReflectionRun = {
  id: string
  periodStart: string
  periodEnd: string
  status: string
  summaryStorageRef: string | null
  summarySha256: string | null
  metadata: Record<string, unknown>
}

export type ConnectorSource = {
  id: string
  connectorAccountId: string
  provider: string
  sourceType: string
  externalSourceId: string
  displayName: string
  uri: string | null
  status: string
  cursor: string | null
  lastSyncAt: string | null
  nextSyncAt: string | null
  errorCode: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type ConnectorSyncRun = {
  id: string
  twinId: string
  connectorAccountId: string
  connectorSourceId: string | null
  provider: string
  mode: string
  status: string
  cursorBefore: string | null
  cursorAfter: string | null
  addedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  errorCode: string | null
  errorMessage: string | null
  metadata: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ConnectorAccount = {
  id: string
  twinId: string
  provider: string
  status: string
  externalAccountId: string | null
  displayName: string
  scopes: string[]
  syncCadence: string
  tokenRef: string | null
  cursor: string | null
  lastSyncAt: string | null
  nextSyncAt: string | null
  errorCode: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  sources: ConnectorSource[]
  lastSyncRun: ConnectorSyncRun | null
}

export type ConnectorsResponse = {
  accounts: ConnectorAccount[]
  recentSyncRuns: ConnectorSyncRun[]
}

export type ConnectorAccountResponse = {
  account: Omit<ConnectorAccount, 'sources' | 'lastSyncRun'>
  source: ConnectorSource | null
}

export type ConnectorSyncResponse = {
  syncRun: ConnectorSyncRun
  jobId: string | null
  warning: string | null
}

export type AgentContextResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    decryptedMemoryIncluded: boolean
    plaintextStatementsIncluded: boolean
    derivedEngineeringContextIncluded?: boolean
    scope: string
  }
  relationship: {
    sivraj: string
    codingAgents: string
    handoff: string
  }
  contextPacket: {
    purpose: string
    project: {
      id: string | null
      name: string | null
      repoFingerprint: {
        projectId: string | null
        projectName: string | null
        repoName: string | null
        packageName: string | null
        gitRemote: string | null
        packageManager: string | null
        frameworks: string[]
        lockfiles: string[]
        rootMarkers: string[]
      }
    }
    generatedAt: string
    counts: {
      totalItems: number
      evidenceRefs: number
    }
    sections: Record<string, Array<{
      id: string
      type: string
      scope: string
      subject: string | null
      agentContextLine: string
      confidence: number
      status: string
      metadata: Record<string, unknown>
      evidence: {
        candidateMemoryId: string
        sourceArtifactId: string
        memoryFragmentId: string
        evidenceHash: string
        evidenceLength: number | null
      }
    }>>
    evidence: Array<{
      candidateMemoryId: string
      sourceArtifactId: string
      memoryFragmentId: string
      evidenceHash: string
      evidenceLength: number | null
    }>
    issues: Array<{
      issueType: string
      reason: string
      severity: string
      candidateId: string | null
      existingId: string | null
      subject: string | null
      scope: string
      metadata: Record<string, unknown>
    }>
    quality: {
      score: number
      label: string
      readyForAgent: boolean
      strengths: string[]
      risks: string[]
      recommendations: string[]
      metrics: Record<string, number>
    }
    warnings: string[]
  }
  contextMarkdown: string
  contextExport: {
    preset: CodingAgentExportPreset
    format: CodingAgentExportFormat
    targetFile: CodingAgentExportTargetFile
    content: string
    warnings: string[]
    includedCandidate: boolean
    itemCount: number
  }
  profileSummary: {
    totalEngineeringMemories: number
    includedContextItems: number
    evidenceRefs: number
    warnings: string[]
    issues?: Array<{
      reason: string
      severity: string
      candidateId: string | null
      existingId: string | null
    }>
    quality?: {
      score: number
      label: string
      readyForAgent: boolean
      strengths: string[]
      risks: string[]
      recommendations: string[]
      metrics: Record<string, number>
    }
    repoFingerprint?: {
      projectId: string | null
      projectName: string | null
      repoName: string | null
      packageName: string | null
      gitRemote: string | null
      packageManager: string | null
      frameworks: string[]
      lockfiles: string[]
      rootMarkers: string[]
    }
  }
}

export type CodingAgentExportPreset = 'codex' | 'claude_code' | 'cursor' | 'generic_mcp'
export type CodingAgentExportFormat = 'markdown' | 'mdc' | 'json'
export type CodingAgentExportTargetFile = 'AGENTS.md' | 'CLAUDE.md' | '.cursor/rules/sivraj.mdc' | 'sivraj-context.json'

export type EngineeringReviewQueueResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    decryptedMemoryIncluded: boolean
    plaintextStatementsIncluded: boolean
    derivedEngineeringContextIncluded: boolean
    scope: string
  }
  summary: {
    totalEngineeringMemories: number
    issueCount: number
    quality: {
      score: number
      label: string
      readyForAgent: boolean
      strengths: string[]
      risks: string[]
      recommendations: string[]
      metrics: Record<string, number>
    }
  }
  repoFingerprint: {
    projectId: string | null
    projectName: string | null
    repoName: string | null
    packageName: string | null
    gitRemote: string | null
    packageManager: string | null
    frameworks: string[]
    lockfiles: string[]
    rootMarkers: string[]
  }
  issues: Array<{
    issueType: string
    reason: string
    severity: string
    subject: string | null
    scope: string
    metadata: Record<string, unknown>
    candidate: EngineeringReviewCandidate | null
    existing: EngineeringReviewCandidate | null
  }>
}

export type EngineeringReviewCandidate = {
  id: string
  sourceArtifactId: string
  memoryFragmentId: string
  memoryType: string
  engineeringMemoryType: string
  scope: string
  status: string
  subject: string | null
  agentContextLine: string | null
  confidenceScore: number | null
  evidenceHash: string
  evidenceLength: number | null
  statementStorageRef: string
  metadata: Record<string, unknown>
}

export type EngineeringInstructionPatchResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    decryptedMemoryIncluded: boolean
    plaintextStatementsIncluded: boolean
    derivedEngineeringContextIncluded: boolean
    autoWriteEnabled: boolean
    scope: string
  }
  patch: {
    preset: CodingAgentExportPreset
    format: CodingAgentExportFormat
    targetFile: CodingAgentExportTargetFile
    operation: string
    content: string
    suggestedMarkdown: string
    evidence: Array<{
      candidateMemoryId: string
      sourceArtifactId: string
      memoryFragmentId: string
      evidenceHash: string
      evidenceLength: number | null
    }>
    warnings: string[]
    quality: {
      score: number
      label: string
      readyForAgent: boolean
      strengths: string[]
      risks: string[]
      recommendations: string[]
      metrics: Record<string, number>
    }
    includedCandidate: boolean
    itemCount: number
  }
  contextPacket: {
    project: AgentContextResponse['contextPacket']['project']
    issues: AgentContextResponse['contextPacket']['issues']
    quality: AgentContextResponse['contextPacket']['quality']
    warnings: string[]
  }
}

export type EngineeringSourcesResponse = {
  policy: {
    rawArtifactsIncluded: boolean
    decryptedMemoryIncluded: boolean
    plaintextStatementsIncluded: boolean
    derivedEngineeringContextIncluded: boolean
    scope: string
  }
  summary: {
    sourceCount: number
    engineeringMemoryCount: number
  }
  sources: Array<{
    artifactId: string
    sourceType: string
    sourceFile: string | null
    displayName: string
    ingestionStatus: string
    intelligenceStatus: string | null
    uploadedAt: string
    updatedAt: string
    rawStorageRef: string | null
    extractedEngineeringMemoryCount: number
    counts: {
      byType: Record<string, number>
      byStatus: Record<string, number>
      byScope: Record<string, number>
    }
    candidates: Array<{
      id: string
      memoryType: string
      engineeringMemoryType: string
      scope: string
      status: string
      subject: string | null
      agentContextLine: string | null
      confidenceScore: number | null
      evidenceHash: string
      evidenceLength: number | null
      statementStorageRef: string
      createdAt: string
    }>
  }>
}

export const CONSOLE_PAGES: Array<{ id: ConsolePage; label: string }> = [
  { id: 'ingest', label: 'Ingest' },
  { id: 'artifact-status', label: 'Artifact Status' },
  { id: 'retrieval', label: 'Retrieval' },
  { id: 'candidate-memories', label: 'Candidates' },
  { id: 'agent-permissions', label: 'Agent Permissions' },
  { id: 'agent-writebacks', label: 'Agent Writebacks' },
  { id: 'agent-context', label: 'Agent Context' },
  { id: 'engineering-review', label: 'Instruction Review' },
  { id: 'instruction-patch', label: 'Instruction Patch' },
  { id: 'engineering-sources', label: 'Instruction Sources' },
  { id: 'graph', label: 'Graph' },
  { id: 'reflections', label: 'Reflections' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'privacy', label: 'Privacy Check' },
  { id: 'api-guide', label: 'API Guide' },
]
