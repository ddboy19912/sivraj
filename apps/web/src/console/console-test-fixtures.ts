import { expect } from 'vitest'
import { repoFingerprint } from '@/console/fixtures/engineering-fixture-shared'
import { jsonResponse } from '@/tests/helpers'

export function agentPermissionsRoutes() {
  return {
    '/v1/twins/twin-id/agents/clients': jsonResponse({
      policy: { rawArtifactsIncluded: false, scope: 'memory:read' },
      clients: [{
        clientId: 'client-id',
        grantId: 'grant-id',
        name: 'Codex',
        type: 'coding_agent',
        scopes: ['agent:context:read', 'agent:writeback:create'],
        memoryDomains: ['engineering'],
        expiresAt: '2026-05-26T00:00:00.000Z',
        revokedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
        status: 'active',
        metadata: { origin: 'agent_token_flow' },
      }],
    }),
    '/v1/twins/twin-id/agents/clients/grant-id/revoke': jsonResponse({
      grantId: 'grant-id',
      clientId: 'client-id',
      status: 'revoked',
      revokedAt: '2026-05-25T01:00:00.000Z',
    }),
  }
}

export function agentWritebacksRoutes() {
  return {
    '/v1/twins/twin-id/agents/writebacks': jsonResponse({
      policy: { rawArtifactsIncluded: false, decryptedWritebackIncluded: false, scope: 'memory:read' },
      writebacks: [{
        id: 'writeback-id',
        twinId: 'twin-id',
        clientId: 'client-id',
        status: 'pending',
        agentName: 'Codex',
        repo: 'sivraj',
        branch: 'main',
        summarySha256: 'sha256-writeback',
        rawStorageRef: 'walrus://blob/writeback',
        ciphertextSha256: 'ciphertext',
        approvedArtifactId: null,
        counts: {
          filesTouched: 2, commandsRun: 1, testsRun: 1, decisions: 1,
          bugsFound: 0, followUps: 0, userCorrections: 0,
        },
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
        approvedAt: null,
        rejectedAt: null,
      }],
    }),
    '/v1/twins/twin-id/agents/writebacks/writeback-id/approve': jsonResponse({
      writebackId: 'writeback-id',
      artifactId: 'approved-artifact-id',
      status: 'queued',
      processingJobId: 'approved-job-id',
      rawStorageRef: 'walrus://blob/writeback',
    }),
  }
}

export function browserHistoryArtifactHandler(_url: URL, init?: RequestInit) {
  expect(JSON.parse(String(init?.body))).toMatchObject({
    sourceType: 'browser_history',
    metadata: { fileType: 'text/csv', uploadKind: 'file', importer: 'browser_history_export' },
  })
  expect(String(init?.body)).not.toContain('export.csv')
  return jsonResponse({
    artifactId: 'browser-artifact-id',
    memoryFragmentId: null,
    status: 'queued',
    storageMode: 'encrypted_walrus',
    rawStorageRef: 'walrus://blob/browser',
    processingJobId: 'browser-job-id',
    warning: null,
  })
}

export function chatExportDuplicateHandler(_url: URL, init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { sourceType: string; metadata: Record<string, unknown> }
  expect(body).toMatchObject({
    sourceType: 'chat_export',
    metadata: {
      aiChatProvider: 'chatgpt',
      aiChatImportKind: 'export',
      aiChatConversationCount: 1,
      aiChatMessageCount: 2,
      importer: 'ai_chat_export',
    },
  })
  expect(typeof body.metadata.aiChatImportFingerprint).toBe('string')
  expect(String(init?.body)).not.toContain('Private launch plan')
  expect(String(init?.body)).not.toContain('What should I launch first?')
  return jsonResponse({
    artifactId: 'existing-chat-artifact-id',
    memoryFragmentId: null,
    status: 'completed',
    storageMode: 'encrypted_walrus',
    sensitivity: 'private',
    rawStorageRef: null,
    processingJobId: null,
    warning: null,
    skipped: true,
    reason: 'duplicate_ai_chat_import',
  })
}

export function candidateFeedbackHandler(url: URL, init?: RequestInit) {
  if (url.pathname.endsWith('/candidate-memories')) {
    return jsonResponse({
      candidateMemories: [{
        id: 'candidate-id',
        sourceArtifactId: 'artifact-id',
        memoryType: 'fact',
        status: 'candidate',
        subject: 'Project Alpha',
        confidenceScore: 0.9,
        statementStorageRef: 'walrus://blob/statement',
        statementSha256: 'sha256',
      }],
    })
  }
  if (url.pathname.endsWith('/feedback') && init?.method === 'POST') {
    return jsonResponse({
      feedbackId: 'feedback-id',
      targetType: 'candidate_memory',
      targetId: 'candidate-id',
      feedbackType: 'approved',
      candidateMemoryStatus: 'approved',
    })
  }
  return null
}

export function instructionPatchHandler(url: URL, init?: RequestInit) {
  if (url.pathname === '/v1/twins/twin-id/engineering/instruction-patch' && init?.method === 'POST') {
    return jsonResponse({
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        autoWriteEnabled: false,
        scope: 'memory:read',
      },
      patch: {
        preset: 'codex',
        format: 'markdown',
        targetFile: 'AGENTS.md',
        operation: 'create_or_replace',
        content: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
        suggestedMarkdown: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
        evidence: [{
          candidateMemoryId: 'candidate-id',
          sourceArtifactId: 'artifact-id',
          memoryFragmentId: 'fragment-id',
          evidenceHash: 'evidence-sha',
          evidenceLength: 30,
        }],
        warnings: [],
        quality: {
          score: 0.72,
          label: 'good',
          readyForAgent: true,
          strengths: ['Context is source-backed with evidence references.'],
          risks: [],
          recommendations: ['Packet is suitable for coding-agent handoff.'],
          metrics: { totalItems: 1 },
        },
        includedCandidate: false,
        itemCount: 1,
      },
      contextPacket: {
        project: { id: null, name: 'Sivraj', repoFingerprint },
        issues: [],
        quality: { score: 0.72, label: 'good', readyForAgent: true, strengths: [], risks: [], recommendations: [], metrics: {} },
        warnings: [],
      },
    })
  }
  return null
}

export function engineeringSourcesRoutes() {
  return {
    '/v1/twins/twin-id/engineering/sources': jsonResponse({
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        scope: 'memory:read',
      },
      summary: { sourceCount: 1, engineeringMemoryCount: 1 },
      sources: [{
        artifactId: 'artifact-id',
        sourceType: 'markdown',
        sourceFile: 'AGENTS.md',
        displayName: 'AGENTS.md',
        ingestionStatus: 'completed',
        intelligenceStatus: 'completed',
        uploadedAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:01.000Z',
        rawStorageRef: 'walrus://blob/source',
        extractedEngineeringMemoryCount: 1,
        counts: {
          byType: { agent_instruction: 1 },
          byStatus: { candidate: 1 },
          byScope: { agent_specific: 1 },
        },
        candidates: [{
          id: 'candidate-id',
          memoryType: 'fact',
          engineeringMemoryType: 'agent_instruction',
          scope: 'agent_specific',
          status: 'candidate',
          subject: 'git safety',
          agentContextLine: 'Do not revert user changes unless explicitly requested.',
          confidenceScore: 0.9,
          evidenceHash: 'evidence-sha',
          evidenceLength: 30,
          statementStorageRef: 'walrus://blob/statement',
          createdAt: '2026-05-25T00:00:02.000Z',
        }],
      }],
    }),
  }
}

export function privacyCheckRoutes() {
  return {
    '/v1/twins/twin-id/artifacts/artifact-id/privacy-check': jsonResponse({
      allChecksPassed: false,
      checklist: {
        sourceArtifactHasRawStorageRef: true,
        sourceArtifactHasCiphertextHash: false,
        sourceArtifactMetadataHasNoPlaintextFields: true,
        memoryFragmentHasContentStorageRef: true,
        candidateMemoriesUseStatementStorageRef: true,
        completedReflectionsUseSummaryStorageRef: true,
      },
      artifact: { id: 'artifact-id', rawStorageRef: 'walrus://blob/raw' },
      memoryFragment: { id: 'fragment-id', contentStorageRef: 'walrus://blob/fragment' },
      candidateMemories: [],
      reflections: [],
    }),
  }
}