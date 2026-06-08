import { useState } from 'react'
import { fetchGraphData, graphPageErrorMessage } from '@/console/pages/graph/graph-page-load'
import type { DisplayNode } from '@/console/pages/graph/graph-page-utils'
import type { Session } from '@/lib/session'
import type { GraphResponse } from '@/types/console.types'

type GraphPageLoaderArgs = {
  session: Session | null
  isSessionForWallet: boolean
  nodeTypeFilter: string
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}

export function useGraphPageLoader({
  session,
  isSessionForWallet,
  nodeTypeFilter,
  artifactId,
  onSessionRefreshed,
}: GraphPageLoaderArgs) {
  const [graph, setGraph] = useState<{ nodes: DisplayNode[]; edges: GraphResponse['edges'] } | null>(
    null,
  )
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadGraph() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const nextGraph = await fetchGraphData({
        session,
        nodeTypeFilter,
        artifactId,
        onSessionRefreshed,
      })
      setGraph(nextGraph)
      setStatus(`${nextGraph.nodes.length} node(s), ${nextGraph.edges.length} edge(s).`)
      setIsLoading(false)
    } catch (error) {
      setGraph(null)
      setStatus(graphPageErrorMessage(error))
      setIsLoading(false)
    }
  }

  return { graph, status, isLoading, loadGraph }
}
