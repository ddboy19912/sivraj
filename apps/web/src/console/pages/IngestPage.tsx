import { useState } from 'react'
import { API_URL, errorMessage, postAuthedJson } from '../../lib/api'
import { buildClientEncryptedArtifactBody, type SourceType } from '../../lib/encryption'
import { buildUploadMetadata, inferUploadSourceType } from '../../lib/upload-source-type'
import { useConsoleContext } from '../context'
import type { ArtifactReceipt } from '../types'

const SOURCE_TYPES: SourceType[] = ['note', 'markdown', 'upload', 'browser_history']

export function IngestPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId, setJobId } = useConsoleContext()
  const [sourceType, setSourceType] = useState<SourceType>('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [uploadMetadata, setUploadMetadata] = useState<Record<string, unknown> | null>(null)
  const [receipt, setReceipt] = useState<ArtifactReceipt | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!session || !isSessionForWallet) {
      setStatus('Sign in with the connected wallet before testing ingestion.')
      return
    }

    if (!content.trim()) {
      setStatus('Content is required.')
      return
    }

    setIsSubmitting(true)
    setStatus('Encrypting and uploading artifact...')

    try {
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
        onSessionRefreshed,
      )

      setReceipt(result)
      setArtifactId(result.artifactId)
      setJobId(result.processingJobId ?? '')
      setStatus('Artifact uploaded and queued.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const text = await file.text()
    const nextSourceType = sourceType === 'browser_history' ? sourceType : inferUploadSourceType(file)
    const nextMetadata = buildUploadMetadata(file, nextSourceType)

    setSourceType(nextSourceType)
    setContent(text)
    setUploadMetadata(nextMetadata)
    setStatus(`${file.name} loaded as ${nextSourceType} (${text.length} chars).`)
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Ingestion test</h2>
      </div>

      {!isSessionForWallet ? (
        <p className="console-banner warn">Connect wallet and sign in to test ingestion.</p>
      ) : null}

      <form className="console-form" onSubmit={handleSubmit}>
        <label>
          <span>Source type</span>
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}>
            {SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Title (optional)</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          <span>Content</span>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} />
        </label>

        <label>
          <span>Text/Markdown/Browser history file</span>
          <input
            type="file"
            accept=".txt,.md,.markdown,.json,.csv,.html,.htm"
            onChange={handleFileSelected}
          />
        </label>

        <div className="console-actions">
          <button className="primary-action" type="submit" disabled={!isSessionForWallet || isSubmitting}>
            {isSubmitting ? 'Uploading...' : 'Submit encrypted artifact'}
          </button>
        </div>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {receipt ? (
        <div className="console-receipt">
          <h3>Receipt</h3>
          <dl>
            <dt>Artifact ID</dt>
            <dd>{receipt.artifactId}</dd>
            <dt>Storage mode</dt>
            <dd>{receipt.storageMode}</dd>
            <dt>Raw storage ref</dt>
            <dd>{receipt.rawStorageRef ?? '—'}</dd>
            <dt>Processing job ID</dt>
            <dd>{receipt.processingJobId ?? '—'}</dd>
            <dt>Status</dt>
            <dd>{receipt.status}</dd>
            <dt>Warning</dt>
            <dd>{receipt.warning ?? '—'}</dd>
          </dl>
        </div>
      ) : null}

      <p className="console-footnote">
        This page supports manual notes, text/Markdown files, and browser history exports. Use Manual Memory
        for PDF, voice note, and voice conversation flows. API endpoint:{' '}
        <code>{API_URL}/v1/twins/:twinId/artifacts</code>
      </p>
    </section>
  )
}
