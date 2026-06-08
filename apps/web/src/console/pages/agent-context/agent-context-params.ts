import type { EngineeringProjectFields } from '@/types/console.types'
import type { CodingAgentExportPreset } from '@/types/console.types'

export function buildAgentContextParams(
  input: EngineeringProjectFields & {
    gitRemote: string
    preset: CodingAgentExportPreset
    includeCandidate: boolean
    artifactId: string
  },
) {
  const params = new URLSearchParams({
    projectName: input.projectName,
    repoName: input.repoName,
    packageName: input.packageName,
    packageManager: input.packageManager,
    frameworks: input.frameworks,
    preset: input.preset,
    includeCandidate: String(input.includeCandidate),
  })

  if (input.gitRemote.trim()) {
    params.set('gitRemote', input.gitRemote)
  }

  if (input.artifactId) {
    params.set('artifactId', input.artifactId)
  }

  return params
}
