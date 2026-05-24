export type ConsolePage =
  | 'ingest'
  | 'artifact-status'
  | 'retrieval'
  | 'candidate-memories'
  | 'graph'
  | 'reflections'
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
  warning: string | null
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

export const CONSOLE_PAGES: Array<{ id: ConsolePage; label: string }> = [
  { id: 'ingest', label: 'Ingest' },
  { id: 'artifact-status', label: 'Artifact Status' },
  { id: 'retrieval', label: 'Retrieval' },
  { id: 'candidate-memories', label: 'Candidates' },
  { id: 'graph', label: 'Graph' },
  { id: 'reflections', label: 'Reflections' },
  { id: 'privacy', label: 'Privacy Check' },
  { id: 'api-guide', label: 'API Guide' },
]
