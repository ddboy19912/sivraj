import { GRAPH_FILTERS } from '@/console/pages/graph/graph-page-utils'
import type { DisplayNode } from '@/console/pages/graph/graph-page-utils'
import type { GraphResponse } from '@/types/console.types'

type GraphPageFiltersProps = {
  nodeTypeFilter: string
  isLoading: boolean
  artifactId: string | null
  onNodeTypeFilterChange: (value: string) => void
  onRefresh: () => void
}

export function GraphPageFilters({
  nodeTypeFilter,
  isLoading,
  artifactId,
  onNodeTypeFilterChange,
  onRefresh,
}: GraphPageFiltersProps) {
  return (
    <div className="console-form inline">
      <label>
        <span>Node type filter</span>
        <select
          value={nodeTypeFilter}
          onChange={(event) => onNodeTypeFilterChange(event.target.value)}
        >
          {GRAPH_FILTERS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="console-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={isLoading}
          onClick={onRefresh}
        >
          {isLoading ? 'Loading...' : 'Refresh graph'}
        </button>
        {artifactId ? (
          <span className="console-chip">Artifact {artifactId.slice(0, 8)}…</span>
        ) : null}
      </div>
    </div>
  )
}

type GraphCanvasProps = {
  groupedNodes: Map<string, DisplayNode[]>
  selectedNodeId: string
  selectedEdges: GraphResponse['edges']
  onSelectNode: (nodeId: string) => void
}

export function GraphCanvas({
  groupedNodes,
  selectedNodeId,
  selectedEdges,
  onSelectNode,
}: GraphCanvasProps) {
  return (
    <div className="console-grid">
      {[...groupedNodes.entries()].map(([type, nodes]) => (
        <div key={type} className="console-panel">
          <h3>{type}</h3>
          <ul className="console-list">
            {nodes.map((node) => (
              <li key={node.id} className={node.contextOnly ? 'context-node' : undefined}>
                <button className="text-action" type="button" onClick={() => onSelectNode(node.id)}>
                  {node.name}
                </button>
                <span>{node.confidenceScore ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="console-panel wide">
        <h3>Edges for selected node</h3>
        {selectedNodeId ? (
          <pre>{JSON.stringify(selectedEdges, null, 2)}</pre>
        ) : (
          <p>Select a node to inspect connected edges.</p>
        )}
      </div>
    </div>
  )
}
