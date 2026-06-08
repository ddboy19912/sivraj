import type { ArtifactDetail, ArtifactStatusEvent } from '@/types/console.types'

export function ArtifactLookupForm({
  inputArtifactId,
  isLoading,
  isRetrying,
  canRetry,
  onInputChange,
  onLoad,
  onRetry,
}: {
  inputArtifactId: string
  isLoading: boolean
  isRetrying: boolean
  canRetry: boolean
  onInputChange: (value: string) => void
  onLoad: () => void
  onRetry: () => void
}) {
  return (
    <div className="console-form inline">
      <label>
        <span>Artifact ID</span>
        <input value={inputArtifactId} onChange={(event) => onInputChange(event.target.value)} />
      </label>
      <div className="console-actions">
        <button className="secondary-action" type="button" disabled={isLoading} onClick={onLoad}>
          {isLoading ? 'Loading...' : 'Load / refresh'}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={!canRetry || isRetrying}
          onClick={onRetry}
        >
          {isRetrying ? 'Retrying...' : 'Retry failed artifact'}
        </button>
      </div>
    </div>
  )
}

export function ArtifactLifecyclePanel({
  detail,
  liveEvent,
}: {
  detail: ArtifactDetail
  liveEvent: ArtifactStatusEvent | null
}) {
  const lifecycle = buildArtifactLifecycleView(detail, liveEvent)

  return (
    <div className="console-panel">
      <h3>Lifecycle</h3>
      <dl>
        <dt>Ingestion status</dt>
        <dd>{lifecycle.ingestionStatus}</dd>
        <dt>Processing reason</dt>
        <dd>{lifecycle.processingReason}</dd>
        <dt>Intelligence status</dt>
        <dd>{lifecycle.intelligenceStatus}</dd>
        <dt>Intelligence stage</dt>
        <dd>{lifecycle.intelligenceStage}</dd>
        <dt>Source type</dt>
        <dd>{lifecycle.sourceType}</dd>
        <dt>Updated</dt>
        <dd>{lifecycle.updatedAt}</dd>
      </dl>
    </div>
  )
}

function buildArtifactLifecycleView(
  detail: ArtifactDetail,
  liveEvent: ArtifactStatusEvent | null,
) {
  return {
    ingestionStatus: coalesceDisplay(liveEvent?.status, detail.ingestionStatus),
    processingReason: coalesceDisplay(liveEvent?.reason, detail.processingReason),
    intelligenceStatus: coalesceDisplay(liveEvent?.intelligenceStatus, detail.intelligenceStatus),
    intelligenceStage: coalesceDisplay(liveEvent?.intelligenceStage),
    sourceType: detail.sourceType,
    updatedAt: detail.updatedAt,
  }
}

function coalesceDisplay(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value)) ?? '—'
}

export function ArtifactTimingsPanel({ detail }: { detail: ArtifactDetail }) {
  return (
    <div className="console-panel">
      <h3>Timings / counts</h3>
      <dl>
        <dt>Entity extraction</dt>
        <dd>{formatTiming(detail.intelligence, 'entityExtractionMs')}</dd>
        <dt>Memory extraction</dt>
        <dd>{formatTiming(detail.intelligence, 'memoryExtractionMs')}</dd>
        <dt>Candidate memories</dt>
        <dd>{detail.counts.candidateMemories}</dd>
        <dt>Memory fragment</dt>
        <dd>{detail.memoryFragment?.id ?? '—'}</dd>
        <dt>Archive status</dt>
        <dd>{readMetadataString(detail.intelligence, 'archiveStatus') ?? '—'}</dd>
      </dl>
    </div>
  )
}

export function ArtifactMetadataPanel({ detail }: { detail: ArtifactDetail }) {
  return (
    <div className="console-panel wide">
      <h3>Safe metadata</h3>
      <pre>{JSON.stringify({ processing: detail.processing, intelligence: detail.intelligence }, null, 2)}</pre>
    </div>
  )
}

function formatTiming(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' ? `${value} ms` : '—'
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}
