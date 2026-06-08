import { useState } from 'react'

export function useAgentWritebackFormState() {
  const [agentToken, setAgentToken] = useState('')
  const [agentName, setAgentName] = useState('Codex')
  const [repo, setRepo] = useState('sivraj')
  const [branch, setBranch] = useState('main')
  const [taskSummary, setTaskSummary] = useState('')
  const [filesTouched, setFilesTouched] = useState('')
  const [commandsRun, setCommandsRun] = useState('')
  const [testsRun, setTestsRun] = useState('')
  const [decisions, setDecisions] = useState('')
  const [bugsFound, setBugsFound] = useState('')
  const [followUps, setFollowUps] = useState('')
  const [userCorrections, setUserCorrections] = useState('')

  return {
    agentName,
    agentToken,
    branch,
    bugsFound,
    commandsRun,
    decisions,
    filesTouched,
    followUps,
    repo,
    setAgentName,
    setAgentToken,
    setBranch,
    setBugsFound,
    setCommandsRun,
    setDecisions,
    setFilesTouched,
    setFollowUps,
    setRepo,
    setTaskSummary,
    setTestsRun,
    setUserCorrections,
    taskSummary,
    testsRun,
    userCorrections,
  }
}
