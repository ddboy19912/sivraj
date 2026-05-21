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
  getDocument: pdfState.getDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'pdf-worker-url',
}))

describe('Manual memory app', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_SEAL_PACKAGE_ID', '0xpackage')
    vi.stubEnv('VITE_SEAL_POLICY_ID', '0xpolicy')
    vi.stubEnv('VITE_SEAL_KEY_SERVERS', '0xkeyserver')
    vi.stubEnv('VITE_SEAL_THRESHOLD', '1')
    vi.stubEnv('VITE_SUI_RPC_URL', 'https://fullnode.testnet.sui.io:443')
    vi.stubEnv('VITE_SUI_NETWORK', 'testnet')
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
    expectEncryptedArtifactRequest('note', ['Founder note', 'Raw text memory'])
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
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fresh-token',
        }),
      }),
    )
  })

  it('refreshes an expired API session and retries the artifact status stream', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession({ token: 'expired-stream-token', refreshToken: 'refresh-token' })
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/auth/refresh': jsonResponse({
        token: 'fresh-stream-token',
        refreshToken: 'next-refresh-token',
        expiresAt: '2026-05-18T02:00:00.000Z',
        userId: 'user-id',
        twinId: 'twin-id',
        walletAddress: '0x1234567890abcdef',
      }),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        warning: null,
      }, 201),
      '/v1/twins/twin-id/artifacts/artifact-id/events': [
        jsonResponse({ error: 'invalid_bearer_token' }, 401),
        sseResponse({
          artifactId: 'artifact-id',
          twinId: 'twin-id',
          sourceType: 'note',
          status: 'completed',
          reason: null,
          occurredAt: '2026-05-18T02:00:00.000Z',
        }),
      ],
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Worker completed processing and created retrievable memory.')).toBeInTheDocument()
    expect(localStorage.getItem('sivraj.session.v1')).toContain('fresh-stream-token')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts/artifact-id/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fresh-stream-token',
        }),
      }),
    )
  })

  it('imports a public GitHub repository through the encrypted API path', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession()
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/twins/twin-id/imports/github': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'queued',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        processingJobId: 'job-id',
        warning: null,
        github: {
          repoUrl: 'https://github.com/sivraj/app',
          owner: 'sivraj',
          repo: 'app',
          fileCount: 2,
        },
      }, 201),
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/sivraj/app')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByText('GitHub repository queued.')).toBeInTheDocument()
    expect(screen.getByText('Walrus storage confirmed')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/imports/github',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer api-token',
        }),
        body: JSON.stringify({
          repoUrl: 'https://github.com/sivraj/app',
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
    expectEncryptedArtifactRequest('markdown', ['strategy.md', '# Strategy', 'Ship faster'])
  })

  it('loads a browser history export and submits it as encrypted browser history', async () => {
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

    const content = 'title,url,lastVisitTime\nSivraj,https://sivraj.ai,2026-05-20T10:00:00Z'
    const file = new File([content], 'chrome-history-export.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('File upload'), file)
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expectEncryptedArtifactRequest('browser_history', ['chrome-history-export.csv', content, 'sivraj.ai'])
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
    expectEncryptedArtifactRequest('pdf', ['brief.pdf', 'Founder PDF', 'execution plan'])
  })

  it('loads an image-only PDF and submits the encrypted payload for worker OCR', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    walletState.wallet = { name: 'Sui Wallet' }
    storeTestSession()
    pdfState.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [],
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

    const file = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('File upload'), file)

    expect(screen.getByText('Scanned PDF file loaded.')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/scan.pdf is ready for encrypted OCR processing/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expectEncryptedArtifactRequest('ocr_pdf', ['scan.pdf', btoa('%PDF-1.7')])
  })

  it('loads an image and submits the encrypted payload for worker OCR', async () => {
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

    const file = new File(['fake image'], 'screenshot.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('File upload'), file)

    expect(screen.getByText('Image file loaded.')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/screenshot.png is ready for encrypted OCR processing/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expectEncryptedArtifactRequest('image', ['screenshot.png', btoa('fake image'), 'fake image'])
  })

  it('loads an audio file and submits the encrypted payload as a voice note', async () => {
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

    const file = new File(['fake audio'], 'founder-reflection.m4a', { type: 'audio/mp4' })
    await user.upload(screen.getByLabelText('File upload'), file)

    expect(screen.getByText('Voice note file loaded.')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/founder-reflection.m4a is ready for encrypted voice note storage/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    expect(await screen.findByText('Encrypted memory queued.')).toBeInTheDocument()
    expectEncryptedArtifactRequest('voice_note', ['founder-reflection.m4a', btoa('fake audio'), 'fake audio'])
  })

  it('records a voice conversation and submits encrypted recorded audio', async () => {
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
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:voice-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText('Recording')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Ready to save')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save conversation' }))

    expect(await screen.findByText('Voice conversation queued.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer api-token',
        }),
      }),
    )

    expectEncryptedArtifactRequest('voice_conversation', [
      btoa('recorded audio'),
      'recorded audio',
      'voice-conversation-',
    ])
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
    expect(screen.getAllByText(/Configure Seal, Sui, and Walrus environment variables/).length).toBeGreaterThan(0)
  })

  it('lets users retry failed artifact processing from the receipt', async () => {
    const user = userEvent.setup()
    walletState.account = { address: '0x1234567890abcdef' }
    storeTestSession()
    vi.stubGlobal('fetch', mockFetch({
      '/health/storage': jsonResponse(storageHealth()),
      '/v1/twins/twin-id/artifacts': jsonResponse({
        artifactId: 'artifact-id',
        memoryFragmentId: null,
        status: 'failed',
        storageMode: 'encrypted_walrus',
        sensitivity: 'private',
        rawStorageRef: 'walrus://blob/blob-id',
        warning: null,
      }, 201),
      '/v1/twins/twin-id/artifacts/artifact-id/retry': jsonResponse({
        artifactId: 'artifact-id',
        status: 'queued',
        processingJobId: 'retry-job-id',
        warning: null,
      }),
    }))

    render(<App />)
    await user.type(screen.getByLabelText('Content'), 'Raw text memory')
    await user.click(screen.getByRole('button', { name: 'Save private memory' }))

    await user.click(await screen.findByRole('button', { name: 'Retry processing' }))

    expect(await screen.findByText('Retry queued.')).toBeInTheDocument()
    expect(screen.getByText('retry-job-id')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/twins/twin-id/artifacts/artifact-id/retry',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer api-token',
        }),
      }),
    )
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
    expect(screen.getAllByText('API session is invalid or expired. Sign in with your wallet again.').length).toBeGreaterThan(0)
  })
})

class MockMediaRecorder extends EventTarget {
  static isTypeSupported(type: string) {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm'
  }

  readonly mimeType: string
  state: RecordingState = 'inactive'

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    const data = new Blob(['recorded audio'], { type: this.mimeType })
    const dataEvent = new Event('dataavailable') as Event & { data: Blob }
    Object.defineProperty(dataEvent, 'data', { value: data })
    this.dispatchEvent(dataEvent)
    this.dispatchEvent(new Event('stop'))
  }
}

type RecordingState = 'inactive' | 'recording'

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

function expectEncryptedArtifactRequest(sourceType: string, forbiddenText: string[] = []) {
  const call = (fetch as unknown as {
    mock: { calls: Array<[string, RequestInit | undefined]> }
  }).mock.calls.find(([url]) => url === 'http://127.0.0.1:3000/v1/twins/twin-id/artifacts')

  expect(call).toBeDefined()

  const request = call?.[1]
  const bodyText = String(request?.body ?? '')
  const body = JSON.parse(bodyText) as {
    sourceType?: string
    encryptedPayload?: {
      ciphertextBase64?: string
      ciphertextSha256?: string
      seal?: {
        packageId?: string
        policyId?: string
        threshold?: number
        keyServerObjectIds?: string[]
      }
    }
  }

  expect(request).toEqual(expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      authorization: 'Bearer api-token',
    }),
  }))
  expect(body).toEqual({
    sourceType,
    encryptedPayload: {
      ciphertextBase64: expect.any(String),
      ciphertextSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      seal: {
        packageId: '0xpackage',
        policyId: '0xpolicy',
        threshold: 1,
        keyServerObjectIds: ['0xkeyserver'],
      },
    },
  })

  for (const text of forbiddenText) {
    expect(bodyText).not.toContain(text)
  }

  return body
}

type MockResponse = ReturnType<typeof jsonResponse> | ReturnType<typeof sseResponse>

function mockFetch(responses: Record<string, MockResponse | MockResponse[]>) {
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

function sseResponse(event: unknown) {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)

  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    }),
  }
}
