import { qualityMetrics, repoFingerprint } from '@/console/fixtures/engineering-fixture-shared'

const agentContextEvidence = [{
  candidateMemoryId: 'candidate-id',
  sourceArtifactId: 'artifact-id',
  memoryFragmentId: 'fragment-id',
  evidenceHash: 'evidence-sha',
  evidenceLength: 30,
}]

export function buildAgentContextQuality() {
  return {
    score: 0.76,
    label: 'good',
    readyForAgent: true,
    strengths: ['Context is source-backed with evidence references.'],
    risks: [],
    recommendations: ['Packet is suitable for coding-agent handoff; keep reviewing new candidate memories as they arrive.'],
    metrics: qualityMetrics,
  }
}

export function buildAgentContextPacket() {
  return {
    purpose: 'coding_agent_context',
    project: { id: null, name: 'Sivraj', repoFingerprint },
    generatedAt: '2026-05-25T00:00:00.000Z',
    counts: { totalItems: 1, evidenceRefs: 1 },
    sections: {
      agentInstructions: [{
        id: 'candidate-id',
        type: 'agent_instruction',
        scope: 'agent_specific',
        subject: 'git safety',
        agentContextLine: 'Do not revert user changes unless explicitly requested.',
        confidence: 0.91,
        status: 'candidate',
        metadata: { sourceKind: 'agent_instruction_file' },
        evidence: agentContextEvidence[0],
      }],
      userPreferences: [],
      projectConventions: [],
      architectureRules: [],
      styleRules: [],
      testingPractices: [],
      deploymentEnvironment: [],
      securityBoundaries: [],
      knownPitfalls: [],
    },
    evidence: agentContextEvidence,
    issues: [],
    quality: buildAgentContextQuality(),
    warnings: [],
  }
}

export function buildAgentContextExport() {
  return {
    preset: 'codex',
    format: 'markdown',
    targetFile: 'AGENTS.md',
    content: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
    warnings: [],
    includedCandidate: true,
    itemCount: 1,
  }
}
