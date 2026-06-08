import { useReducer } from 'react'
import type { Session } from '@/lib/api'
import { ConsoleContext } from '@/console/context'
import { ConsolePageContent } from '@/console/ConsolePageContent'
import './Console.css'
import { CONSOLE_PAGES, type ConsolePage } from '@/types/console.types'

type ConsoleShellProps = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
}

type ConsoleShellState = {
  page: ConsolePage
  artifactId: string
  jobId: string
  selectedCandidateId: string
  selectedReflectionId: string
}

type ConsoleShellAction =
  | { type: 'page'; value: ConsolePage }
  | { type: 'artifactId'; value: string }
  | { type: 'jobId'; value: string }
  | { type: 'selectedCandidateId'; value: string }
  | { type: 'selectedReflectionId'; value: string }

const initialConsoleShellState: ConsoleShellState = {
  page: 'artifact-status',
  artifactId: '',
  jobId: '',
  selectedCandidateId: '',
  selectedReflectionId: '',
}

function consoleShellReducer(
  state: ConsoleShellState,
  action: ConsoleShellAction,
): ConsoleShellState {
  return { ...state, [action.type]: action.value }
}

export function ConsoleShell({ session, isSessionForWallet, onSessionRefreshed }: ConsoleShellProps) {
  const [state, dispatch] = useReducer(consoleShellReducer, initialConsoleShellState)
  const setArtifactId = (value: string) => dispatch({ type: 'artifactId', value })
  const setJobId = (value: string) => dispatch({ type: 'jobId', value })
  const setSelectedCandidateId = (value: string) =>
    dispatch({ type: 'selectedCandidateId', value })
  const setSelectedReflectionId = (value: string) =>
    dispatch({ type: 'selectedReflectionId', value })

  const contextValue = {
    session,
    isSessionForWallet,
    onSessionRefreshed,
    artifactId: state.artifactId,
    setArtifactId,
    jobId: state.jobId,
    setJobId,
    selectedCandidateId: state.selectedCandidateId,
    setSelectedCandidateId,
    selectedReflectionId: state.selectedReflectionId,
    setSelectedReflectionId,
  }

  return (
    <ConsoleContext.Provider value={contextValue}>
      <section className="console-shell">
        <nav className="console-nav" aria-label="Testing console pages">
          {CONSOLE_PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={state.page === item.id ? 'console-nav-item active' : 'console-nav-item'}
              onClick={() => dispatch({ type: 'page', value: item.id })}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="console-shared-state">
          <span>Twin: {session?.twinId ?? '—'}</span>
          <span>Artifact: {state.artifactId || '—'}</span>
          <span>Job: {state.jobId || '—'}</span>
        </div>

        <ConsolePageContent page={state.page} />
      </section>
    </ConsoleContext.Provider>
  )
}
