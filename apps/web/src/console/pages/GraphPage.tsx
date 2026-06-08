import { GraphCanvas, GraphPageFilters } from '@/console/pages/graph/GraphCanvas'
import { useGraphPage } from '@/console/pages/graph/use-graph-page'

export function GraphPage() {
  const graphPage = useGraphPage()

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Graph inspector</h2>
      </div>

      <GraphPageFilters
        nodeTypeFilter={graphPage.nodeTypeFilter}
        isLoading={graphPage.isLoading}
        artifactId={graphPage.artifactId}
        onNodeTypeFilterChange={graphPage.setNodeTypeFilter}
        onRefresh={() => void graphPage.loadGraph()}
      />

      {graphPage.status ? <p className="console-status">{graphPage.status}</p> : null}

      <GraphCanvas
        groupedNodes={graphPage.groupedNodes}
        selectedNodeId={graphPage.selectedNodeId}
        selectedEdges={graphPage.selectedEdges}
        onSelectNode={graphPage.setSelectedNodeId}
      />
    </section>
  )
}
