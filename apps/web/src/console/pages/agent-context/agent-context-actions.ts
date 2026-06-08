import { buildAgentContextParams } from '@/console/pages/agent-context/agent-context-params'
import { errorMessage, getAuthedJson } from '@/lib/api'
import type { EngineeringProjectFields } from '@/types/console.types'
import type { AgentContextResponse, CodingAgentExportPreset } from '@/types/console.types'
import type { Session } from '@/lib/session'

export async function fetchAgentContext(input: {
  session: Session
  onSessionRefreshed: (session: Session) => void
  projectFields: EngineeringProjectFields
  gitRemote: string
  preset: CodingAgentExportPreset
  includeCandidate: boolean
  artifactId: string
}) {
  const params = buildAgentContextParams({
    ...input.projectFields,
    gitRemote: input.gitRemote,
    preset: input.preset,
    includeCandidate: input.includeCandidate,
    artifactId: input.artifactId,
  })

  return getAuthedJson<AgentContextResponse>(
    `/v1/twins/${input.session.twinId}/engineering/context?${params.toString()}`,
    input.session,
    input.onSessionRefreshed,
  )
}

export async function copyAgentContextMarkdown(content: string) {
  await navigator.clipboard.writeText(content)
}

export function agentContextErrorMessage(error: unknown) {
  return errorMessage(error)
}
