import { useEffect, useMemo, useState } from 'react'
import { errorMessage, getAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { GraphResponse } from '../types'

const GRAPH_NODE_TYPES = [
  'project',
  'goal',
  'decision',
  'concept',
  'artifact',
  'person',
  'organization',
  'topic',
  'event',
  'other',
] as const

const GRAPH_FILTERS = [
  { value: '', label: 'All types' },
  ...GRAPH_NODE_TYPES.map((value) => ({ value, label: value })),
  { value: 'pattern', label: 'pattern (other + kind=pattern)' },
] as const

type DisplayNode = GraphResponse['nodes'][number] & {
  contextOnly?: boolean
}

function isPatternNode(node: GraphResponse['nodes'][number]) {
  return node.nodeType === 'other' && node.properties.kind === 'pattern'
}

function graphNodeGroupKey(node: DisplayNode) {
  if (node.contextOnly) {
    return 'connected context'
  }

  return isPatternNode(node) ? 'pattern' : node.nodeType
}

function applyPatternView(response: GraphResponse): {
  nodes: DisplayNode[]
  edges: GraphResponse['edges']
} {
  const patternNodes = response.nodes.filter(isPatternNode)
  const patternNodeIds = new Set(patternNodes.map((node) => node.id))
  const edges = response.edges.filter(
    (edge) => patternNodeIds.has(edge.fromNodeId) || patternNodeIds.has(edge.toNodeId),
  )
  const contextNodeIds = new Set<string>()

  for (const edge of edges) {
    if (!patternNodeIds.has(edge.fromNodeId)) {
      contextNodeIds.add(edge.fromNodeId)
    }

    if (!patternNodeIds.has(edge.toNodeId)) {
      contextNodeIds.add(edge.toNodeId)
    }
  }

  const contextNodes = response.nodes
    .filter((node) => contextNodeIds.has(node.id))
    .map((node) => ({ ...node, contextOnly: true }))

  return {
    nodes: [...patternNodes, ...contextNodes],
    edges,
  }
}

export function GraphPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId } = useConsoleContext()
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>('')
  const [graph, setGraph] = useState<{ nodes: DisplayNode[]; edges: GraphResponse['edges'] } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadGraph() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const params = new URLSearchParams()
      const apiNodeType = nodeTypeFilter === 'pattern' ? 'other' : nodeTypeFilter

      if (apiNodeType) {
        params.set('nodeType', apiNodeType)
      }

      if (artifactId) {
        params.set('artifactId', artifactId)
      }

      const query = params.size > 0 ? `?${params.toString()}` : ''
      const response = await getAuthedJson<GraphResponse>(
        `/v1/twins/${session.twinId}/graph${query}`,
        session,
        onSessionRefreshed,
      )
      const nextGraph =
        nodeTypeFilter === 'pattern'
          ? applyPatternView(response)
          : { nodes: response.nodes, edges: response.edges }

      setGraph(nextGraph)
      setStatus(`${nextGraph.nodes.length} node(s), ${nextGraph.edges.length} edge(s).`)
    } catch (error) {
      setGraph(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadGraph()
    }
  }, [artifactId, isSessionForWallet, session?.twinId])

  const groupedNodes = useMemo(() => {
    const groups = new Map<string, DisplayNode[]>()

    for (const node of graph?.nodes ?? []) {
      const key = graphNodeGroupKey(node)
      const bucket = groups.get(key) ?? []
      bucket.push(node)
      groups.set(key, bucket)
    }

    return groups
  }, [graph])

  const selectedEdges = useMemo(() => {
    if (!graph || !selectedNodeId) {
      return []
    }

    return graph.edges.filter(
      (edge) => edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId,
    )
  }, [graph, selectedNodeId])

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Graph inspector</h2>
      </div>

      <div className="console-form inline">
        <label>
          <span>Node type filter</span>
          <select value={nodeTypeFilter} onChange={(event) => setNodeTypeFilter(event.target.value)}>
            {GRAPH_FILTERS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="console-actions">
          <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadGraph()}>
            {isLoading ? 'Loading...' : 'Refresh graph'}
          </button>
          {artifactId ? <span className="console-chip">Artifact {artifactId.slice(0, 8)}…</span> : null}
        </div>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      <div className="console-grid">
        {[...groupedNodes.entries()].map(([type, nodes]) => (
          <div key={type} className="console-panel">
            <h3>{type}</h3>
            <ul className="console-list">
              {nodes.map((node) => (
                <li key={node.id} className={node.contextOnly ? 'context-node' : undefined}>
                  <button className="text-action" type="button" onClick={() => setSelectedNodeId(node.id)}>
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
    </section>
  )
}
