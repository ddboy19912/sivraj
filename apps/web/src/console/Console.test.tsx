import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { storeSessionForTests } from '../lib/api'

const walletState = vi.hoisted(() => ({
  account: null as { address: string } | null,
  wallet: null as { name: string } | null,
  network: 'testnet',
  signPersonalMessage: vi.fn(),
}))

vi.mock('@mysten/dapp-kit-react', () => ({
  useCurrentAccount: () => walletState.account,
  useCurrentWallet: () => walletState.wallet,
  useCurrentNetwork: () => walletState.network,
  useDAppKit: () => ({
    signPersonalMessage: walletState.signPersonalMessage,
  }),
}))

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect wallet</button>,
}))

vi.mock('@mysten/seal', () => ({
  SealClient: class {
    async encrypt() {
      return {
        encryptedObject: new TextEncoder().encode('encrypted-client-payload'),
      }
    }
  },
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'pdf-worker-url',
}))

describe('Testing console', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_SEAL_PACKAGE_ID', '0xpackage')
    vi.stubEnv('VITE_SEAL_POLICY_ID', '0xpolicy')
    vi.stubEnv('VITE_SEAL_KEY_SERVERS', '0xkeyserver')
    vi.stubEnv('VITE_SEAL_THRESHOLD', '1')
    localStorage.clear()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeSessionForTests({
      token: 'api-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-05-18T01:00:00.000Z',
      twinId: 'twin-id',
      walletAddress: '0x1234567890abcdef',
    })
  })

  it('renders console navigation pages', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))

    expect(screen.getByRole('button', { name: 'Ingest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Artifact Status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retrieval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Candidates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent Permissions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent Writebacks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent Context' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Instruction Review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Instruction Patch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Instruction Sources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Privacy Check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'API Guide' })).toBeInTheDocument()
  })

  it('shows coding-agent permission grants and can revoke a grant', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/agents/clients') {
        return Promise.resolve(jsonResponse({
          policy: { rawArtifactsIncluded: false, scope: 'memory:read' },
          clients: [
            {
              clientId: 'client-id',
              grantId: 'grant-id',
              name: 'Codex',
              type: 'coding_agent',
              scopes: ['agent:context:read', 'agent:writeback:create'],
              memoryDomains: ['engineering'],
              expiresAt: '2026-05-26T00:00:00.000Z',
              revokedAt: null,
              createdAt: '2026-05-25T00:00:00.000Z',
              updatedAt: '2026-05-25T00:00:00.000Z',
              status: 'active',
              metadata: { origin: 'agent_token_flow' },
            },
          ],
        }))
      }

      if (url.pathname === '/v1/twins/twin-id/agents/clients/grant-id/revoke') {
        return Promise.resolve(jsonResponse({
          grantId: 'grant-id',
          clientId: 'client-id',
          status: 'revoked',
          revokedAt: '2026-05-25T01:00:00.000Z',
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Agent Permissions' }))

    expect(await screen.findByText('Codex')).toBeInTheDocument()
    expect(screen.getByText(/agent:context:read/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/v1/twins/twin-id/agents/clients/grant-id/revoke',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('shows encrypted agent writebacks and approves one into ingestion', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/agents/writebacks') {
        return Promise.resolve(jsonResponse({
          policy: { rawArtifactsIncluded: false, decryptedWritebackIncluded: false, scope: 'memory:read' },
          writebacks: [
            {
              id: 'writeback-id',
              twinId: 'twin-id',
              clientId: 'client-id',
              status: 'pending',
              agentName: 'Codex',
              repo: 'sivraj',
              branch: 'main',
              summarySha256: 'sha256-writeback',
              rawStorageRef: 'walrus://blob/writeback',
              ciphertextSha256: 'ciphertext',
              approvedArtifactId: null,
              counts: {
                filesTouched: 2,
                commandsRun: 1,
                testsRun: 1,
                decisions: 1,
                bugsFound: 0,
                followUps: 0,
                userCorrections: 0,
              },
              createdAt: '2026-05-25T00:00:00.000Z',
              updatedAt: '2026-05-25T00:00:00.000Z',
              approvedAt: null,
              rejectedAt: null,
            },
          ],
        }))
      }

      if (url.pathname === '/v1/twins/twin-id/agents/writebacks/writeback-id/approve') {
        return Promise.resolve(jsonResponse({
          writebackId: 'writeback-id',
          artifactId: 'approved-artifact-id',
          status: 'queued',
          processingJobId: 'approved-job-id',
          rawStorageRef: 'walrus://blob/writeback',
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Agent Writebacks' }))

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
  })

  it('submits ingestion from the console and stores shared artifact state', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
        '/v1/twins/twin-id/artifacts': jsonResponse({
          artifactId: 'artifact-id',
          memoryFragmentId: null,
          status: 'queued',
          storageMode: 'encrypted_walrus',
          rawStorageRef: 'walrus://blob/raw',
          processingJobId: 'job-id',
          warning: null,
        }),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Ingest' }))
    await user.selectOptions(screen.getByRole('combobox'), 'note')
    await user.type(screen.getByLabelText('Content'), 'Console ingest test')
    await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))

    expect(await screen.findByText('artifact-id')).toBeInTheDocument()
    expect(screen.getByText('job-id')).toBeInTheDocument()
  })

  it('preserves explicit browser history source for generic export filenames', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/artifacts') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          sourceType: 'browser_history',
          metadata: {
            fileType: 'text/csv',
            uploadKind: 'file',
            importer: 'browser_history_export',
          },
        })
        expect(String(init?.body)).not.toContain('export.csv')

        return Promise.resolve(jsonResponse({
          artifactId: 'browser-artifact-id',
          memoryFragmentId: null,
          status: 'queued',
          storageMode: 'encrypted_walrus',
          rawStorageRef: 'walrus://blob/browser',
          processingJobId: 'browser-job-id',
          warning: null,
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Ingest' }))
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
  })

  it('reviews AI chat imports and shows duplicate skips', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/artifacts') {
        const body = JSON.parse(String(init?.body)) as {
          sourceType: string
          metadata: Record<string, unknown>
        }

        expect(body).toMatchObject({
          sourceType: 'chat_export',
          metadata: {
            aiChatProvider: 'chatgpt',
            aiChatImportKind: 'export',
            aiChatConversationCount: 1,
            aiChatMessageCount: 2,
            importer: 'ai_chat_export',
          },
        })
        expect(typeof body.metadata.aiChatImportFingerprint).toBe('string')
        expect(String(init?.body)).not.toContain('Private launch plan')
        expect(String(init?.body)).not.toContain('What should I launch first?')

        return Promise.resolve(jsonResponse({
          artifactId: 'existing-chat-artifact-id',
          memoryFragmentId: null,
          status: 'completed',
          storageMode: 'encrypted_walrus',
          sensitivity: 'private',
          rawStorageRef: null,
          processingJobId: null,
          warning: null,
          skipped: true,
          reason: 'duplicate_ai_chat_import',
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Ingest' }))

    const file = new File([
      JSON.stringify([
        {
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
        },
      ]),
    ], 'conversations.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Text/Markdown/Browser history/AI chat file'), file)

    expect(await screen.findByText('AI chat import review')).toBeInTheDocument()
    expect(screen.getByText('chatgpt')).toBeInTheDocument()
    expect(screen.getByText('Private launch plan')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))

    expect(await screen.findByText('existing-chat-artifact-id')).toBeInTheDocument()
    expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0)
    expect(screen.getByText('Skipped: duplicate_ai_chat_import')).toBeInTheDocument()
  })

  it('loads retrieval results from the memory search API', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
        '/v1/twins/twin-id/memories/search': jsonResponse({
            results: [
              {
                id: 'fragment-id',
                sourceArtifactId: 'artifact-id',
                content: 'Matched memory text',
                score: 0.91,
                matchedTerms: ['memory'],
              },
            ],
        }),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Retrieval' }))
    await user.type(screen.getByLabelText('Query'), 'memory')
    await user.click(screen.getByRole('button', { name: 'Search memories' }))

    expect(await screen.findByText('Matched memory text')).toBeInTheDocument()
    expect(screen.getByText(/Score 0.910/)).toBeInTheDocument()
  })

  it('sends candidate feedback approve actions', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/health/storage')) {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.endsWith('/candidate-memories')) {
        return Promise.resolve(
          jsonResponse({
            candidateMemories: [
              {
                id: 'candidate-id',
                sourceArtifactId: 'artifact-id',
                memoryType: 'fact',
                status: 'candidate',
                subject: 'Project Alpha',
                confidenceScore: 0.9,
                statementStorageRef: 'walrus://blob/statement',
                statementSha256: 'sha256',
              },
            ],
          }),
        )
      }

      if (url.endsWith('/feedback') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            feedbackId: 'feedback-id',
            targetType: 'candidate_memory',
            targetId: 'candidate-id',
            feedbackType: 'approved',
            candidateMemoryStatus: 'approved',
          }),
        )
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Candidates' }))

    await waitFor(() => {
      expect(screen.getByText('Project Alpha')).toBeInTheDocument()
    })

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
  })

  it('loads coding agent context and renders copyable markdown', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
        '/v1/twins/twin-id/engineering/context': jsonResponse({
          policy: {
            rawArtifactsIncluded: false,
            decryptedMemoryIncluded: false,
            plaintextStatementsIncluded: false,
            derivedEngineeringContextIncluded: true,
            scope: 'memory:read',
          },
          relationship: {
            sivraj: 'Remembers encrypted engineering context.',
            codingAgents: 'Execute coding tasks.',
            handoff: 'Use contextMarkdown.',
          },
          contextPacket: {
            purpose: 'coding_agent_context',
            project: {
              id: null,
              name: 'Sivraj',
              repoFingerprint: {
                projectId: null,
                projectName: 'Sivraj',
                repoName: 'sivraj',
                packageName: 'sivraj',
                gitRemote: null,
                packageManager: 'pnpm',
                frameworks: ['vite', 'react'],
                lockfiles: [],
                rootMarkers: [],
              },
            },
            generatedAt: '2026-05-25T00:00:00.000Z',
            counts: {
              totalItems: 1,
              evidenceRefs: 1,
            },
            sections: {
              agentInstructions: [
                {
                  id: 'candidate-id',
                  type: 'agent_instruction',
                  scope: 'agent_specific',
                  subject: 'git safety',
                  agentContextLine: 'Do not revert user changes unless explicitly requested.',
                  confidence: 0.91,
                  status: 'candidate',
                  metadata: {
                    sourceKind: 'agent_instruction_file',
                  },
                  evidence: {
                    candidateMemoryId: 'candidate-id',
                    sourceArtifactId: 'artifact-id',
                    memoryFragmentId: 'fragment-id',
                    evidenceHash: 'evidence-sha',
                    evidenceLength: 30,
                  },
                },
              ],
              userPreferences: [],
              projectConventions: [],
              architectureRules: [],
              styleRules: [],
              testingPractices: [],
              deploymentEnvironment: [],
              securityBoundaries: [],
              knownPitfalls: [],
            },
            evidence: [
              {
                candidateMemoryId: 'candidate-id',
                sourceArtifactId: 'artifact-id',
                memoryFragmentId: 'fragment-id',
                evidenceHash: 'evidence-sha',
                evidenceLength: 30,
              },
            ],
            issues: [],
            quality: {
              score: 0.76,
              label: 'good',
              readyForAgent: true,
              strengths: ['Context is source-backed with evidence references.'],
              risks: [],
              recommendations: ['Packet is suitable for coding-agent handoff; keep reviewing new candidate memories as they arrive.'],
              metrics: {
                totalItems: 1,
                approvedOrActiveItems: 0,
                candidateItems: 1,
                evidenceRefs: 1,
                issueCount: 0,
                highSeverityIssueCount: 0,
                repoMatchedItems: 1,
                weakUnknownSourceItems: 0,
                sectionCoverage: 0.11,
              },
            },
            warnings: [],
          },
          contextMarkdown: '# Sivraj Coding Agent Context\n\n## Apply These Rules\n- Do not revert user changes unless explicitly requested.\n',
          contextExport: {
            preset: 'codex',
            format: 'markdown',
            targetFile: 'AGENTS.md',
            content: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
            warnings: [],
            includedCandidate: true,
            itemCount: 1,
          },
          profileSummary: {
            totalEngineeringMemories: 1,
            includedContextItems: 1,
            evidenceRefs: 1,
            warnings: [],
            issues: [],
            quality: {
              score: 0.76,
              label: 'good',
              readyForAgent: true,
              strengths: ['Context is source-backed with evidence references.'],
              risks: [],
              recommendations: ['Packet is suitable for coding-agent handoff; keep reviewing new candidate memories as they arrive.'],
              metrics: {
                totalItems: 1,
                approvedOrActiveItems: 0,
                candidateItems: 1,
                evidenceRefs: 1,
                issueCount: 0,
                highSeverityIssueCount: 0,
                repoMatchedItems: 1,
                weakUnknownSourceItems: 0,
                sectionCoverage: 0.11,
              },
            },
          },
        }),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Agent Context' }))
    await user.click(screen.getByRole('button', { name: 'Fetch agent context' }))

    expect(await screen.findByText('1 context item(s) ready for coding agents.')).toBeInTheDocument()
    expect(screen.getByText('Do not revert user changes unless explicitly requested.')).toBeInTheDocument()
    expect(screen.getByText(/# Agent Instructions/)).toBeInTheDocument()
    expect(screen.getByText('Context quality')).toBeInTheDocument()
    expect(screen.getByText('76%')).toBeInTheDocument()
    expect(screen.getByText('Raw artifacts')).toBeInTheDocument()
    expect(screen.getAllByText('false').length).toBeGreaterThan(0)
  })

  it('loads engineering review issues and submits a review action', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/engineering/review-queue' && init?.method !== 'POST') {
        return Promise.resolve(jsonResponse({
          policy: {
            rawArtifactsIncluded: false,
            decryptedMemoryIncluded: false,
            plaintextStatementsIncluded: false,
            derivedEngineeringContextIncluded: true,
            scope: 'memory:read',
          },
          summary: {
            totalEngineeringMemories: 2,
            issueCount: 1,
            quality: {
              score: 0.41,
              label: 'risky',
              readyForAgent: false,
              strengths: ['Context is source-backed with evidence references.'],
              risks: ['Conflicting or stale context issues were detected.'],
              recommendations: ['Review context issues before handing this packet to an autonomous coding agent.'],
              metrics: {
                totalItems: 2,
                approvedOrActiveItems: 0,
                candidateItems: 2,
                evidenceRefs: 2,
                issueCount: 1,
                highSeverityIssueCount: 0,
                repoMatchedItems: 1,
                weakUnknownSourceItems: 0,
                sectionCoverage: 0.11,
              },
            },
          },
          repoFingerprint: {
            projectId: null,
            projectName: 'Sivraj',
            repoName: 'sivraj',
            packageName: 'sivraj',
            gitRemote: null,
            packageManager: 'pnpm',
            frameworks: ['vite', 'react'],
            lockfiles: [],
            rootMarkers: [],
          },
          issues: [
            {
              issueType: 'conflict',
              reason: 'package_manager_conflict',
              severity: 'medium',
              subject: 'npm',
              scope: 'agent_specific',
              metadata: {
                candidateChoice: 'npm',
                existingChoice: 'pnpm',
              },
              candidate: {
                id: 'candidate-id',
                sourceArtifactId: 'artifact-id',
                memoryFragmentId: 'fragment-id',
                memoryType: 'preference',
                engineeringMemoryType: 'tool_preference',
                scope: 'agent_specific',
                status: 'candidate',
                subject: 'npm',
                agentContextLine: 'Use npm for package management.',
                confidenceScore: 0.7,
                evidenceHash: 'evidence-sha',
                evidenceLength: 32,
                statementStorageRef: 'walrus://blob/statement',
                metadata: {},
              },
              existing: null,
            },
          ],
        }))
      }

      if (url.pathname === '/v1/twins/twin-id/engineering/review-queue/candidate-id/action' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          candidateId: 'candidate-id',
          action: 'supersede',
          status: 'superseded',
          feedbackId: 'feedback-id',
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Instruction Review' }))
    await user.click(screen.getByRole('button', { name: 'Load review queue' }))

    expect(await screen.findByText('package_manager_conflict')).toBeInTheDocument()
    expect(screen.getByText('Use npm for package management.')).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Supersede' }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/engineering/review-queue/candidate-id/action',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'supersede' }),
      }),
    )
  })

  it('generates instruction patch suggestions for repo agent files', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1:3000')

      if (url.pathname === '/health/storage') {
        return Promise.resolve(jsonResponse(storageHealth()))
      }

      if (url.pathname === '/v1/twins/twin-id/engineering/instruction-patch' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          policy: {
            rawArtifactsIncluded: false,
            decryptedMemoryIncluded: false,
            plaintextStatementsIncluded: false,
            derivedEngineeringContextIncluded: true,
            autoWriteEnabled: false,
            scope: 'memory:read',
          },
          patch: {
            preset: 'codex',
            format: 'markdown',
            targetFile: 'AGENTS.md',
            operation: 'create_or_replace',
            content: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
            suggestedMarkdown: '# Agent Instructions\n\n- Do not revert user changes unless explicitly requested. Evidence: candidate-id\n',
            evidence: [
              {
                candidateMemoryId: 'candidate-id',
                sourceArtifactId: 'artifact-id',
                memoryFragmentId: 'fragment-id',
                evidenceHash: 'evidence-sha',
                evidenceLength: 30,
              },
            ],
            warnings: [],
            quality: {
              score: 0.72,
              label: 'good',
              readyForAgent: true,
              strengths: ['Context is source-backed with evidence references.'],
              risks: [],
              recommendations: ['Packet is suitable for coding-agent handoff.'],
              metrics: {
                totalItems: 1,
              },
            },
            includedCandidate: false,
            itemCount: 1,
          },
          contextPacket: {
            project: {
              id: null,
              name: 'Sivraj',
              repoFingerprint: {
                projectId: null,
                projectName: 'Sivraj',
                repoName: 'sivraj',
                packageName: 'sivraj',
                gitRemote: null,
                packageManager: 'pnpm',
                frameworks: ['vite', 'react'],
                lockfiles: [],
                rootMarkers: [],
              },
            },
            issues: [],
            quality: {
              score: 0.72,
              label: 'good',
              readyForAgent: true,
              strengths: [],
              risks: [],
              recommendations: [],
              metrics: {},
            },
            warnings: [],
          },
        }))
      }

      return Promise.resolve(new Response('Not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Instruction Patch' }))
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
  })

  it('shows engineering instruction sources and extracted memories', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
        '/v1/twins/twin-id/engineering/sources': jsonResponse({
          policy: {
            rawArtifactsIncluded: false,
            decryptedMemoryIncluded: false,
            plaintextStatementsIncluded: false,
            derivedEngineeringContextIncluded: true,
            scope: 'memory:read',
          },
          summary: {
            sourceCount: 1,
            engineeringMemoryCount: 1,
          },
          sources: [
            {
              artifactId: 'artifact-id',
              sourceType: 'markdown',
              sourceFile: 'AGENTS.md',
              displayName: 'AGENTS.md',
              ingestionStatus: 'completed',
              intelligenceStatus: 'completed',
              uploadedAt: '2026-05-25T00:00:00.000Z',
              updatedAt: '2026-05-25T00:00:01.000Z',
              rawStorageRef: 'walrus://blob/source',
              extractedEngineeringMemoryCount: 1,
              counts: {
                byType: { agent_instruction: 1 },
                byStatus: { candidate: 1 },
                byScope: { agent_specific: 1 },
              },
              candidates: [
                {
                  id: 'candidate-id',
                  memoryType: 'fact',
                  engineeringMemoryType: 'agent_instruction',
                  scope: 'agent_specific',
                  status: 'candidate',
                  subject: 'git safety',
                  agentContextLine: 'Do not revert user changes unless explicitly requested.',
                  confidenceScore: 0.9,
                  evidenceHash: 'evidence-sha',
                  evidenceLength: 30,
                  statementStorageRef: 'walrus://blob/statement',
                  createdAt: '2026-05-25T00:00:02.000Z',
                },
              ],
            },
          ],
        }),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Instruction Sources' }))

    expect(await screen.findByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('1 source(s), 1 engineering memory.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show extracted memories' }))
    expect(screen.getByText('Do not revert user changes unless explicitly requested.')).toBeInTheDocument()
  })

  it('renders privacy checklist pass and fail states', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
        '/v1/twins/twin-id/artifacts/artifact-id/privacy-check': jsonResponse({
          allChecksPassed: false,
          checklist: {
            sourceArtifactHasRawStorageRef: true,
            sourceArtifactHasCiphertextHash: false,
            sourceArtifactMetadataHasNoPlaintextFields: true,
            memoryFragmentHasContentStorageRef: true,
            candidateMemoriesUseStatementStorageRef: true,
            completedReflectionsUseSummaryStorageRef: true,
          },
          artifact: {
            id: 'artifact-id',
            rawStorageRef: 'walrus://blob/raw',
          },
          memoryFragment: {
            id: 'fragment-id',
            contentStorageRef: 'walrus://blob/fragment',
          },
          candidateMemories: [],
          reflections: [],
        }),
      }),
    )

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Privacy Check' }))
    await user.type(screen.getByLabelText('Artifact ID'), 'artifact-id')
    await user.click(screen.getByRole('button', { name: 'Run privacy check' }))

    expect(await screen.findByText('One or more privacy checks failed.')).toBeInTheDocument()
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FAIL').length).toBeGreaterThan(0)
  })

  it('shows auth required guidance when wallet session is missing', async () => {
    localStorage.clear()
    walletState.account = null
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/health/storage': jsonResponse(storageHealth()),
      }),
    )

    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Testing Console' }))
    await user.click(screen.getByRole('button', { name: 'Ingest' }))

    expect(screen.getByText('Connect wallet and sign in to test ingestion.')).toBeInTheDocument()
  })
})

function storageHealth() {
  return {
    ok: true,
    storage: {
      mode: 'encrypted_walrus',
      ready: true,
      checks: {
        authConfigured: true,
        databaseConfigured: true,
        sealConfigured: true,
        suiConfigured: true,
        uploadRelayConfigured: true,
        walrusConfigured: true,
      },
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(routes: Record<string, Response | (() => Response)>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1:3000')
    const route = routes[url.pathname]

    if (!route) {
      return Promise.resolve(new Response('Not found', { status: 404 }))
    }

    return Promise.resolve(typeof route === 'function' ? route() : route)
  })
}
