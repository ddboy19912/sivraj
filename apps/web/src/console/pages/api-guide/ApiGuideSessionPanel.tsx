import { API_URL } from '@/lib/api'

type ApiGuideSessionPanelProps = {
  twinId: string
  artifactId: string
}

export function ApiGuideSessionPanel({ twinId, artifactId }: ApiGuideSessionPanelProps) {
  return (
    <div className="console-panel">
      <dl>
        <dt>API URL</dt>
        <dd>{API_URL}</dd>
        <dt>Twin ID</dt>
        <dd>{twinId}</dd>
        <dt>Latest artifact ID</dt>
        <dd>{artifactId || '—'}</dd>
      </dl>
    </div>
  )
}
