import { useEffect, useMemo, useState } from 'react'
import {
  useCurrentAccount,
  useCurrentNetwork,
  useCurrentWallet,
  useDAppKit,
} from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import './App.css'

type Session = {
  token: string
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
  warning: string | null
}

type Notice = {
  tone: 'success' | 'error' | 'info'
  title: string
  body: string
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const SESSION_STORAGE_KEY = 'sivraj.session.v1'
const textEncoder = new TextEncoder()

function App() {
  const dAppKit = useDAppKit()
  const account = useCurrentAccount()
  const wallet = useCurrentWallet()
  const network = useCurrentNetwork()
  const [session, setSession] = useState<Session | null>(readStoredSession)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [receipt, setReceipt] = useState<ArtifactReceipt | null>(null)
  const [notice, setNotice] = useState<Notice>({
    tone: 'info',
    title: 'Private memory is encrypted before storage.',
    body: 'Connect a Sui wallet, sign in, then submit a manual memory to the encrypted Walrus path.',
  })
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
        twinId: verified.twinId,
        walletAddress: verified.walletAddress,
      }

      setSession(nextSession)
      storeSession(nextSession)
      setNotice({
        tone: 'success',
        title: 'Wallet verified.',
        body: 'Your API session is ready for private manual memory upload.',
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
      const result = await postJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/artifacts`,
        {
          sourceType: 'note',
          title: title.trim() || null,
          content: content.trim(),
          metadata: {},
        },
        session.token,
      )

      setReceipt(result)
      setContent('')
      setTitle('')
      setNotice({
        tone: 'success',
        title: 'Encrypted memory queued.',
        body: 'The raw memory was sent through the encrypted Walrus storage path.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setNotice({
        tone: 'error',
        title: message.includes('encrypted storage')
          ? 'Encrypted storage is not configured.'
          : 'Memory upload failed.',
        body: message,
      })
    } finally {
      setIsSubmitting(false)
    }
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
            <p className="eyebrow">Private note</p>
            <h2>Capture a memory fragment</h2>
          </div>

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
              onChange={(event) => setContent(event.target.value)}
              placeholder="Write the raw memory text here."
              rows={11}
            />
          </label>

          <div className="form-footer">
            <p>{content.trim().length} chars ready for encrypted upload</p>
            <button className="primary-action" type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Encrypting...' : 'Save private memory'}
            </button>
          </div>
        </form>

        <aside className="inspector" aria-live="polite">
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

function apiErrorMessage(status: number, payload: unknown): string {
  const error = payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : null

  if (status === 503 && error === 'encrypted_storage_not_configured') {
    return 'Encrypted storage is not configured yet. Configure Seal, Sui, and Walrus environment variables, then retry.'
  }

  if (status === 503 && error === 'encrypted_storage_failed') {
    return 'Encrypted storage failed before the memory could be saved. Check Seal, Sui, and Walrus runtime logs.'
  }

  if (status === 401) {
    return 'API session is invalid or expired. Sign in with your wallet again.'
  }

  if (typeof error === 'string') {
    return `API error: ${error}`
  }

  return `API request failed with status ${status}.`
}

function readStoredSession(): Session | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY)
    return stored ? (JSON.parse(stored) as Session) : null
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

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.'
}

export default App
