import { useState } from 'react'
import {
  groupGraphNodes,
  selectEdgesForNode,
} from '@/console/pages/graph/graph-page-selectors'
import { useGraphPageLoader } from '@/console/pages/graph/use-graph-page-loader'
import { useConsoleContext } from '@/console/context'

export function useGraphPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId } = useConsoleContext()
  const [nodeTypeFilter, setNodeTypeFilter] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const { graph, status, isLoading, loadGraph } = useGraphPageLoader({
    session,
    isSessionForWallet,
    nodeTypeFilter,
    artifactId,
    onSessionRefreshed,
  })

  const groupedNodes = groupGraphNodes(graph?.nodes)
  const selectedEdges = selectEdgesForNode(graph, selectedNodeId)

  return {
    artifactId,
    graph,
    groupedNodes,
    isLoading,
    loadGraph,
    nodeTypeFilter,
    selectedEdges,
    selectedNodeId,
    setNodeTypeFilter,
    setSelectedNodeId,
    status,
  }
}
