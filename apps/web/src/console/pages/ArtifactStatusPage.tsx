import {
  ArtifactLifecyclePanel,
  ArtifactLookupForm,
  ArtifactMetadataPanel,
  ArtifactTimingsPanel,
} from '@/console/pages/artifact-status/ArtifactStatusPanels'
import { useArtifactStatusPage } from '@/console/pages/artifact-status/use-artifact-status-page'

export function ArtifactStatusPage() {
  const page = useArtifactStatusPage()

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Artifact status</h2>
      </div>

      <ArtifactLookupForm
        inputArtifactId={page.inputArtifactId}
        isLoading={page.isLoading}
        isRetrying={page.isRetrying}
        canRetry={page.canRetry}
        onInputChange={page.setInputArtifactId}
        onLoad={() => void page.loadDetail()}
        onRetry={() => void page.handleRetry()}
      />

      {page.status ? <p className="console-status">{page.status}</p> : null}

      {page.detail ? (
        <div className="console-grid">
          <ArtifactLifecyclePanel detail={page.detail} liveEvent={page.liveEvent} />
          <ArtifactTimingsPanel detail={page.detail} />
          <ArtifactMetadataPanel detail={page.detail} />
        </div>
      ) : null}
    </section>
  )
}
