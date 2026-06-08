import { useState } from 'react'
import { requireConsoleSession } from '@/console/console-session'
import type { EngineeringProjectFields } from '@/types/console.types'
import {
  agentContextErrorMessage,
  copyAgentContextMarkdown,
  fetchAgentContext,
} from '@/console/pages/agent-context/agent-context-actions'
import { useConsoleContext } from '@/console/context'
import type { AgentContextResponse, CodingAgentExportPreset } from '@/types/console.types'

export function useAgentContextPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId } = useConsoleContext()
  const [projectFields, setProjectFields] = useState<EngineeringProjectFields>({
    projectName: 'Sivraj',
    repoName: 'sivraj',
    packageName: 'sivraj',
    packageManager: 'pnpm',
    frameworks: 'vite, react',
  })
  const [gitRemote, setGitRemote] = useState('')
  const [preset, setPreset] = useState<CodingAgentExportPreset>('codex')
  const [includeCandidate, setIncludeCandidate] = useState(true)
  const [context, setContext] = useState<AgentContextResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadContext() {
    if (
      !requireConsoleSession(
        session,
        isSessionForWallet,
        setStatus,
        'Connect wallet and sign in to fetch agent context.',
      )
    ) {
      return
    }

    setIsLoading(true)

    try {
      const response = await fetchAgentContext({
        session: session!,
        onSessionRefreshed,
        projectFields,
        gitRemote,
        preset,
        includeCandidate,
        artifactId,
      })
      setContext(response)
      setStatus(`${response.profileSummary.includedContextItems} context item(s) ready for coding agents.`)
      setIsLoading(false)
    } catch (error) {
      setContext(null)
      setStatus(agentContextErrorMessage(error))
      setIsLoading(false)
    }
  }

  async function copyMarkdown() {
    if (!context?.contextExport?.content) {
      return
    }

    try {
      await copyAgentContextMarkdown(context.contextExport.content)
      setStatus(`Copied ${context.contextExport.targetFile} context export.`)
    } catch {
      setStatus('Copy failed. Select the context export manually.')
    }
  }

  return {
    artifactId,
    context,
    copyMarkdown,
    gitRemote,
    includeCandidate,
    isLoading,
    loadContext,
    preset,
    projectFields,
    session,
    setGitRemote,
    setIncludeCandidate,
    setPreset,
    setProjectFields,
    status,
  }
}
