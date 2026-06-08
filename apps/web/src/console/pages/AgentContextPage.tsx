import {
  ConsoleCheckbox,
  ConsoleInfoPanel,
  ConsolePage,
  ConsoleStatus,
  EngineeringProjectFieldInputs,
  ExportPresetSelect,
} from '@/console/console-page-ui'
import { AgentContextResults } from '@/console/pages/AgentContextResults'
import { useAgentContextPage } from '@/console/pages/agent-context/use-agent-context-page'

export function AgentContextPage() {
  const page = useAgentContextPage()

  return (
    <ConsolePage title="Agent context export">
      <ConsoleInfoPanel
        items={[
          {
            term: 'Relationship',
            detail:
              'Sivraj remembers and exports context. Coding agents execute code tasks using that context.',
          },
          { term: 'Current twin', detail: page.session?.twinId ?? '—' },
          { term: 'Artifact filter', detail: page.artifactId || 'All engineering memories' },
        ]}
      />

      <form
        className="console-form inline"
        onSubmit={(event) => {
          event.preventDefault()
          void page.loadContext()
        }}
      >
        <EngineeringProjectFieldInputs
          variant="context"
          values={page.projectFields}
          onChange={(field, value) =>
            page.setProjectFields((current) => ({ ...current, [field]: value }))
          }
          gitRemote={page.gitRemote}
          onGitRemoteChange={page.setGitRemote}
        />
        <ExportPresetSelect value={page.preset} onChange={page.setPreset} />
        <ConsoleCheckbox
          checked={page.includeCandidate}
          onChange={page.setIncludeCandidate}
          label="Include candidate memories"
        />
        <button className="primary-action" type="submit" disabled={page.isLoading}>
          {page.isLoading ? 'Fetching...' : 'Fetch agent context'}
        </button>
      </form>

      <ConsoleStatus status={page.status} />
      {page.context ? (
        <AgentContextResults context={page.context} onCopyMarkdown={() => void page.copyMarkdown()} />
      ) : null}
    </ConsolePage>
  )
}
