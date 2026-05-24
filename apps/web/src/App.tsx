import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useCurrentAccount,
  useCurrentNetwork,
  useCurrentWallet,
  useDAppKit,
} from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { SealClient, type KeyServerConfig } from '@mysten/seal'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import './App.css'
import { ConsoleShell } from './console/ConsoleShell'

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
  intelligenceStatus?: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'
  github?: {
    repoUrl: string
    owner: string
    repo: string
    fileCount: number
  }
}

type ArtifactStatusEvent = {
  artifactId: string
  twinId: string
  sourceType: string
  status: ArtifactReceipt['status']
  intelligenceStatus?: ArtifactReceipt['intelligenceStatus']
  intelligenceStage?: 'entity_extraction' | 'memory_extraction'
  reason?: string
  occurredAt: string
}

type ArtifactRetryResponse = {
  artifactId: string
  status: string
  processingJobId?: string | null
  warning?: string | null
}

type SourceType =
  | 'note'
  | 'markdown'
  | 'upload'
  | 'pdf'
  | 'ocr_pdf'
  | 'image'
  | 'voice_note'
  | 'voice_conversation'
  | 'onboarding_self_description'
  | 'browser_history'

type TwinIdentityProfile = {
  twinId: string
  displayName: string | null
  aliases: string[]
  emails: string[]
  phones: string[]
  handles: Record<string, string[]>
  selfDescriptionArtifactId: string | null
}

type UploadMetadata = {
  fileName: string
  fileType: string
  fileSize: number
  uploadKind: 'file' | 'recording'
  importer?: 'browser_history_export'
  encoding?: 'base64'
  audio?: {
    kind: 'voice_note' | 'voice_conversation'
    durationMs?: number
    recordedAt?: string
  }
  ocr?: {
    requested: boolean
    reason: string
  }
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

type RecordingState = 'idle' | 'requesting_permission' | 'recording' | 'recorded' | 'saving' | 'error'
type UploadPhase =
  | 'idle'
  | 'reading_file'
  | 'extracting_pdf'
  | 'encoding_binary'
  | 'ready'
  | 'encrypting_uploading'
  | 'queued'
  | 'processing'
  | 'pending'
  | 'completed'
  | 'failed'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const SESSION_STORAGE_KEY = 'sivraj.session.v1'
const textEncoder = new TextEncoder()

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type AppMode = 'memory' | 'console'

function App() {
  const dAppKit = useDAppKit()
  const account = useCurrentAccount()
  const wallet = useCurrentWallet()
  const network = useCurrentNetwork()
  const [session, setSession] = useState<Session | null>(readStoredSession)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('note')
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [uploadMetadata, setUploadMetadata] = useState<UploadMetadata | null>(null)
  const [receipt, setReceipt] = useState<ArtifactReceipt | null>(null)
  const [notice, setNotice] = useState<Notice>({
    tone: 'info',
    title: 'Private memory is encrypted before storage.',
    body: 'Connect a Sui wallet, sign in, then submit a manual memory to the encrypted Walrus path.',
  })
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingIdentityProfile, setIsSavingIdentityProfile] = useState(false)
  const [isSavingSelfDescription, setIsSavingSelfDescription] = useState(false)
  const [isImportingGitHub, setIsImportingGitHub] = useState(false)
  const [isRetryingArtifact, setIsRetryingArtifact] = useState(false)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null)
  const [recordedVoiceBlob, setRecordedVoiceBlob] = useState<Blob | null>(null)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [uploadPhaseDetail, setUploadPhaseDetail] = useState('Waiting for private memory input.')
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null)
  const [storageHealthError, setStorageHealthError] = useState<string | null>(null)
  const [statusStreamNonce, setStatusStreamNonce] = useState(0)
  const [appMode, setAppMode] = useState<AppMode>('memory')
  const [identityDisplayName, setIdentityDisplayName] = useState('')
  const [identityAliases, setIdentityAliases] = useState('')
  const [identityEmails, setIdentityEmails] = useState('')
  const [identityPhones, setIdentityPhones] = useState('')
  const [identityGithub, setIdentityGithub] = useState('')
  const [identitySlack, setIdentitySlack] = useState('')
  const [identityX, setIdentityX] = useState('')
  const [identitySelfDescription, setIdentitySelfDescription] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)

  const isSessionForWallet = Boolean(
    account &&
      session &&
      session.walletAddress.toLowerCase() === account.address.toLowerCase(),
  )
  const canSubmit = isSessionForWallet && content.trim().length > 0 && !isSubmitting
  const canSaveIdentityProfile = isSessionForWallet && !isSavingIdentityProfile
  const canSaveSelfDescription = isSessionForWallet && identitySelfDescription.trim().length > 0 && !isSavingSelfDescription
  const canImportGitHub = isSessionForWallet && githubRepoUrl.trim().length > 0 && !isImportingGitHub
  const canStartRecording = isSessionForWallet && recordingState !== 'recording' && recordingState !== 'requesting_permission' && recordingState !== 'saving'
  const canSaveRecording = isSessionForWallet && recordingState === 'recorded' && Boolean(recordedVoiceBlob)
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

  useEffect(() => {
    if (!session || !isSessionForWallet) {
      return
    }

    let cancelled = false

    getAuthedJson<TwinIdentityProfile>(
      `/v1/twins/${session.twinId}/identity-profile`,
      session,
      (refreshed) => {
        setSession(refreshed)
        storeSession(refreshed)
      },
    )
      .then((profile) => {
        if (cancelled) {
          return
        }

        setIdentityDisplayName(profile.displayName ?? '')
        setIdentityAliases(profile.aliases.join(', '))
        setIdentityEmails(profile.emails.join(', '))
        setIdentityPhones(profile.phones.join(', '))
        setIdentityGithub((profile.handles.github ?? []).join(', '))
        setIdentitySlack((profile.handles.slack ?? []).join(', '))
        setIdentityX((profile.handles.x ?? []).join(', '))
      })
      .catch(() => {
        // A missing profile is normal for first-run onboarding.
      })

    return () => {
      cancelled = true
    }
  }, [session?.twinId, session?.token, isSessionForWallet])

  useEffect(() => {
    if (!receipt || !session || !isSessionForWallet) {
      return
    }

    const controller = new AbortController()

    streamArtifactStatusAuthed(
      session.twinId,
      receipt.artifactId,
      session,
      controller.signal,
      (refreshed) => {
        storeSession(refreshed)
        setSession(refreshed)
      },
      (event) => {
        setReceipt((current) => {
          if (!current || current.artifactId !== event.artifactId) {
            return current
          }

          return {
            ...current,
            status: event.status,
            intelligenceStatus: event.intelligenceStatus ?? current.intelligenceStatus,
          }
        })

        if (event.intelligenceStatus === 'processing') {
          setUploadProgress('completed', 'Encrypted memory stored. Twin learning is running in the background.')
        } else if (event.intelligenceStatus === 'completed') {
          setUploadProgress('completed', 'Encrypted memory stored. Twin learning completed.')
        } else if (event.intelligenceStatus === 'failed') {
          setUploadProgress('completed', 'Encrypted memory stored. Twin learning needs attention, but upload succeeded.')
        } else if (event.status === 'failed') {
          const detail = event.reason ? `Processing failed: ${event.reason}.` : 'Artifact processing failed.'
          setUploadProgress('failed', detail)
          setNotice({
            tone: 'error',
            title: 'Processing failed.',
            body: detail,
          })
        } else if (event.status === 'completed') {
          setUploadProgress('completed', 'Encrypted memory stored and retrievable. Twin learning is queued.')
        } else if (event.status === 'pending') {
          const detail = event.reason ? `Processing pending: ${event.reason}.` : 'Worker marked this artifact pending.'
          setUploadProgress('pending', detail)
        } else if (event.status === 'processing') {
          setUploadProgress('processing', 'Worker is processing this encrypted artifact.')
        } else if (event.status === 'queued') {
          setUploadProgress('queued', 'Encrypted artifact stored and queued for worker processing.')
        }
      },
    ).catch((error) => {
      if (!controller.signal.aborted) {
        setUploadProgress('failed', `Status stream failed: ${errorMessage(error)}`)
      }
    })

    return () => {
      controller.abort()
    }
  }, [receipt?.artifactId, session?.twinId, isSessionForWallet, statusStreamNonce])

  useEffect(() => {
    return () => {
      stopRecordingTimer()
      stopRecordingStream()

      if (recordingPreviewUrl) {
        URL.revokeObjectURL(recordingPreviewUrl)
      }
    }
  }, [recordingPreviewUrl])

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
      setUploadProgress('encrypting_uploading', 'Encrypting private memory on this device, then storing ciphertext on Walrus.')
      const encryptedBody = await buildClientEncryptedArtifactBody({
        sourceType,
        title: title.trim() || null,
        content: content.trim(),
        metadata: uploadMetadata ?? {},
      })
      const result = await postAuthedJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/artifacts`,
        encryptedBody,
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt(result)
      setStatusStreamNonce((value) => value + 1)
      setContent('')
      setTitle('')
      setSourceType('note')
      setUploadMetadata(null)
      setUploadProgress('queued', 'Encrypted artifact stored and queued for worker processing.')
      setNotice({
        tone: 'success',
        title: 'Encrypted memory queued.',
        body: 'The raw memory was sent through the encrypted Walrus storage path.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setUploadProgress('failed', message)
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

  async function handleSaveIdentityProfile() {
    if (!session || !isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before saving Twin identity context.',
      })
      return
    }

    setIsSavingIdentityProfile(true)

    try {
      const profile = await putAuthedJson<TwinIdentityProfile>(
        `/v1/twins/${session.twinId}/identity-profile`,
        {
          displayName: identityDisplayName.trim() || null,
          aliases: parseCommaList(identityAliases),
          emails: parseCommaList(identityEmails),
          phones: parseCommaList(identityPhones),
          handles: {
            github: parseCommaList(identityGithub),
            slack: parseCommaList(identitySlack),
            x: parseCommaList(identityX),
          },
        },
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setIdentityDisplayName(profile.displayName ?? '')
      setIdentityAliases(profile.aliases.join(', '))
      setIdentityEmails(profile.emails.join(', '))
      setIdentityPhones(profile.phones.join(', '))
      setIdentityGithub((profile.handles.github ?? []).join(', '))
      setIdentitySlack((profile.handles.slack ?? []).join(', '))
      setIdentityX((profile.handles.x ?? []).join(', '))
      setNotice({
        tone: 'success',
        title: 'Twin identity saved.',
        body: 'Sivraj can use these aliases later to attribute chat speakers to you or to other people.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Twin identity save failed.',
        body: errorMessage(error),
      })
    } finally {
      setIsSavingIdentityProfile(false)
    }
  }

  async function handleSaveSelfDescription() {
    if (!session || !isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before telling Sivraj about yourself.',
      })
      return
    }

    setIsSavingSelfDescription(true)
    setReceipt(null)

    try {
      setUploadProgress('encrypting_uploading', 'Encrypting your onboarding context before storing it.')
      const encryptedBody = await buildClientEncryptedArtifactBody({
        sourceType: 'onboarding_self_description',
        title: 'Twin onboarding self-description',
        content: identitySelfDescription.trim(),
        metadata: {
          onboarding: {
            kind: 'self_description',
          },
        },
      })
      const result = await postAuthedJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/artifacts`,
        encryptedBody,
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt(result)
      setStatusStreamNonce((value) => value + 1)
      setIdentitySelfDescription('')
      setUploadProgress('queued', 'Encrypted onboarding context stored and queued for Twin learning.')
      setNotice({
        tone: 'success',
        title: 'Onboarding context queued.',
        body: 'Sivraj stored this as encrypted private memory for your Twin to learn from.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setUploadProgress('failed', message)
      setNotice({
        tone: 'error',
        title: 'Onboarding context save failed.',
        body: message,
      })
    } finally {
      setIsSavingSelfDescription(false)
    }
  }

  async function handleStartRecording() {
    if (!isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before recording a private voice conversation.',
      })
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingState('error')
      setNotice({
        tone: 'error',
        title: 'Recording is not supported.',
        body: 'This browser does not expose microphone recording APIs required for voice conversation capture.',
      })
      return
    }

    discardRecording()
    setRecordingState('requesting_permission')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = preferredRecordingMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      recordingStreamRef.current = stream
      recordingChunksRef.current = []
      recorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      })
      recorder.addEventListener('stop', () => {
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(recordingChunksRef.current, { type })
        const previewUrl = URL.createObjectURL(blob)

        stopRecordingTimer()
        stopRecordingStream()
        setRecordedVoiceBlob(blob)
        setRecordingPreviewUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous)
          }

          return previewUrl
        })
        setRecordingState('recorded')
      })

      recorder.start()
      setRecordingSeconds(0)
      setRecordingState('recording')
      recordingTimerRef.current = window.setInterval(() => {
        const startedAt = recordingStartedAtRef.current
        setRecordingSeconds(startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0)
      }, 250)
    } catch (error) {
      stopRecordingTimer()
      stopRecordingStream()
      setRecordingState('error')
      setNotice({
        tone: 'error',
        title: 'Microphone permission failed.',
        body: errorMessage(error),
      })
    }
  }

  function handleStopRecording() {
    const recorder = recorderRef.current

    if (recorder && recorder.state === 'recording') {
      recorder.stop()
    }
  }

  async function handleSaveRecording() {
    if (!session || !isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before saving a private voice conversation.',
      })
      return
    }

    if (!recordedVoiceBlob) {
      return
    }

    const recordedAt = new Date().toISOString()
    const durationMs = Math.max(1000, Math.round(recordingSeconds * 1000))
    const extension = recordedVoiceBlob.type.includes('mp4') ? 'm4a' : 'webm'
    const fileName = `voice-conversation-${recordedAt.replace(/[:.]/g, '-')}.${extension}`
    const metadata: UploadMetadata = {
      fileName,
      fileType: recordedVoiceBlob.type || 'audio/webm',
      fileSize: recordedVoiceBlob.size,
      uploadKind: 'recording',
      encoding: 'base64',
      audio: {
        kind: 'voice_conversation',
        durationMs,
        recordedAt,
      },
    }

    setRecordingState('saving')
    setReceipt(null)

    try {
      setUploadProgress('encoding_binary', 'Encoding recorded audio for encrypted storage.')
      const audioBase64 = await blobToBase64(recordedVoiceBlob)
      setUploadProgress('encrypting_uploading', 'Encrypting recorded conversation on this device, then storing ciphertext on Walrus.')
      const encryptedBody = await buildClientEncryptedArtifactBody({
        sourceType: 'voice_conversation',
        title: fileName,
        content: audioBase64,
        metadata,
      })
      const result = await postAuthedJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/artifacts`,
        encryptedBody,
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt(result)
      setStatusStreamNonce((value) => value + 1)
      discardRecording()
      setUploadProgress('queued', 'Encrypted voice conversation stored and queued for transcription.')
      setNotice({
        tone: 'success',
        title: 'Voice conversation queued.',
        body: 'The recorded audio was encrypted, stored on Walrus, and queued for transcription.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setRecordingState('recorded')
      setUploadProgress('failed', message)
      setNotice({
        tone: 'error',
        title: message.toLowerCase().includes('encrypted storage')
          ? 'Encrypted storage is not configured.'
          : 'Voice conversation upload failed.',
        body: message,
      })
    }
  }

  function discardRecording() {
    stopRecordingTimer()
    stopRecordingStream()
    recorderRef.current = null
    recordingChunksRef.current = []
    recordingStartedAtRef.current = null
    setRecordingSeconds(0)
    setRecordedVoiceBlob(null)
    setRecordingState('idle')
    setUploadProgress('idle', 'Waiting for private memory input.')
    setRecordingPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous)
      }

      return null
    })
  }

  function stopRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  function stopRecordingStream() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingStreamRef.current = null
  }

  function setUploadProgress(phase: UploadPhase, detail: string) {
    setUploadPhase(phase)
    setUploadPhaseDetail(detail)
  }

  async function handleGitHubImport() {
    if (!session || !isSessionForWallet) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before importing a GitHub repository.',
      })
      return
    }

    setIsImportingGitHub(true)
    setReceipt(null)

    try {
      setUploadProgress('encrypting_uploading', 'Bundling repository context, encrypting it, and storing ciphertext on Walrus.')
      const result = await postAuthedJson<ArtifactReceipt>(
        `/v1/twins/${session.twinId}/imports/github`,
        {
          repoUrl: githubRepoUrl.trim(),
        },
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt(result)
      setStatusStreamNonce((value) => value + 1)
      setGithubRepoUrl('')
      setUploadProgress('queued', 'Encrypted repository artifact stored and queued for worker processing.')
      setNotice({
        tone: 'success',
        title: 'GitHub repository queued.',
        body: 'Repository context was bundled, encrypted, stored on Walrus, and queued for memory processing.',
      })
    } catch (error) {
      setUploadProgress('failed', errorMessage(error))
      setNotice({
        tone: 'error',
        title: 'GitHub import failed.',
        body: errorMessage(error),
      })
    } finally {
      setIsImportingGitHub(false)
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!isTextLikeFile(file) && !isBrowserHistoryFile(file) && !isPdf(file) && !isImage(file) && !isAudio(file)) {
      event.target.value = ''
      setUploadMetadata(null)
      setSourceType('note')
      setUploadProgress('failed', 'Unsupported file type.')
      setNotice({
        tone: 'error',
        title: 'Unsupported file type.',
        body: 'Choose a .txt, .md, .markdown, .pdf, .png, .jpg, .jpeg, .webp, .mp3, .m4a, .wav, .webm, .json, .csv, or .html file for this upload step.',
      })
      return
    }

    let text: string
    let nextSourceType: SourceType
    let nextMetadata: UploadMetadata

    try {
      if (isPdf(file)) {
        setUploadProgress('extracting_pdf', 'Extracting readable text from PDF before encrypted storage.')
        text = await extractPdfText(file)
        nextSourceType = text.trim().length > 0 ? 'pdf' : 'ocr_pdf'
        nextMetadata = {
          fileName: file.name,
          fileType: file.type || inferFileType(file.name),
          fileSize: file.size,
          uploadKind: 'file',
          ...(nextSourceType === 'ocr_pdf'
            ? {
                encoding: 'base64',
                ocr: {
                  requested: true,
                  reason: 'no_extractable_pdf_text',
                },
              }
            : {}),
        }

        if (nextSourceType === 'ocr_pdf') {
          setUploadProgress('encoding_binary', 'No readable PDF text found. Encoding scanned PDF for encrypted OCR processing.')
          text = await fileToBase64(file)
        }
      } else if (isImage(file)) {
        setUploadProgress('encoding_binary', 'Encoding image for encrypted OCR processing.')
        text = await fileToBase64(file)
        nextSourceType = 'image'
        nextMetadata = {
          fileName: file.name,
          fileType: file.type || inferFileType(file.name),
          fileSize: file.size,
          uploadKind: 'file',
          encoding: 'base64',
          ocr: {
            requested: true,
            reason: 'image_upload',
          },
        }
      } else if (isAudio(file)) {
        setUploadProgress('encoding_binary', 'Encoding audio for encrypted transcription processing.')
        text = await fileToBase64(file)
        nextSourceType = 'voice_note'
        nextMetadata = {
          fileName: file.name,
          fileType: file.type || inferFileType(file.name),
          fileSize: file.size,
          uploadKind: 'file',
          encoding: 'base64',
          audio: {
            kind: 'voice_note',
          },
        }
      } else if (isBrowserHistoryFile(file)) {
        setUploadProgress('reading_file', 'Reading browser history export.')
        text = await file.text()
        nextSourceType = 'browser_history'
        nextMetadata = {
          fileName: file.name,
          fileType: file.type || inferFileType(file.name),
          fileSize: file.size,
          uploadKind: 'file',
          importer: 'browser_history_export',
        }
      } else {
        setUploadProgress('reading_file', 'Reading text file.')
        text = await file.text()
        nextSourceType = isMarkdown(file) ? 'markdown' : 'upload'
        nextMetadata = {
          fileName: file.name,
          fileType: file.type || inferFileType(file.name),
          fileSize: file.size,
          uploadKind: 'file',
        }
      }
    } catch (error) {
      event.target.value = ''
      setUploadMetadata(null)
      setSourceType('note')
      setUploadProgress('failed', errorMessage(error))
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
      setUploadProgress('failed', 'This file did not produce processable content.')
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
    setUploadMetadata(nextMetadata)
    setReceipt(null)
    setUploadProgress('ready', `${formatSourceType(nextSourceType)} is ready for encrypted upload.`)
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

  async function handleRetryArtifact() {
    if (!session || !isSessionForWallet || !receipt) {
      setNotice({
        tone: 'error',
        title: 'Sign in required.',
        body: 'Verify the connected wallet before retrying artifact processing.',
      })
      return
    }

    setIsRetryingArtifact(true)

    try {
      setUploadProgress('queued', 'Retry requested. Artifact queued for worker processing.')
      const result = await postAuthedJson<ArtifactRetryResponse>(
        `/v1/twins/${session.twinId}/artifacts/${receipt.artifactId}/retry`,
        {},
        session,
        (refreshed) => {
          setSession(refreshed)
          storeSession(refreshed)
        },
      )

      setReceipt((current) => {
        if (!current || current.artifactId !== result.artifactId) {
          return current
        }

        return {
          ...current,
          status: result.status,
          processingJobId: result.processingJobId ?? current.processingJobId,
          warning: result.warning ?? null,
        }
      })
      setStatusStreamNonce((value) => value + 1)
      setNotice({
        tone: 'success',
        title: 'Retry queued.',
        body: 'The failed artifact was requeued for worker processing.',
      })
    } catch (error) {
      const message = errorMessage(error)
      setUploadProgress('failed', message)
      setNotice({
        tone: 'error',
        title: 'Retry failed.',
        body: message,
      })
    } finally {
      setIsRetryingArtifact(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sivraj</p>
          <h1>{appMode === 'console' ? 'Testing Console' : 'Manual Memory'}</h1>
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

      <nav className="app-mode-nav" aria-label="Application mode">
        <button
          type="button"
          className={appMode === 'memory' ? 'app-mode-button active' : 'app-mode-button'}
          onClick={() => setAppMode('memory')}
        >
          Manual Memory
        </button>
        <button
          type="button"
          className={appMode === 'console' ? 'app-mode-button active' : 'app-mode-button'}
          onClick={() => setAppMode('console')}
        >
          Testing Console
        </button>
      </nav>

      {appMode === 'console' ? (
        <ConsoleShell
          session={session}
          isSessionForWallet={isSessionForWallet}
          onSessionRefreshed={(refreshed) => {
            setSession(refreshed)
            storeSession(refreshed)
          }}
        />
      ) : (
      <section className="workspace">
        <form className="memory-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">Private memory</p>
            <h2>Capture text, files, or voice</h2>
          </div>

          <section className="inline-source-panel" aria-label="Twin identity onboarding">
            <div className="section-heading compact">
              <p className="eyebrow">Twin identity</p>
              <h2>Tell Sivraj who you are</h2>
            </div>
            <div className="identity-grid">
              <label>
                <span>Display name</span>
                <input
                  value={identityDisplayName}
                  onChange={(event) => setIdentityDisplayName(event.target.value)}
                  placeholder="Fortune Ogunsusi"
                  autoComplete="name"
                />
              </label>
              <label>
                <span>Aliases</span>
                <input
                  value={identityAliases}
                  onChange={(event) => setIdentityAliases(event.target.value)}
                  placeholder="Fortune, DDBoy"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Emails</span>
                <input
                  value={identityEmails}
                  onChange={(event) => setIdentityEmails(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
              <label>
                <span>Phones</span>
                <input
                  value={identityPhones}
                  onChange={(event) => setIdentityPhones(event.target.value)}
                  placeholder="+234..."
                  autoComplete="tel"
                />
              </label>
              <label>
                <span>GitHub handles</span>
                <input
                  value={identityGithub}
                  onChange={(event) => setIdentityGithub(event.target.value)}
                  placeholder="ddboy19912"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Slack handles</span>
                <input
                  value={identitySlack}
                  onChange={(event) => setIdentitySlack(event.target.value)}
                  placeholder="@fortune"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>X handles</span>
                <input
                  value={identityX}
                  onChange={(event) => setIdentityX(event.target.value)}
                  placeholder="@fortune"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="identity-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={handleSaveIdentityProfile}
                disabled={!canSaveIdentityProfile}
              >
                {isSavingIdentityProfile ? 'Saving...' : 'Save identity'}
              </button>
            </div>
            <label>
              <span>What should Sivraj know about you?</span>
              <textarea
                value={identitySelfDescription}
                onChange={(event) => setIdentitySelfDescription(event.target.value)}
                placeholder="Tell Sivraj about your work, goals, background, preferences, or anything it should understand about you."
                rows={6}
              />
            </label>
            <div className="form-footer compact">
              <p>This context is encrypted as private memory and processed as Twin learning.</p>
              <button
                className="primary-action"
                type="button"
                onClick={handleSaveSelfDescription}
                disabled={!canSaveSelfDescription}
              >
                {isSavingSelfDescription ? 'Encrypting...' : 'Save about me'}
              </button>
            </div>
          </section>

          <section className="inline-source-panel" aria-label="Voice conversation">
            <div className="section-heading compact">
              <p className="eyebrow">Voice</p>
              <h2>Record a private conversation</h2>
            </div>
            <div className="voice-recorder">
              <div className="recording-meter" aria-live="polite">
                <strong>{formatRecordingState(recordingState)}</strong>
                <span>{formatDuration(recordingSeconds)}</span>
              </div>
              <div className="voice-actions">
                {recordingState === 'recording' ? (
                  <button className="secondary-action" type="button" onClick={handleStopRecording}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={handleStartRecording}
                    disabled={!canStartRecording}
                  >
                    Record
                  </button>
                )}
                <button
                  className="primary-action"
                  type="button"
                  onClick={handleSaveRecording}
                  disabled={!canSaveRecording}
                >
                  {recordingState === 'saving' ? 'Encrypting...' : 'Save conversation'}
                </button>
                <button
                  className="text-action"
                  type="button"
                  onClick={discardRecording}
                  disabled={recordingState === 'recording' || recordingState === 'saving'}
                >
                  Clear recording
                </button>
              </div>
              {recordingPreviewUrl ? (
                <audio className="voice-preview" src={recordingPreviewUrl} controls />
              ) : null}
            </div>
          </section>

          <section className="inline-source-panel" aria-label="GitHub import">
            <div className="section-heading compact">
              <p className="eyebrow">GitHub</p>
              <h2>Import public repository context</h2>
            </div>
            <div className="inline-source-row">
              <label>
                <span>Repository URL</span>
                <input
                  value={githubRepoUrl}
                  onChange={(event) => setGithubRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo"
                  autoComplete="off"
                />
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={handleGitHubImport}
                disabled={!canImportGitHub}
              >
                {isImportingGitHub ? 'Importing...' : 'Import'}
              </button>
            </div>
          </section>

          <label className="file-upload">
            <span>File upload</span>
            <input
              type="file"
              accept=".txt,.md,.markdown,.json,.csv,.html,text/plain,text/markdown,text/x-markdown,text/csv,application/json,text/html,application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,audio/mpeg,audio/mp4,audio/wav,audio/webm,.mp3,.m4a,.wav,.webm"
              onChange={handleFileSelected}
            />
          </label>

          {uploadMetadata ? (
            <div className="upload-summary">
              <strong>{uploadMetadata.fileName}</strong>
              <span>{sourceType} · {uploadMetadata.fileSize} bytes</span>
            </div>
          ) : null}

          <div className={`upload-progress ${uploadPhase}`} aria-live="polite">
            <div>
              <strong>{formatUploadPhase(uploadPhase)}</strong>
              <span>{uploadPhaseDetail}</span>
            </div>
            {uploadPhase === 'reading_file' ||
            uploadPhase === 'extracting_pdf' ||
            uploadPhase === 'encoding_binary' ||
            uploadPhase === 'encrypting_uploading' ||
            uploadPhase === 'processing' ? (
              <progress aria-label="Upload progress" />
            ) : null}
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
              value={isOpaqueUploadSource(sourceType) ? opaqueUploadPreview(sourceType, content, uploadMetadata) : content}
              onChange={(event) => handleContentChanged(event.target.value)}
              placeholder="Write the raw memory text here."
              readOnly={isOpaqueUploadSource(sourceType)}
              rows={11}
            />
          </label>

          <div className="form-footer">
            <p>{formatReadyState(sourceType, content, uploadMetadata)}</p>
            <button className="primary-action" type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Encrypting...' : 'Save private memory'}
            </button>
          </div>
        </form>

        <aside className="inspector" aria-live="polite">
          <StorageHealthPanel health={storageHealth} error={storageHealthError} />
          <NoticePanel notice={notice} />
          {receipt ? (
            <ReceiptPanel
              receipt={receipt}
              canRetry={isSessionForWallet && receipt.status === 'failed' && !isRetryingArtifact}
              isRetrying={isRetryingArtifact}
              onRetry={handleRetryArtifact}
            />
          ) : (
            <EmptyReceipt />
          )}
        </aside>
      </section>
      )}
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

function ReceiptPanel({
  receipt,
  canRetry,
  isRetrying,
  onRetry,
}: {
  receipt: ArtifactReceipt
  canRetry: boolean
  isRetrying: boolean
  onRetry: () => void
}) {
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
        {receipt.intelligenceStatus ? (
          <div>
            <dt>Twin learning</dt>
            <dd>{formatIntelligenceStatus(receipt.intelligenceStatus)}</dd>
          </div>
        ) : null}
        {receipt.warning ? (
          <div>
            <dt>Warning</dt>
            <dd>{receipt.warning}</dd>
          </div>
        ) : null}
      </dl>
      {receipt.status === 'failed' ? (
        <button className="secondary-action" type="button" onClick={onRetry} disabled={!canRetry}>
          {isRetrying ? 'Retrying...' : 'Retry processing'}
        </button>
      ) : null}
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

function formatIntelligenceStatus(status: NonNullable<ArtifactReceipt['intelligenceStatus']>) {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'processing':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Needs attention'
    case 'skipped':
      return 'Skipped'
  }
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

async function putJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
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

async function buildClientEncryptedArtifactBody(input: {
  sourceType: SourceType
  title: string | null
  content: string
  metadata: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const config = readClientEncryptionConfig()
  const keyServers = parseClientSealKeyServers(config.sealKeyServers)

  if (
    !config.sealPackageId ||
    !config.sealPolicyId ||
    keyServers.length === 0 ||
    !Number.isInteger(config.sealThreshold) ||
    config.sealThreshold < 1 ||
    config.sealThreshold > keyServers.length
  ) {
    throw new Error('Client encryption is not configured. Set VITE_SEAL_PACKAGE_ID, VITE_SEAL_POLICY_ID, and VITE_SEAL_KEY_SERVERS.')
  }

  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: 'source_artifact',
      version: 1,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
    }),
  )
  const aad = new TextEncoder().encode(
    JSON.stringify({
      sourceType: input.sourceType,
      kind: 'source_artifact',
      version: 1,
      encryptionBoundary: 'client',
    }),
  )
  const suiClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  })
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: keyServers,
  })
  const { encryptedObject } = await sealClient.encrypt({
    threshold: config.sealThreshold,
    packageId: config.sealPackageId,
    id: config.sealPolicyId,
    data: payloadBytes,
    aad,
  })

  return {
    sourceType: input.sourceType,
    encryptedPayload: {
      ciphertextBase64: bytesToBase64(encryptedObject),
      ciphertextSha256: await sha256Hex(encryptedObject),
      seal: {
        packageId: config.sealPackageId,
        policyId: config.sealPolicyId,
        threshold: config.sealThreshold,
        keyServerObjectIds: keyServers.map((server) => server.objectId),
      },
    },
  }
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

async function putAuthedJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await putJson<TResponse>(path, body, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)

    return putJson<TResponse>(path, body, refreshed.token)
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

async function getAuthedJson<TResponse>(
  path: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await getJsonAuthed<TResponse>(path, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)

    return getJsonAuthed<TResponse>(path, refreshed.token)
  }
}

async function getJsonAuthed<TResponse>(path: string, token: string): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

async function streamArtifactStatus(
  twinId: string,
  artifactId: string,
  token: string,
  signal: AbortSignal,
  onEvent: (event: ArtifactStatusEvent) => void,
) {
  const response = await fetch(`${API_URL}/v1/twins/${twinId}/artifacts/${artifactId}/events`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(response.status, payload))
  }

  if (!response.body) {
    throw new Error('Artifact status stream is not readable.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!signal.aborted) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const messages = buffer.split('\n\n')
    buffer = messages.pop() ?? ''

    for (const message of messages) {
      const event = parseArtifactStatusSse(message)

      if (event) {
        onEvent(event)

        if (isArtifactStatusStreamTerminal(event)) {
          await reader.cancel()
          return
        }
      }
    }
  }
}

async function streamArtifactStatusAuthed(
  twinId: string,
  artifactId: string,
  session: Session,
  signal: AbortSignal,
  onSessionRefreshed: (session: Session) => void,
  onEvent: (event: ArtifactStatusEvent) => void,
) {
  try {
    await streamArtifactStatus(twinId, artifactId, session.token, signal, onEvent)
  } catch (error) {
    if (!isAuthError(error) || signal.aborted) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)

    await streamArtifactStatus(twinId, artifactId, refreshed.token, signal, onEvent)
  }
}

function parseArtifactStatusSse(message: string): ArtifactStatusEvent | null {
  const data = message
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')

  if (!data) {
    return null
  }

  try {
    const parsed = JSON.parse(data) as Partial<ArtifactStatusEvent>

    if (
      typeof parsed.artifactId !== 'string' ||
      typeof parsed.twinId !== 'string' ||
      typeof parsed.sourceType !== 'string' ||
      typeof parsed.status !== 'string' ||
      typeof parsed.occurredAt !== 'string'
    ) {
      return null
    }

    return parsed as ArtifactStatusEvent
  } catch {
    return null
  }
}

function isArtifactStatusStreamTerminal(event: ArtifactStatusEvent) {
  if (event.status === 'failed' || event.status === 'cancelled') {
    return true
  }

  if (event.status !== 'completed') {
    return false
  }

  return (
    !event.intelligenceStatus ||
    event.intelligenceStatus === 'completed' ||
    event.intelligenceStatus === 'failed' ||
    event.intelligenceStatus === 'skipped'
  )
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

function parseCommaList(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
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

function isImage(file: File) {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('image/') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  )
}

function isAudio(file: File) {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('audio/') ||
    name.endsWith('.mp3') ||
    name.endsWith('.m4a') ||
    name.endsWith('.wav') ||
    name.endsWith('.webm')
  )
}

function isBrowserHistoryFile(file: File) {
  const name = file.name.toLowerCase()
  const hasHistoryName =
    name.includes('history') ||
    name.includes('browser') ||
    name.includes('chrome') ||
    name.includes('firefox') ||
    name.includes('safari') ||
    name.includes('edge')
  const hasHistoryExtension =
    name.endsWith('.json') ||
    name.endsWith('.csv') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
    name.endsWith('.txt')

  return hasHistoryName && hasHistoryExtension
}

function isMarkdown(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || file.type.includes('markdown')
}

function isTextLikeFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    name.endsWith('.txt') ||
    name.endsWith('.json') ||
    name.endsWith('.csv') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
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

async function fileToBase64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

async function blobToBase64(blob: Blob): Promise<string> {
  return fileToBase64(blob)
}

function preferredRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }

  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }

  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    return 'audio/mp4'
  }

  return ''
}

function inferFileType(name: string) {
  const normalized = name.toLowerCase()

  if (normalized.endsWith('.pdf')) {
    return 'application/pdf'
  }

  if (normalized.endsWith('.png')) {
    return 'image/png'
  }

  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalized.endsWith('.mp3')) {
    return 'audio/mpeg'
  }

  if (normalized.endsWith('.m4a')) {
    return 'audio/mp4'
  }

  if (normalized.endsWith('.wav')) {
    return 'audio/wav'
  }

  if (normalized.endsWith('.webm')) {
    return 'audio/webm'
  }

  if (normalized.endsWith('.json')) {
    return 'application/json'
  }

  if (normalized.endsWith('.csv')) {
    return 'text/csv'
  }

  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'text/html'
  }

  return isMarkdown({ name, type: '' } as File) ? 'text/markdown' : 'text/plain'
}

function formatSourceType(value: SourceType) {
  if (value === 'pdf') {
    return 'PDF'
  }

  if (value === 'ocr_pdf') {
    return 'Scanned PDF'
  }

  if (value === 'image') {
    return 'Image'
  }

  if (value === 'voice_note') {
    return 'Voice note'
  }

  if (value === 'voice_conversation') {
    return 'Voice conversation'
  }

  if (value === 'browser_history') {
    return 'Browser history'
  }

  return value === 'markdown' ? 'Markdown' : 'Text'
}

function isOpaqueUploadSource(sourceType: SourceType) {
  return sourceType === 'ocr_pdf' || sourceType === 'image' || sourceType === 'voice_note' || sourceType === 'voice_conversation'
}

function opaqueUploadPreview(sourceType: SourceType, content: string, metadata: UploadMetadata | null) {
  const fileName = metadata?.fileName ?? (sourceType === 'image' ? 'Image' : sourceType === 'voice_note' ? 'Voice note' : sourceType === 'voice_conversation' ? 'Voice conversation' : 'PDF')
  const size = metadata?.fileSize ? `${metadata.fileSize} bytes` : `${content.length} base64 chars`

  if (sourceType === 'voice_note' || sourceType === 'voice_conversation') {
    const label = sourceType === 'voice_conversation' ? 'voice conversation' : 'voice note'
    return `${fileName} is ready for encrypted ${label} storage.\n\nSivraj will store the encrypted audio payload on Walrus. The worker will transcribe it before creating retrievable memory text when speech-to-text is configured.\n\nPayload: ${size}`
  }

  const label = sourceType === 'image' ? 'image' : 'PDF'

  return `${fileName} is ready for encrypted OCR processing.\n\nSivraj will store the encrypted ${label} payload on Walrus, then the worker will decrypt it and run OCR before creating retrievable memory text.\n\nPayload: ${size}`
}

function formatReadyState(
  sourceType: SourceType,
  content: string,
  metadata: UploadMetadata | null,
) {
  if (isOpaqueUploadSource(sourceType)) {
    const size = metadata?.fileSize ? `${metadata.fileSize} bytes` : `${content.length} base64 chars`
    const label = sourceType === 'image' ? 'image' : sourceType === 'voice_note' ? 'voice note' : sourceType === 'voice_conversation' ? 'voice conversation' : 'scanned PDF'

    return `${size} ${label} ready for encrypted ${sourceType === 'voice_note' || sourceType === 'voice_conversation' ? 'audio' : 'OCR'} upload`
  }

  return `${content.trim().length} chars ready for encrypted ${sourceType} upload`
}

function formatRecordingState(state: RecordingState) {
  if (state === 'requesting_permission') {
    return 'Requesting microphone'
  }

  if (state === 'recording') {
    return 'Recording'
  }

  if (state === 'recorded') {
    return 'Ready to save'
  }

  if (state === 'saving') {
    return 'Encrypting'
  }

  if (state === 'error') {
    return 'Recording unavailable'
  }

  return 'Idle'
}

function formatUploadPhase(phase: UploadPhase) {
  if (phase === 'reading_file') {
    return 'Reading file'
  }

  if (phase === 'extracting_pdf') {
    return 'Extracting PDF'
  }

  if (phase === 'encoding_binary') {
    return 'Encoding'
  }

  if (phase === 'ready') {
    return 'Ready'
  }

  if (phase === 'encrypting_uploading') {
    return 'Encrypting upload'
  }

  if (phase === 'queued') {
    return 'Queued'
  }

  if (phase === 'processing') {
    return 'Processing'
  }

  if (phase === 'pending') {
    return 'Pending'
  }

  if (phase === 'completed') {
    return 'Completed'
  }

  if (phase === 'failed') {
    return 'Needs attention'
  }

  return 'Idle'
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function readClientEncryptionConfig() {
  return {
    suiNetwork: readSuiNetwork(import.meta.env.VITE_SUI_NETWORK),
    suiRpcUrl: import.meta.env.VITE_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443',
    sealPackageId: import.meta.env.VITE_SEAL_PACKAGE_ID,
    sealPolicyId: import.meta.env.VITE_SEAL_POLICY_ID,
    sealKeyServers: import.meta.env.VITE_SEAL_KEY_SERVERS ?? '',
    sealThreshold: Number.parseInt(import.meta.env.VITE_SEAL_THRESHOLD ?? '1', 10),
  }
}

function parseClientSealKeyServers(value: string): KeyServerConfig[] {
  const trimmed = value.trim()

  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error('Client Seal key servers must be a JSON array or comma-separated object IDs.')
    }

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return { objectId: item, weight: 1 }
        }

        if (item && typeof item === 'object') {
          const objectId = (item as { objectId?: unknown }).objectId
          const weight = (item as { weight?: unknown }).weight

          if (typeof objectId === 'string') {
            return {
              objectId,
              weight: typeof weight === 'number' ? weight : 1,
            }
          }
        }

        throw new Error('Invalid client Seal key server config.')
      })
      .filter((server) => server.objectId.length > 0)
  }

  return trimmed
    .split(',')
    .map((objectId) => ({
      objectId: objectId.trim(),
      weight: 1,
    }))
    .filter((server) => server.objectId.length > 0)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }

  return btoa(binary)
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function readSuiNetwork(value: unknown): 'mainnet' | 'testnet' | 'devnet' | 'localnet' {
  return value === 'mainnet' || value === 'devnet' || value === 'localnet' ? value : 'testnet'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.'
}

function isAuthError(error: unknown) {
  return error instanceof Error && error.message.includes('API session is invalid or expired')
}

export default App
