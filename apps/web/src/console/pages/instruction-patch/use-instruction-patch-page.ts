import { useState } from 'react'
import { requireConsoleSession } from '@/console/console-session'
import type { EngineeringProjectFields } from '@/types/console.types'
import {
  copyInstructionPatch,
  generateInstructionPatch,
  instructionPatchErrorMessage,
} from '@/console/pages/instruction-patch/instruction-patch-actions'
import { useConsoleContext } from '@/console/context'
import type { CodingAgentExportPreset, EngineeringInstructionPatchResponse } from '@/types/console.types'

const DEFAULT_PROJECT_FIELDS: EngineeringProjectFields = {
  projectName: 'Sivraj',
  repoName: 'sivraj',
  packageName: 'sivraj',
  packageManager: 'pnpm',
  frameworks: 'vite, react',
}

export function useInstructionPatchPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [projectFields, setProjectFields] = useState<EngineeringProjectFields>(DEFAULT_PROJECT_FIELDS)
  const [preset, setPreset] = useState<CodingAgentExportPreset>('codex')
  const [includeCandidate, setIncludeCandidate] = useState(false)
  const [patch, setPatch] = useState<EngineeringInstructionPatchResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function generatePatch() {
    if (
      !requireConsoleSession(
        session,
        isSessionForWallet,
        setStatus,
        'Connect wallet and sign in to generate an instruction patch.',
      )
    ) {
      return
    }

    setIsLoading(true)

    try {
      const response = await generateInstructionPatch({
        session: session!,
        onSessionRefreshed,
        projectFields,
        preset,
        includeCandidate,
      })
      setPatch(response)
      setStatus(`${response.patch.targetFile} suggestion generated with ${response.patch.itemCount} rule(s).`)
      setIsLoading(false)
    } catch (error) {
      setPatch(null)
      setStatus(instructionPatchErrorMessage(error))
      setIsLoading(false)
    }
  }

  async function copyPatch() {
    if (!patch) {
      return
    }

    try {
      await copyInstructionPatch(patch.patch.content || patch.patch.suggestedMarkdown)
      setStatus(`Copied ${patch.patch.targetFile} suggestion.`)
    } catch {
      setStatus('Copy failed. Select the markdown manually.')
    }
  }

  function updateProjectField(field: keyof EngineeringProjectFields, value: string) {
    setProjectFields((current) => ({ ...current, [field]: value }))
  }

  return {
    copyPatch,
    generatePatch,
    includeCandidate,
    isLoading,
    patch,
    preset,
    projectFields,
    setIncludeCandidate,
    setPreset,
    status,
    updateProjectField,
  }
}
