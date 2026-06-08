import { graphNodeGroupKey, type DisplayNode } from '@/console/pages/graph/graph-page-utils'
import type { GraphResponse } from '@/types/console.types'

export function groupGraphNodes(nodes: DisplayNode[] | undefined) {
  const groups = new Map<string, DisplayNode[]>()

  for (const node of nodes ?? []) {
    const key = graphNodeGroupKey(node)
    const bucket = groups.get(key) ?? []
    bucket.push(node)
    groups.set(key, bucket)
  }

  return groups
}

export function selectEdgesForNode(
  graph: { edges: GraphResponse['edges'] } | null,
  selectedNodeId: string,
) {
  if (!graph || !selectedNodeId) {
    return []
  }

  return graph.edges.filter(
    (edge) => edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId,
  )
}
