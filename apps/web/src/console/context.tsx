import { createContext, useContext } from 'react'
import type { Session } from '../lib/api'

export type ConsoleContextValue = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
  artifactId: string
  setArtifactId: (value: string) => void
  jobId: string
  setJobId: (value: string) => void
  selectedCandidateId: string
  setSelectedCandidateId: (value: string) => void
  selectedReflectionId: string
  setSelectedReflectionId: (value: string) => void
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null)

export function useConsoleContext() {
  const context = useContext(ConsoleContext)

  if (!context) {
    throw new Error('ConsoleContext is missing')
  }

  return context
}
