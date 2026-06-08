import { ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { PrivacyCheckResults } from '@/console/pages/privacy/PrivacyCheckResults'
import { usePrivacyPage } from '@/console/pages/privacy/use-privacy-page'

export function PrivacyPage() {
  const page = usePrivacyPage()

  return (
    <ConsolePage title="Privacy verification">
      <div className="console-form inline">
        <label>
          <span>Artifact ID</span>
          <input value={page.inputArtifactId} onChange={(event) => page.setInputArtifactId(event.target.value)} />
        </label>
        <div className="console-actions">
          <button
            className="secondary-action"
            type="button"
            disabled={page.isLoading}
            onClick={() => void page.loadPrivacyCheck()}
          >
            {page.isLoading ? 'Checking...' : 'Run privacy check'}
          </button>
        </div>
      </div>

      <ConsoleStatus status={page.status} />
      {page.report ? <PrivacyCheckResults report={page.report} /> : null}
    </ConsolePage>
  )
}
