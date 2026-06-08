import {
  buildAgentContextExport,
  buildAgentContextPacket,
  buildAgentContextQuality,
} from '@/console/fixtures/agent-context-response-parts'

export function agentContextResponse() {
  return {
    policy: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
      scope: 'memory:read',
    },
    relationship: {
      sivraj: 'Remembers encrypted engineering context.',
      codingAgents: 'Execute coding tasks.',
      handoff: 'Use contextMarkdown.',
    },
    contextPacket: buildAgentContextPacket(),
    contextMarkdown: '# Sivraj Coding Agent Context\n\n## Apply These Rules\n- Do not revert user changes unless explicitly requested.\n',
    contextExport: buildAgentContextExport(),
    profileSummary: {
      totalEngineeringMemories: 1,
      includedContextItems: 1,
      evidenceRefs: 1,
      warnings: [],
      issues: [],
      quality: buildAgentContextQuality(),
    },
  }
}
