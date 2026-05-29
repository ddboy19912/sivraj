import { useEffect, useRef, useState } from 'react'
import type { Session } from '../lib/api'
import { errorMessage, getAuthedJson, postAuthedAudio, postAuthedJson } from '../lib/api'
import './VoiceSettingsPage.css'

type VoicePreset = {
  id: string
  name: string
  description: string
  language: string
  style: string
}

type VoicePresetsResponse = {
  defaultVoiceId: string
  presets: VoicePreset[]
}

type VoiceProfile = {
  twinId: string
  mode: 'preset' | 'clone'
  presetVoiceId: string
  provider: string
  referenceArtifactId: string | null
  consentAt: string | null
}

type VoiceSettingsPageProps = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
}

type VoiceNotice = {
  tone: 'info' | 'success' | 'error'
  message: string
}

type RecorderState = 'idle' | 'requesting' | 'recording' | 'recorded' | 'saving'

const SAMPLE_LINE = 'Hello. I am Sivraj, your private AI Twin. I can speak with this voice while keeping your memory under your control.'

export function VoiceSettingsPage({
  session,
  isSessionForWallet,
  onSessionRefreshed,
}: VoiceSettingsPageProps) {
  const [presets, setPresets] = useState<VoicePreset[]>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [profile, setProfile] = useState<VoiceProfile | null>(null)
  const [notice, setNotice] = useState<VoiceNotice>({
    tone: 'info',
    message: 'Choose a preset voice or create a private voice clone.',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isSavingPreset, setIsSavingPreset] = useState(false)
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null)
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null)
  const [cloneConsent, setCloneConsent] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!session || !isSessionForWallet) {
      return
    }

    let cancelled = false
    setIsLoading(true)
    Promise.all([
      getAuthedJson<VoicePresetsResponse>(
        `/v1/twins/${session.twinId}/voice/presets`,
        session,
        onSessionRefreshed,
      ),
      getAuthedJson<VoiceProfile>(
        `/v1/twins/${session.twinId}/voice/profile`,
        session,
        onSessionRefreshed,
      ),
    ])
      .then(([presetResponse, profileResponse]) => {
        if (cancelled) {
          return
        }

        setPresets(presetResponse.presets)
        setProfile(profileResponse)
        setSelectedVoiceId(profileResponse.presetVoiceId || presetResponse.defaultVoiceId)
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({ tone: 'error', message: errorMessage(error) })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [session?.twinId, session?.token, isSessionForWallet])

  useEffect(() => {
    return () => {
      stopRecordingTimer()
      stopRecordingStream()
      revokeAudioUrl()
      if (recordingPreviewUrl) {
        URL.revokeObjectURL(recordingPreviewUrl)
      }
    }
  }, [recordingPreviewUrl])

  async function handleSavePreset() {
    if (!session || !isSessionForWallet || !selectedVoiceId) {
      setNotice({ tone: 'error', message: 'Sign in before saving a voice.' })
      return
    }

    setIsSavingPreset(true)
    try {
      const saved = await postAuthedJson<VoiceProfile>(
        `/v1/twins/${session.twinId}/voice/profile`,
        {
          mode: 'preset',
          presetVoiceId: selectedVoiceId,
        },
        session,
        onSessionRefreshed,
      )
      setProfile(saved)
      setNotice({ tone: 'success', message: 'Voice preset saved.' })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setIsSavingPreset(false)
    }
  }

  async function handlePreview(voiceId: string) {
    if (!session || !isSessionForWallet) {
      setNotice({ tone: 'error', message: 'Sign in before previewing voice.' })
      return
    }

    setPreviewingVoiceId(voiceId)
    try {
      const blob = await postAuthedAudio(
        `/v1/twins/${session.twinId}/voice/speak`,
        {
          text: SAMPLE_LINE,
          voiceId,
        },
        session,
        onSessionRefreshed,
      )
      playBlob(blob)
      setNotice({ tone: 'success', message: 'Playing voice preview.' })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setPreviewingVoiceId(null)
    }
  }

  async function handleStartRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice({ tone: 'error', message: 'This browser does not support voice recording.' })
      return
    }

    clearRecording()
    setRecorderState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recordingStartedAtRef.current = Date.now()

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      })
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        stopRecordingTimer()
        stopRecordingStream()
        setRecordedBlob(blob)
        setRecordingPreviewUrl(url)
        setRecorderState('recorded')
      })

      recorder.start()
      setRecorderState('recording')
      recordingTimerRef.current = window.setInterval(() => {
        const startedAt = recordingStartedAtRef.current
        setRecordingSeconds(startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0)
      }, 250)
    } catch (error) {
      stopRecordingTimer()
      stopRecordingStream()
      setRecorderState('idle')
      setNotice({ tone: 'error', message: errorMessage(error) })
    }
  }

  function handleStopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  async function handleSaveClone() {
    if (!session || !isSessionForWallet || !recordedBlob) {
      setNotice({ tone: 'error', message: 'Record a voice sample before saving.' })
      return
    }

    if (!cloneConsent) {
      setNotice({ tone: 'error', message: 'Confirm consent before creating a cloned voice.' })
      return
    }

    setRecorderState('saving')
    try {
      const audioBase64 = await blobToBase64(recordedBlob)
      const saved = await postAuthedJson<VoiceProfile>(
        `/v1/twins/${session.twinId}/voice/profile`,
        {
          mode: 'clone',
          consent: true,
          audioBase64,
          mimeType: recordedBlob.type || 'audio/webm',
          fileName: `voice-profile-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
        },
        session,
        onSessionRefreshed,
      )
      setProfile(saved)
      setSelectedVoiceId(saved.presetVoiceId)
      setNotice({ tone: 'success', message: 'Private voice clone saved.' })
      clearRecording()
      setCloneConsent(false)
    } catch (error) {
      setRecorderState('recorded')
      setNotice({ tone: 'error', message: errorMessage(error) })
    }
  }

  function playBlob(blob: Blob) {
    revokeAudioUrl()
    const url = URL.createObjectURL(blob)
    audioUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    void audio.play()
  }

  function revokeAudioUrl() {
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }

  function clearRecording() {
    stopRecordingTimer()
    stopRecordingStream()
    chunksRef.current = []
    recorderRef.current = null
    recordingStartedAtRef.current = null
    setRecordingSeconds(0)
    setRecordedBlob(null)
    setRecorderState('idle')
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
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
  }

  return (
    <section className="voice-settings">
      <div className="voice-heading">
        <div>
          <p className="eyebrow">Assistant voice</p>
          <h2>Choose how Sivraj speaks</h2>
        </div>
        <span>{profile?.mode === 'clone' ? 'Cloned voice active' : 'Preset voice active'}</span>
      </div>

      {!isSessionForWallet ? (
        <section className="voice-panel">
          <h3>Sign in required</h3>
          <p>Connect and verify your wallet before configuring the assistant voice.</p>
        </section>
      ) : null}

      <section className="voice-panel">
        <div className="voice-panel-heading">
          <h3>Preset voices</h3>
          <button
            className="primary-action"
            type="button"
            onClick={handleSavePreset}
            disabled={!isSessionForWallet || !selectedVoiceId || isSavingPreset}
          >
            {isSavingPreset ? 'Saving...' : 'Save preset'}
          </button>
        </div>
        {isLoading ? <p>Loading voices...</p> : null}
        <div className="voice-preset-grid">
          {presets.map((preset) => (
            <label
              key={preset.id}
              className={preset.id === selectedVoiceId ? 'voice-preset selected' : 'voice-preset'}
            >
              <input
                type="radio"
                name="voicePreset"
                checked={preset.id === selectedVoiceId}
                onChange={() => setSelectedVoiceId(preset.id)}
              />
              <span>
                <strong>{preset.name}</strong>
                <small>{preset.description}</small>
              </span>
              <button
                className="secondary-action"
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  void handlePreview(preset.id)
                }}
                disabled={!isSessionForWallet || previewingVoiceId === preset.id}
              >
                {previewingVoiceId === preset.id ? 'Playing...' : 'Preview'}
              </button>
            </label>
          ))}
        </div>
      </section>

      <section className="voice-panel">
        <div className="voice-panel-heading">
          <h3>Clone my voice</h3>
          <span>{formatDuration(recordingSeconds)}</span>
        </div>
        <div className="voice-recorder-actions">
          {recorderState === 'recording' ? (
            <button className="secondary-action" type="button" onClick={handleStopRecording}>
              Stop
            </button>
          ) : (
            <button
              className="secondary-action"
              type="button"
              onClick={handleStartRecording}
              disabled={!isSessionForWallet || recorderState === 'requesting' || recorderState === 'saving'}
            >
              {recorderState === 'requesting' ? 'Requesting...' : 'Record sample'}
            </button>
          )}
          <button
            className="text-action"
            type="button"
            onClick={clearRecording}
            disabled={recorderState === 'recording' || recorderState === 'saving'}
          >
            Clear
          </button>
        </div>
        {recordingPreviewUrl ? (
          <audio className="voice-preview-player" src={recordingPreviewUrl} controls />
        ) : null}
        <label className="voice-consent">
          <input
            type="checkbox"
            checked={cloneConsent}
            onChange={(event) => setCloneConsent(event.target.checked)}
          />
          <span>I am recording my own voice and consent to Sivraj using it for my private assistant voice.</span>
        </label>
        <button
          className="primary-action"
          type="button"
          onClick={handleSaveClone}
          disabled={!isSessionForWallet || !recordedBlob || !cloneConsent || recorderState === 'saving'}
        >
          {recorderState === 'saving' ? 'Saving...' : 'Save cloned voice'}
        </button>
      </section>

      <section className={`voice-notice ${notice.tone}`} aria-live="polite">
        {notice.message}
      </section>
    </section>
  )
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.split(',')[1] ?? '')
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read audio.')))
    reader.readAsDataURL(blob)
  })
}

