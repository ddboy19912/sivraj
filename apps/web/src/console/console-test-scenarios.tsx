import { walletState } from '@/tests/mocks/wallet-kit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'
import App from '@/App'
import { openConsolePage } from '@/tests/fixtures/console-fixtures'
import { jsonResponse, stubAppFetch } from '@/tests/helpers'
import { agentContextResponse } from '@/console/fixtures/agent-context-response'
import { engineeringReviewHandler } from '@/console/fixtures/engineering-review-handler'
import {
  agentPermissionsRoutes,
  agentWritebacksRoutes,
  browserHistoryArtifactHandler,
  candidateFeedbackHandler,
  chatExportDuplicateHandler,
  engineeringSourcesRoutes,
  instructionPatchHandler,
  privacyCheckRoutes,
} from '@/console/console-test-fixtures'

export async function runConsoleNavigationScenario() {
  const user = userEvent.setup()
  stubAppFetch({})
  render(<App />)
  await openConsolePage(user)
  for (const name of [
    'Ingest', 'Artifact Status', 'Retrieval', 'Candidates', 'Agent Permissions',
    'Agent Writebacks', 'Agent Context', 'Instruction Review', 'Instruction Patch',
    'Instruction Sources', 'Privacy Check', 'API Guide',
  ]) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
}

export async function runAgentPermissionsRevokeScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({ routes: agentPermissionsRoutes() })
  render(<App />)
  await openConsolePage(user, 'Agent Permissions')
  expect(await screen.findByText('Codex')).toBeInTheDocument()
  expect(screen.getByText(/agent:context:read/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Revoke' }))
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/agents/clients/grant-id/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })
}

export async function runAgentWritebacksApproveScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({ routes: agentWritebacksRoutes() })
  render(<App />)
  await openConsolePage(user, 'Agent Writebacks')
  expect(await screen.findByText('Codex')).toBeInTheDocument()
  expect(screen.getByText(/files 2/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/agents/writebacks/writeback-id/approve',
      expect.objectContaining({ method: 'POST' }),
    )
  })
  expect(screen.getByText('Artifact: approved-artifact-id')).toBeInTheDocument()
  expect(screen.getByText('Job: approved-job-id')).toBeInTheDocument()
}

async function waitForIngestReady() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Submit encrypted artifact' })).toBeEnabled()
  })
}

export async function runConsoleIngestSubmitScenario() {
  const user = userEvent.setup()
  stubAppFetch({
    routes: {
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        rawStorageRef: 'walrus://blob/raw',
        processingJobId: 'job-id',
        warning: null,
      }),
    },
  })
  render(<App />)
  await openConsolePage(user, 'Ingest')
  await waitForIngestReady()
  await user.selectOptions(screen.getByRole('combobox'), 'note')
  await user.type(screen.getByLabelText('Content'), 'Console ingest test')
  await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))
  expect(await screen.findByText('artifact-id')).toBeInTheDocument()
  expect(screen.getByText('job-id')).toBeInTheDocument()
}

export async function runBrowserHistoryIngestScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({
    routes: { '/v1/twins/twin-id/artifacts': browserHistoryArtifactHandler },
  })
  render(<App />)
  await openConsolePage(user, 'Ingest')
  await waitForIngestReady()
  await user.selectOptions(screen.getByRole('combobox'), 'browser_history')
  const content = 'title,url,lastVisitTime\nSivraj,https://sivraj.ai,2026-05-20T10:00:00Z'
  const file = new File([content], 'export.csv', { type: 'text/csv' })
  await user.upload(screen.getByLabelText('Text/Markdown/Browser history/AI chat file'), file)
  await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))
  expect(await screen.findByText('browser-artifact-id')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
    expect.objectContaining({ method: 'POST' }),
  )
}

export async function runAiChatDuplicateImportScenario() {
  const user = userEvent.setup()
  stubAppFetch({ routes: { '/v1/twins/twin-id/artifacts': chatExportDuplicateHandler } })
  render(<App />)
  await openConsolePage(user, 'Ingest')
  await waitForIngestReady()
  const file = new File([JSON.stringify([chatExportConversation()])], 'conversations.json', {
    type: 'application/json',
  })
  await user.upload(screen.getByLabelText('Text/Markdown/Browser history/AI chat file'), file)
  expect(await screen.findByText('AI chat import review')).toBeInTheDocument()
  expect(screen.getByText('chatgpt')).toBeInTheDocument()
  expect(screen.getByText('Private launch plan')).toBeInTheDocument()
  expect(screen.getByText('Ready')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))
  expect(await screen.findByText('existing-chat-artifact-id')).toBeInTheDocument()
  expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0)
  expect(screen.getByText('Skipped: duplicate_ai_chat_import')).toBeInTheDocument()
}

export async function runRetrievalSearchScenario() {
  const user = userEvent.setup()
  stubAppFetch({
    routes: {
      '/v1/twins/twin-id/memories/search': jsonResponse({
        results: [{
          id: 'fragment-id',
          sourceArtifactId: 'artifact-id',
          content: 'Matched memory text',
          score: 0.91,
          matchedTerms: ['memory'],
        }],
      }),
    },
  })
  render(<App />)
  await openConsolePage(user, 'Retrieval')
  await user.type(screen.getByLabelText('Query'), 'memory')
  await user.click(screen.getByRole('button', { name: 'Search memories' }))
  expect(await screen.findByText('Matched memory text')).toBeInTheDocument()
  expect(screen.getByText(/Score 0.910/)).toBeInTheDocument()
}

export async function runCandidateFeedbackScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({ handler: candidateFeedbackHandler })
  render(<App />)
  await openConsolePage(user, 'Candidates')
  await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'approved' }))
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/feedback',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          targetType: 'candidate_memory',
          targetId: 'candidate-id',
          feedbackType: 'approved',
        }),
      }),
    )
  })
}

export async function runAgentContextScenario() {
  const user = userEvent.setup()
  stubAppFetch({ routes: { '/v1/twins/twin-id/engineering/context': jsonResponse(agentContextResponse()) } })
  render(<App />)
  await openConsolePage(user, 'Agent Context')
  await user.click(screen.getByRole('button', { name: 'Fetch agent context' }))
  expect(await screen.findByText('1 context item(s) ready for coding agents.')).toBeInTheDocument()
  expect(screen.getByText('Do not revert user changes unless explicitly requested.')).toBeInTheDocument()
  expect(screen.getByText(/# Agent Instructions/)).toBeInTheDocument()
  expect(screen.getByText('Context quality')).toBeInTheDocument()
  expect(screen.getByText('76%')).toBeInTheDocument()
  expect(screen.getByText('Raw artifacts')).toBeInTheDocument()
  expect(screen.getAllByText('false').length).toBeGreaterThan(0)
}

export async function runEngineeringReviewScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({ handler: engineeringReviewHandler })
  render(<App />)
  await openConsolePage(user, 'Instruction Review')
  await user.click(screen.getByRole('button', { name: 'Load review queue' }))
  expect(await screen.findByText('package_manager_conflict')).toBeInTheDocument()
  expect(screen.getByText('Use npm for package management.')).toBeInTheDocument()
  expect(screen.getByText('41%')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Supersede' }))
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:3000/v1/twins/twin-id/engineering/review-queue/candidate-id/action',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'supersede' }) }),
  )
}

export async function runInstructionPatchScenario() {
  const user = userEvent.setup()
  const fetchMock = stubAppFetch({ handler: instructionPatchHandler })
  render(<App />)
  await openConsolePage(user, 'Instruction Patch')
  await user.click(screen.getByRole('button', { name: 'Generate patch' }))
  expect(await screen.findByText('AGENTS.md suggestion generated with 1 rule(s).')).toBeInTheDocument()
  expect(screen.getByText('AGENTS.md preview')).toBeInTheDocument()
  expect(screen.getByText(/# Agent Instructions/)).toBeInTheDocument()
  expect(screen.getByText('Disabled')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:3000/v1/twins/twin-id/engineering/instruction-patch',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        projectName: 'Sivraj',
        repoName: 'sivraj',
        packageName: 'sivraj',
        packageManager: 'pnpm',
        frameworks: 'vite, react',
        preset: 'codex',
        includeCandidate: false,
      }),
    }),
  )
}

export async function runEngineeringSourcesScenario() {
  const user = userEvent.setup()
  stubAppFetch({ routes: engineeringSourcesRoutes() })
  render(<App />)
  await openConsolePage(user, 'Instruction Sources')
  expect(await screen.findByText('AGENTS.md')).toBeInTheDocument()
  expect(screen.getByText('1 source(s), 1 engineering memory.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show extracted memories' }))
  expect(screen.getByText('Do not revert user changes unless explicitly requested.')).toBeInTheDocument()
}

export async function runPrivacyCheckScenario() {
  const user = userEvent.setup()
  stubAppFetch({ routes: privacyCheckRoutes() })
  render(<App />)
  await openConsolePage(user, 'Privacy Check')
  await user.type(screen.getByLabelText('Artifact ID'), 'artifact-id')
  await user.click(screen.getByRole('button', { name: 'Run privacy check' }))
  expect(await screen.findByText('One or more privacy checks failed.')).toBeInTheDocument()
  expect(screen.getAllByText('PASS').length).toBeGreaterThan(0)
  expect(screen.getAllByText('FAIL').length).toBeGreaterThan(0)
}

export async function runWalletGateScenario() {
  localStorage.clear()
  walletState.account = null
  stubAppFetch({})
  render(<App />)
  const user = userEvent.setup()
  await openConsolePage(user, undefined, { waitForConsole: false })
  expect(screen.getByLabelText('Wallet authentication')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ingest' })).not.toBeInTheDocument()
  expect(screen.queryByText('Connect wallet and sign in to test ingestion.')).not.toBeInTheDocument()
}

function chatExportConversation() {
  return {
    id: 'conversation-1',
    title: 'Private launch plan',
    mapping: {
      userMessage: {
        message: {
          id: 'message-1',
          author: { role: 'user' },
          create_time: 1_710_000_000,
          content: { parts: ['What should I launch first?'] },
        },
      },
      assistantMessage: {
        message: {
          id: 'message-2',
          author: { role: 'assistant' },
          create_time: 1_710_000_010,
          content: { parts: ['Lead with import review.'] },
        },
      },
    },
  }
}
