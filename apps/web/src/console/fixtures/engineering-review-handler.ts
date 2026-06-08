import { qualityMetrics, repoFingerprint } from '@/console/fixtures/engineering-fixture-shared'
import { jsonResponse } from '@/tests/helpers'

function engineeringReviewQueueResponse() {
  return jsonResponse({
    policy: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
      scope: 'memory:read',
    },
    summary: {
      totalEngineeringMemories: 2,
      issueCount: 1,
      quality: {
        score: 0.41,
        label: 'risky',
        readyForAgent: false,
        strengths: ['Context is source-backed with evidence references.'],
        risks: ['Conflicting or stale context issues were detected.'],
        recommendations: ['Review context issues before handing this packet to an autonomous coding agent.'],
        metrics: { ...qualityMetrics, totalItems: 2, candidateItems: 2, evidenceRefs: 2, issueCount: 1 },
      },
    },
    repoFingerprint,
    issues: [{
      issueType: 'conflict',
      reason: 'package_manager_conflict',
      severity: 'medium',
      subject: 'npm',
      scope: 'agent_specific',
      metadata: { candidateChoice: 'npm', existingChoice: 'pnpm' },
      candidate: {
        id: 'candidate-id',
        sourceArtifactId: 'artifact-id',
        memoryFragmentId: 'fragment-id',
        memoryType: 'preference',
        engineeringMemoryType: 'tool_preference',
        scope: 'agent_specific',
        status: 'candidate',
        subject: 'npm',
        agentContextLine: 'Use npm for package management.',
        confidenceScore: 0.7,
        evidenceHash: 'evidence-sha',
        evidenceLength: 32,
        statementStorageRef: 'walrus://blob/statement',
        metadata: {},
      },
      existing: null,
    }],
  })
}

function engineeringReviewActionResponse() {
  return jsonResponse({
    candidateId: 'candidate-id',
    action: 'supersede',
    status: 'superseded',
    feedbackId: 'feedback-id',
  })
}

export function engineeringReviewHandler(url: URL, init?: RequestInit) {
  if (url.pathname === '/v1/twins/twin-id/engineering/review-queue' && init?.method !== 'POST') {
    return engineeringReviewQueueResponse()
  }
  if (url.pathname === '/v1/twins/twin-id/engineering/review-queue/candidate-id/action' && init?.method === 'POST') {
    return engineeringReviewActionResponse()
  }
  return null
}
