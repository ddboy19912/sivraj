import {
  ConsoleInfoPanel,
  ConsolePage,
  ConsoleRefreshButton,
  ConsoleStatus,
} from '@/console/console-page-ui'
import { EngineeringSourcesList } from '@/console/pages/engineering-sources/EngineeringSourcesList'
import { useEngineeringSourcesPage } from '@/console/pages/engineering-sources/use-engineering-sources-page'

export function EngineeringSourcesPage() {
  const engineeringSources = useEngineeringSourcesPage()

  return (
    <ConsolePage title="Instruction sources">
      <ConsoleInfoPanel
        items={[
          {
            term: 'Purpose',
            detail: 'Shows the files and artifacts Sivraj used to learn engineering rules for coding agents.',
          },
          {
            term: 'Privacy',
            detail: 'Raw file bodies are not shown. Only source metadata, derived context lines, encrypted refs, and evidence IDs are displayed.',
          },
        ]}
      />

      <div className="console-actions">
        <ConsoleRefreshButton
          isLoading={engineeringSources.isLoading}
          label="Refresh sources"
          onClick={() => void engineeringSources.loadSources()}
        />
      </div>

      <ConsoleStatus status={engineeringSources.status} />

      {engineeringSources.response?.sources.length === 0 ? (
        <p className="console-banner warn">
          No engineering instruction sources found yet. Upload AGENTS.md, CLAUDE.md, Cursor rules, architecture docs, or coding preference notes, then wait for intelligence to complete.
        </p>
      ) : null}

      {engineeringSources.response?.sources ? (
        <EngineeringSourcesList
          sources={engineeringSources.response.sources}
          expandedArtifactId={engineeringSources.expandedArtifactId}
          onToggleExpanded={engineeringSources.toggleExpandedArtifact}
          onUseAsArtifactFilter={engineeringSources.setArtifactId}
        />
      ) : null}
    </ConsolePage>
  )
}
