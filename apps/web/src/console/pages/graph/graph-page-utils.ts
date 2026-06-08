import type { GraphResponse } from '@/types/console.types'

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

export const GRAPH_FILTERS = [
  { value: '', label: 'All types' },
  ...GRAPH_NODE_TYPES.map((value) => ({ value, label: value })),
  { value: 'pattern', label: 'pattern (other + kind=pattern)' },
] as const

export type DisplayNode = GraphResponse['nodes'][number] & {
  contextOnly?: boolean
}

function isPatternNode(node: GraphResponse['nodes'][number]) {
  return node.nodeType === 'other' && node.properties.kind === 'pattern'
}

export function graphNodeGroupKey(node: DisplayNode) {
  if (node.contextOnly) {
    return 'connected context'
  }

  return isPatternNode(node) ? 'pattern' : node.nodeType
}

export function applyPatternView(response: GraphResponse): {
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

  const contextNodes = response.nodes.flatMap((node) =>
    contextNodeIds.has(node.id) ? [{ ...node, contextOnly: true }] : [],
  )

  return {
    nodes: [...patternNodes, ...contextNodes],
    edges,
  }
}
