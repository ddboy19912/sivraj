import { EngineeringSourceCard } from '@/console/pages/engineering-sources/EngineeringSourceCard'
import type { EngineeringSourcesResponse } from '@/types/console.types'

type EngineeringSourcesListProps = {
  sources: EngineeringSourcesResponse['sources']
  expandedArtifactId: string | null
  onToggleExpanded: (artifactId: string) => void
  onUseAsArtifactFilter: (artifactId: string) => void
}

export function EngineeringSourcesList({
  sources,
  expandedArtifactId,
  onToggleExpanded,
  onUseAsArtifactFilter,
}: EngineeringSourcesListProps) {
  return (
    <div className="console-results">
      {sources.map((source) => (
        <EngineeringSourceCard
          key={source.artifactId}
          source={source}
          isExpanded={expandedArtifactId === source.artifactId}
          onToggleExpanded={() => onToggleExpanded(source.artifactId)}
          onUseAsArtifactFilter={() => onUseAsArtifactFilter(source.artifactId)}
        />
      ))}
    </div>
  )
}
