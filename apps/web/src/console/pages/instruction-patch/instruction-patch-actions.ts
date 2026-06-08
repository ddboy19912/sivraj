import { errorMessage, postAuthedJson } from '@/lib/api'
import type { EngineeringProjectFields } from '@/types/console.types'
import type { CodingAgentExportPreset, EngineeringInstructionPatchResponse } from '@/types/console.types'
import type { Session } from '@/lib/session'

export async function generateInstructionPatch(input: {
  session: Session
  onSessionRefreshed: (session: Session) => void
  projectFields: EngineeringProjectFields
  preset: CodingAgentExportPreset
  includeCandidate: boolean
}) {
  return postAuthedJson<EngineeringInstructionPatchResponse>(
    `/v1/twins/${input.session.twinId}/engineering/instruction-patch`,
    {
      ...input.projectFields,
      preset: input.preset,
      includeCandidate: input.includeCandidate,
    },
    input.session,
    input.onSessionRefreshed,
  )
}

export async function copyInstructionPatch(content: string) {
  await navigator.clipboard.writeText(content)
}

export function instructionPatchErrorMessage(error: unknown) {
  return errorMessage(error)
}
