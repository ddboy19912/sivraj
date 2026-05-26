import { useMemo, useState } from 'react'
import type { Session } from '../lib/api'
import { ConsoleContext } from './context'
import './Console.css'
import { ApiGuidePage } from './pages/ApiGuidePage'
import { AgentContextPage } from './pages/AgentContextPage'
import { AgentPermissionsPage } from './pages/AgentPermissionsPage'
import { AgentWritebacksPage } from './pages/AgentWritebacksPage'
import { ArtifactStatusPage } from './pages/ArtifactStatusPage'
import { CandidateMemoriesPage } from './pages/CandidateMemoriesPage'
import { EngineeringSourcesPage } from './pages/EngineeringSourcesPage'
import { EngineeringReviewPage } from './pages/EngineeringReviewPage'
import { GraphPage } from './pages/GraphPage'
import { IngestPage } from './pages/IngestPage'
import { InstructionPatchPage } from './pages/InstructionPatchPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ReflectionsPage } from './pages/ReflectionsPage'
import { RetrievalPage } from './pages/RetrievalPage'
import { CONSOLE_PAGES, type ConsolePage } from './types'

type ConsoleShellProps = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
}

export function ConsoleShell({ session, isSessionForWallet, onSessionRefreshed }: ConsoleShellProps) {
  const [page, setPage] = useState<ConsolePage>('artifact-status')
  const [artifactId, setArtifactId] = useState('')
  const [jobId, setJobId] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [selectedReflectionId, setSelectedReflectionId] = useState('')

  const contextValue = useMemo(
    () => ({
      session,
      isSessionForWallet,
      onSessionRefreshed,
      artifactId,
      setArtifactId,
      jobId,
      setJobId,
      selectedCandidateId,
      setSelectedCandidateId,
      selectedReflectionId,
      setSelectedReflectionId,
    }),
    [
      artifactId,
      isSessionForWallet,
      jobId,
      onSessionRefreshed,
      selectedCandidateId,
      selectedReflectionId,
      session,
    ],
  )

  return (
    <ConsoleContext.Provider value={contextValue}>
      <section className="console-shell">
        <nav className="console-nav" aria-label="Testing console pages">
          {CONSOLE_PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? 'console-nav-item active' : 'console-nav-item'}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="console-shared-state">
          <span>Twin: {session?.twinId ?? '—'}</span>
          <span>Artifact: {artifactId || '—'}</span>
          <span>Job: {jobId || '—'}</span>
        </div>

        {page === 'ingest' ? <IngestPage /> : null}
        {page === 'artifact-status' ? <ArtifactStatusPage /> : null}
        {page === 'retrieval' ? <RetrievalPage /> : null}
        {page === 'candidate-memories' ? <CandidateMemoriesPage /> : null}
        {page === 'agent-permissions' ? <AgentPermissionsPage /> : null}
        {page === 'agent-writebacks' ? <AgentWritebacksPage /> : null}
        {page === 'agent-context' ? <AgentContextPage /> : null}
        {page === 'engineering-review' ? <EngineeringReviewPage /> : null}
        {page === 'instruction-patch' ? <InstructionPatchPage /> : null}
        {page === 'engineering-sources' ? <EngineeringSourcesPage /> : null}
        {page === 'graph' ? <GraphPage /> : null}
        {page === 'reflections' ? <ReflectionsPage /> : null}
        {page === 'privacy' ? <PrivacyPage /> : null}
        {page === 'api-guide' ? <ApiGuidePage /> : null}
      </section>
    </ConsoleContext.Provider>
  )
}
