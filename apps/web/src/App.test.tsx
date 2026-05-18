import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const walletState = vi.hoisted(() => ({
  account: null as { address: string } | null,
  wallet: null as { name: string } | null,
  network: 'testnet',
  signPersonalMessage: vi.fn(),
}))

const pdfState = vi.hoisted(() => ({
  getDocument: vi.fn(),
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

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfState.getDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'pdf-worker-url',
}))

describe('Manual memory app', () => {
  beforeEach(() => {
    localStorage.clear()
    walletState.account = null
    walletState.wallet = null
    walletState.network = 'testnet'
    walletState.signPersonalMessage.mockReset()
    pdfState.getDocument.mockReset()
    vi.restoreAllMocks()
  })

  it('shows disconnected wallet guidance and disables submit', () => {
    render(<App />)

    expect(screen.getByText('No wallet connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save private memory' })).toBeDisabled()
  })

  it('completes wallet challenge and stores the API session', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    walletState.signPersonalMessage.mockResolvedValue({ signature: 'signed-message' })
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/auth/challenge': jsonResponse({
        message: 'Sign in to Sivraj',
        challengeToken: 'challenge-token',
      }),
      '/v1/auth/verify': jsonResponse({
        token: 'api-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-05-18T01:00:00.000Z',
        userId: 'user-id',
        twinId: 'twin-id',
        walletAddress: '0x1234567890abcdef',
      }),
    }))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Wallet verified.')).toBeInTheDocument()
    expect(walletState.signPersonalMessage).toHaveBeenCalledWith({
      message: new TextEncoder().encode('Sign in to Sivraj'),
    })
    expect(localStorage.getItem('sivraj.session.v1')).toContain('api-token')
    expect(localStorage.getItem('sivraj.session.v1')).toContain('refresh-token')
    expect(localStorage.getItem('sivraj.session.v1')).toContain('twin-id')
  })

  it('keeps submit disabled until content exists', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    storeTestSession()

    render(<App />)

    const submit = screen.getByRole('button', { name: 'Save private memory' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    expect(submit).toBeEnabled()
  })

  it('submits memory and renders encrypted receipt', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession()
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        processingJobId: 'job-id',
        warning: null,
      }, 201),
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Title'), 'Founder note')
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expect(screen.getByText('Walrus storage confirmed')).toBeInTheDocument()
    expect(screen.getByText('job-id')).toBeInTheDocument()
    expect(screen.getByText('encrypted_walrus')).toBeInTheDocument()
    expect(screen.getByText('walrus://blob/blob-id')).toBeInTheDocument()
    expect(screen.getByText('artifact-id')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer api-token',
        }),
        body: JSON.stringify({
          sourceType: 'note',
          title: 'Founder note',
          content: 'Raw text memory',
          metadata: {},
        }),
      }),
    )
  })

  it('refreshes an expired API session and retries the memory upload', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession({ token: 'expired-token', refreshToken: 'refresh-token' })
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/auth/refresh': jsonResponse({
        token: 'fresh-token',
        refreshToken: 'next-refresh-token',
        expiresAt: '2026-05-18T02:00:00.000Z',
        userId: 'user-id',
        twinId: 'twin-id',
        walletAddress: '0x1234567890abcdef',
      }),
      '/v1/twins/twin-id/artifacts': [
        jsonResponse({ error: 'invalid_bearer_token' }, 401),
        jsonResponse({
          artifactId: 'artifact-id',
          memoryFragmentId: null,
          status: 'queued',
          storageMode: 'encrypted_walrus',
          sensitivity: 'private',
          rawStorageRef: 'walrus://blob/blob-id',
          warning: null,
        }, 201),
      ],
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expect(localStorage.getItem('sivraj.session.v1')).toContain('fresh-token')
    expect(localStorage.getItem('sivraj.session.v1')).toContain('next-refresh-token')
    expect(fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fresh-token',
        }),
      }),
    )
  })

  it('loads a markdown file and submits it as encrypted markdown', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession()
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        warning: null,
      }, 201),
    }))

    render(<App />)

    const file = new File(['# Strategy\nShip faster.'], 'strategy.md', {
      type: 'text/markdown',
    })
    await user.upload(screen.getByLabelText('File upload'), file)
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sourceType: 'markdown',
          title: 'strategy.md',
          content: '# Strategy\nShip faster.',
          metadata: {
            fileName: 'strategy.md',
            fileType: 'text/markdown',
            fileSize: file.size,
            uploadKind: 'file',
          },
        }),
      }),
    )
  })

  it('loads a PDF file and submits extracted text as encrypted PDF memory', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession()
    pdfState.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: [{ str: pageNumber === 1 ? 'Founder PDF' : 'execution plan' }],
          }),
        }),
      }),
    })
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        warning: null,
      }, 201),
    }))

    render(<App />)

    const file = new File(['%PDF-1.7'], 'brief.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('File upload'), file)
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sourceType: 'pdf',
          title: 'brief.pdf',
          content: 'Founder PDF\n\nexecution plan',
          metadata: {
            fileName: 'brief.pdf',
            fileType: 'application/pdf',
            fileSize: file.size,
            uploadKind: 'file',
          },
        }),
      }),
    )
  })

  it('shows infra setup error when encrypted storage is missing', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    storeTestSession()
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth({ ready: false })),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        error: 'encrypted_storage_not_configured',
      }, 503),
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted storage is not configured.')).toBeInTheDocument()
    expect(screen.getByText(/Configure Seal, Sui, and Walrus environment variables/)).toBeInTheDocument()
  })

  it('shows actionable API auth failure', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    storeTestSession({ token: 'expired-token', refreshToken: 'expired-refresh-token' })
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/auth/refresh': jsonResponse({
        error: 'invalid_refresh_token',
      }, 401),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        error: 'invalid_bearer_token',
      }, 401),
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    await waitFor(() => {
      expect(screen.getByText('Memory upload failed.')).toBeInTheDocument()
    })
    expect(screen.getByText('API session is invalid or expired. Sign in with your wallet again.')).toBeInTheDocument()
  })
})

function storageHealth({ ready = true } = {}) {
  return {
    ok: ready,
    storage: {
      mode: 'encrypted_walrus',
      ready,
      checks: {
        authConfigured: true,
        databaseConfigured: true,
        suiConfigured: true,
        sealConfigured: true,
        walrusConfigured: true,
        uploadRelayConfigured: ready,
      },
    },
  }
}

function storeTestSession(overrides: Partial<{
  token: string
  refreshToken: string
  expiresAt: string
  twinId: string
  walletAddress: string
}> = {}) {
  localStorage.setItem('sivraj.session.v1', JSON.stringify({
    token: 'api-token',
    refreshToken: 'refresh-token',
    expiresAt: '2026-05-18T01:00:00.000Z',
    twinId: 'twin-id',
    walletAddress: '0x1234567890abcdef',
    ...overrides,
  }))
}

function mockFetch(
  responses: Record<string, ReturnType<typeof jsonResponse> | ReturnType<typeof jsonResponse>[]>,
) {
  const queues = new Map(
    Object.entries(responses).map(([path, response]) => [
      path,
      Array.isArray(response) ? [...response] : [response],
    ]),
  )

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = new URL(url).pathname
    const queue = queues.get(path)
    const response = queue?.shift()

    if (!response) {
      return jsonResponse({ error: 'not_found' }, 404)
    }

    return response
  })
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}
