import { useEffect, useMemo, useState } from 'react'
import {
  useCurrentAccount,
  useCurrentNetwork,
  useCurrentWallet,
  useDAppKit,
} from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import './App.css'

type Session = {
  token: string
  refreshToken: string
  expiresAt: string
  twinId: string
  walletAddress: string
}

type ChallengeResponse = {
  message: string
  challengeToken: string
}

type VerifyResponse = Session & {
  userId: string
}

type ArtifactReceipt = {
  artifactId: string
  memoryFragmentId: string | null
  status: string
  storageMode: string
  sensitivity: string
  rawStorageRef: string | null
  processingJobId?: string | null
  warning: string | null
}

type SourceType = 'note' | 'markdown' | 'upload' | 'pdf'

type UploadMetadata = {
  fileName: string
  fileType: string
  fileSize: number
  uploadKind: 'file'
}

type Notice = {
  tone: 'success' | 'error' | 'info'
  title: string
  body: string
}

type StorageHealth = {
  ok: boolean
  storage: {
    mode: string
    ready: boolean
    checks: Record<string, boolean>
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const SESSION_STORAGE_KEY = 'sivraj.session.v1'
const textEncoder = new TextEncoder()

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function App() {
  const dAppKit = useDAppKit()
  const account = useCurrentAccount()
  const wallet = useCurrentWallet()
  const network = useCurrentNetwork()
  const [session, setSession] = useState<Session | null>(readStoredSession)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('note')
  const [uploadMetadata, setUploadMetadata] = useState<UploadMetadata | null>(null)
  const [receipt, setReceipt] = useState<ArtifactReceipt | null>(null)
  const [notice, setNotice] = useState<Notice>({
    tone: 'info',
    title: 'Private memory is encrypted before storage.',
    body: 'Connect a Sui wallet, sign in, then submit a manual memory to the encrypted Walrus path.',
  })
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null)
  const [storageHealthError, setStorageHealthError] = useState<string | null>(null)

  const isSessionForWallet = Boolean(
    account &&
      session &&
      session.walletAddress.toLowerCase() === account.address.toLowerCase(),
  )
  const canSubmit = isSessionForWallet && content.trim().length > 0 && !isSubmitting
  const trimmedWallet = useMemo(
    () => (account ? shortenAddress(account.address) : 'No wallet connected'),
    [account],
  )

  useEffect(() => {
    if (!account || !session) {
      return
    }

    if (session.walletAddress.toLowerCase() !== account.address.toLowerCase()) {
      clearSession()
      setSession(null)
      setReceipt(null)
      setNotice({
        tone: 'info',
        title: 'Wallet changed.',
        body: 'Sign in again so the API session matches the connected Sui address.',
      })
    }
  }, [account, session])

  useEffect(() => {
    let cancelled = false

    getJson<StorageHealth>('/health/storage')
      .then((health) => {
        if (!cancelled) {
          setStorageHealth(health)
          setStorageHealthError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStorageHealth(null)
          setStorageHealthError(errorMessage(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignIn() {
    if (!account) {
      setNotice({
        tone: 'error',
        title: 'Connect wallet first.',
        body: 'Sivraj needs a connected Sui wallet before it can request a sign-in challenge.',
      })
      return
    }

    setIsSigningIn(true)
    setReceipt(null)

    try {
      const challenge = await postJson<ChallengeResponse>('/v1/auth/challenge', {
        walletAddress: account.address,
      })
      const signed = await dAppKit.signPersonalMessage({
        message: textEncoder.encode(challenge.message),
      })
      const verified = await postJson<VerifyResponse>('/v1/auth/verify', {
        walletAddress: account.address,
        message: challenge.message,
        signature: signed.signature,
        challengeToken: challenge.challengeToken,
      })
      const nextSession: Session = {
        token: verified.token,
        refreshToken: verified.refreshToken,
        expiresAt: verified.expiresAt,
        twinId: verified.twinId,
        walletAddress: verified.walletAddress,
      }

      setSession(nextSession)
      storeSession(nextSession)
      setNotice({
        tone: 'success',
        title: 'Wallet verified.',
        body: 'Your API session is ready for private memory upload and retrieval.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Wallet sign-in failed.',
        body: errorMessage(error),
      })
    } finally {
      setIsSigningIn(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!session || !isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before creating private memory.',
      })
      return
    }

    setIsSubmitting(true)
    setReceipt(null)

    try {
      const result = await postAuthedJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/artifacts`,
        {
          sourceType,
          title: title.trim() || null,
          content: content.trim(),
          metadata: uploadMetadata ?? {},
        },
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt(result)
      setContent('')
      setTitle('')
      setSourceType('note')
      setUploadMetadata(null)
      setNotice({
        tone: 'success',
        title: 'Encrypted memory queued.',
        body: 'The raw memory was sent through the encrypted Walrus storage path.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setNotice({
        tone: 'error',
        title: message.toLowerCase().includes('encrypted storage')
          ? 'Encrypted storage is not configured.'
          : 'Memory upload failed.',
        body: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!isTextLikeFile(file) && !isPdf(file)) {
      event.target.value = ''
      setUploadMetadata(null)
      setSourceType('note')
      setNotice({
        tone: 'error',
        title: 'Unsupported file type.',
        body: 'Choose a .txt, .md, .markdown, or .pdf file for this upload step.',
      })
      return
    }

    let text: string
    let nextSourceType: SourceType

    try {
      text = isPdf(file) ? await extractPdfText(file) : await file.text()
      nextSourceType = isPdf(file) ? 'pdf' : isMarkdown(file) ? 'markdown' : 'upload'
    } catch (error) {
      event.target.value = ''
      setUploadMetadata(null)
      setSourceType('note')
      setNotice({
        tone: 'error',
        title: 'PDF text extraction failed.',
        body: errorMessage(error),
      })
      return
    }

    if (text.trim().length === 0) {
      event.target.value = ''
      setUploadMetadata(null)
      setSourceType('note')
      setNotice({
        tone: 'error',
        title: 'No text found.',
        body: 'This file did not produce extractable text for the encrypted memory pipeline.',
      })
      return
    }

    setTitle(file.name)
    setContent(text)
    setSourceType(nextSourceType)
    setUploadMetadata({
      fileName: file.name,
      fileType: file.type || inferFileType(file.name),
      fileSize: file.size,
      uploadKind: 'file',
    })
    setReceipt(null)
    setNotice({
      tone: 'info',
      title: `${formatSourceType(nextSourceType)} file loaded.`,
      body: 'Review the content, then save it through the encrypted Walrus path.',
    })
  }

  function handleContentChanged(value: string) {
    setContent(value)
  }

  function handleResetSession() {
    clearSession()
    setSession(null)
    setReceipt(null)
    setNotice({
      tone: 'info',
      title: 'Session cleared.',
      body: 'Connect and sign again when you are ready to write private memory.',
    })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sivraj</p>
          <h1>Manual Memory</h1>
        </div>
        <div className="wallet-actions">
          <ConnectButton />
          <button
            className="secondary-action"
            type="button"
            onClick={handleSignIn}
            disabled={!account || isSigningIn}
          >
            {isSigningIn ? 'Signing...' : isSessionForWallet ? 'Refresh sign-in' : 'Sign in'}
          </button>
          {session ? (
            <button className="text-action" type="button" onClick={handleResetSession}>
              Clear
            </button>
          ) : null}
        </div>
      </header>

      <section className="status-strip" aria-label="Connection status">
        <StatusItem label="Wallet" value={trimmedWallet} />
        <StatusItem label="Wallet app" value={wallet?.name ?? 'None'} />
        <StatusItem label="Network" value={network || 'testnet'} />
        <StatusItem label="Session" value={isSessionForWallet ? 'Verified' : 'Not verified'} />
      </section>

      <section className="workspace">
        <form className="memory-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">Private memory</p>
            <h2>Capture text, Markdown, or PDF</h2>
          </div>

          <label className="file-upload">
            <span>File upload</span>
            <input
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown,text/x-markdown,application/pdf,.pdf"
              onChange={handleFileSelected}
            />
          </label>

          {uploadMetadata ? (
            <div className="upload-summary">
              <strong>{uploadMetadata.fileName}</strong>
              <span>{sourceType} · {uploadMetadata.fileSize} bytes</span>
            </div>
          ) : null}

          <label>
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Founder note"
              autoComplete="off"
            />
          </label>

          <label>
            <span>Content</span>
            <textarea
              value={content}
              onChange={(event) => handleContentChanged(event.target.value)}
              placeholder="Write the raw memory text here."
              rows={11}
            />
          </label>

          <div className="form-footer">
            <p>{content.trim().length} chars ready for encrypted {sourceType} upload</p>
            <button className="primary-action" type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Encrypting...' : 'Save private memory'}
            </button>
          </div>
        </form>

        <aside className="inspector" aria-live="polite">
          <StorageHealthPanel health={storageHealth} error={storageHealthError} />
          <NoticePanel notice={notice} />
          {receipt ? <ReceiptPanel receipt={receipt} /> : <EmptyReceipt />}
        </aside>
      </section>
    </main>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function NoticePanel({ notice }: { notice: Notice }) {
  return (
    <section className={`notice ${notice.tone}`}>
      <h2>{notice.title}</h2>
      <p>{notice.body}</p>
    </section>
  )
}

function StorageHealthPanel({
  health,
  error,
}: {
  health: StorageHealth | null
  error: string | null
}) {
  const ready = health?.storage.ready === true
  const checks = health ? Object.entries(health.storage.checks) : []

  return (
    <section className={`storage-health ${ready ? 'ready' : 'blocked'}`}>
      <div className="section-heading">
        <p className="eyebrow">Storage health</p>
        <h2>{ready ? 'Encrypted path ready' : 'Encrypted path blocked'}</h2>
      </div>
      {error ? <p>{error}</p> : null}
      {!health && !error ? <p>Checking storage configuration...</p> : null}
      {checks.length > 0 ? (
        <ul>
          {checks.map(([name, ok]) => (
            <li key={name}>
              <span className={ok ? 'dot ok' : 'dot fail'} />
              <span>{formatCheckName(name)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ReceiptPanel({ receipt }: { receipt: ArtifactReceipt }) {
  return (
    <section className="receipt">
      <div className="section-heading">
        <p className="eyebrow">Encrypted receipt</p>
        <h2>Walrus storage confirmed</h2>
      </div>
      <dl>
        <div>
          <dt>Artifact</dt>
          <dd>{receipt.artifactId}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{receipt.status}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{receipt.storageMode}</dd>
        </div>
        <div>
          <dt>Walrus ref</dt>
          <dd>{receipt.rawStorageRef}</dd>
        </div>
        {receipt.processingJobId ? (
          <div>
            <dt>Processing job</dt>
            <dd>{receipt.processingJobId}</dd>
          </div>
        ) : null}
        {receipt.warning ? (
          <div>
            <dt>Warning</dt>
            <dd>{receipt.warning}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}

function EmptyReceipt() {
  return (
    <section className="empty-receipt">
      <h2>No receipt yet</h2>
      <p>Successful uploads will show the artifact ID, status, storage mode, and Walrus reference.</p>
    </section>
  )
}

async function postJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

async function postAuthedJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await postJson<TResponse>(path, body, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)

    return postJson<TResponse>(path, body, refreshed.token)
  }
}

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`)
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

function apiErrorMessage(status: number, payload: unknown): string {
  const error = payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : null

  if (status === 503 && error === 'encrypted_storage_not_configured') {
    return 'Encrypted storage is not configured yet. Configure Seal, Sui, and Walrus environment variables, then retry.'
  }

  if (status === 503 && error === 'encrypted_storage_failed') {
    return 'Encrypted storage failed before the memory could be saved. Check Seal, Sui, and Walrus runtime logs.'
  }

  if (status === 503 && error === 'auth_not_configured') {
    return 'API auth is not configured. Set JWT_SECRET in .env and restart the API server.'
  }

  if (status === 401) {
    return 'API session is invalid or expired. Sign in with your wallet again.'
  }

  if (typeof error === 'string') {
    return `API error: ${error}`
  }

  return `API request failed with status ${status}.`
}

async function refreshApiSession(session: Session): Promise<Session> {
  const refreshed = await postJson<VerifyResponse>('/v1/auth/refresh', {
    refreshToken: session.refreshToken,
    walletAddress: session.walletAddress,
  })

  return {
    token: refreshed.token,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    twinId: refreshed.twinId,
    walletAddress: refreshed.walletAddress,
  }
}

function readStoredSession(): Session | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as Partial<Session>

    return isStoredSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

function storeSession(session: Session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
}

function isStoredSession(value: Partial<Session>): value is Session {
  return (
    typeof value.token === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'string' &&
    typeof value.twinId === 'string' &&
    typeof value.walletAddress === 'string'
  )
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatCheckName(name: string) {
  return name
    .replace(/Configured$/, '')
    .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    .trim()
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isMarkdown(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || file.type.includes('markdown')
}

function isTextLikeFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  )
}

async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const document = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .trim()

    if (pageText) {
      pages.push(pageText)
    }
  }

  return pages.join('\n\n')
}

function inferFileType(name: string) {
  return isMarkdown({ name, type: '' } as File) ? 'text/markdown' : 'text/plain'
}

function formatSourceType(value: SourceType) {
  if (value === 'pdf') {
    return 'PDF'
  }

  return value === 'markdown' ? 'Markdown' : 'Text'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.'
}

function isAuthError(error: unknown) {
  return error instanceof Error && error.message.includes('API session is invalid or expired')
}

export default App
