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
    expect(screen.getByRole('button', { name: 'Privacy Check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'API Guide' })).toBeInTheDocument()
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
        })

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
    await user.upload(screen.getByLabelText('Text/Markdown/Browser history file'), file)
    await user.click(screen.getByRole('button', { name: 'Submit encrypted artifact' }))

    expect(await screen.findByText('browser-artifact-id')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({ method: 'POST' }),
    )
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
