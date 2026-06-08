import { ApiGuideExamples } from '@/console/pages/api-guide/ApiGuideExamples'
import { ApiGuideSessionPanel } from '@/console/pages/api-guide/ApiGuideSessionPanel'
import { buildApiGuideExamples } from '@/console/pages/api-guide/api-guide-examples'
import { useConsoleContext } from '@/console/context'

export function ApiGuidePage() {
  const { session, artifactId } = useConsoleContext()
  const twinId = session?.twinId ?? '<twinId>'
  const token = session?.token ?? '<token>'
  const examples = buildApiGuideExamples({ twinId, token, artifactId })

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>API testing guide</h2>
      </div>

      <ApiGuideSessionPanel twinId={twinId} artifactId={artifactId} />
      <ApiGuideExamples examples={examples} />
    </section>
  )
}
