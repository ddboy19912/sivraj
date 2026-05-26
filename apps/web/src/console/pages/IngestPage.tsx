import { useState } from 'react'
import {
  buildAiChatImportPreview,
  isLikelyAiChatExportFile,
  type AiChatImportPreview,
} from '../../lib/ai-chat-import'
import { API_URL, errorMessage, postAuthedJson } from '../../lib/api'
import { buildClientEncryptedArtifactBody, type SourceType } from '../../lib/encryption'
import { buildUploadMetadata, inferUploadSourceType } from '../../lib/upload-source-type'
import { useConsoleContext } from '../context'
import type { ArtifactReceipt } from '../types'

const SOURCE_TYPES: SourceType[] = ['note', 'markdown', 'upload', 'browser_history', 'chat_export']

export function IngestPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId, setJobId } = useConsoleContext()
  const [sourceType, setSourceType] = useState<SourceType>('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [uploadMetadata, setUploadMetadata] = useState<Record<string, unknown> | null>(null)
  const [aiChatPreview, setAiChatPreview] = useState<AiChatImportPreview | null>(null)
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
      const metadata = {
        ...(uploadMetadata ?? {}),
        ...(sourceType === 'chat_export' && aiChatPreview
          ? {
              aiChatProvider: aiChatPreview.provider,
              aiChatImportKind: 'export',
              aiChatImportFingerprint: aiChatPreview.fingerprint,
              aiChatConversationCount: aiChatPreview.conversations.length,
              aiChatMessageCount: aiChatPreview.messageCount,
            }
          : {}),
      }
      const encryptedBody = await buildClientEncryptedArtifactBody({
        sourceType,
        title: title.trim() || null,
        content: content.trim(),
        metadata,
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
      setStatus(result.skipped ? 'Import skipped because this AI chat export was already imported.' : 'Artifact uploaded and queued.')
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
    const nextAiChatPreview = await buildAiChatImportPreview(text)
    const nextSourceType = sourceType === 'browser_history'
      ? sourceType
      : nextAiChatPreview && isLikelyAiChatExportFile(file, text)
        ? 'chat_export'
        : inferUploadSourceType(file)
    const nextMetadata = buildUploadMetadata(file, nextSourceType)

    setSourceType(nextSourceType)
    setContent(text)
    setUploadMetadata(nextMetadata)
    setAiChatPreview(nextSourceType === 'chat_export' ? nextAiChatPreview : null)
    setStatus(`${file.name} loaded as ${nextSourceType} (${text.length} chars).`)
  }

  async function handleSourceTypeSelected(value: SourceType) {
    setSourceType(value)

    if (value === 'chat_export' && content.trim()) {
      setAiChatPreview(await buildAiChatImportPreview(content))
      return
    }

    setAiChatPreview(null)
  }

  async function handleContentChanged(value: string) {
    setContent(value)

    if (sourceType === 'chat_export') {
      setAiChatPreview(await buildAiChatImportPreview(value))
    }
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
          <select value={sourceType} onChange={(event) => void handleSourceTypeSelected(event.target.value as SourceType)}>
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
          <textarea value={content} onChange={(event) => void handleContentChanged(event.target.value)} rows={8} />
        </label>

        <label>
          <span>Text/Markdown/Browser history/AI chat file</span>
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

      {sourceType === 'chat_export' ? (
        <AiChatImportReview preview={aiChatPreview} receipt={receipt} />
      ) : null}

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
            <dt>Import result</dt>
            <dd>{receipt.skipped ? `Skipped: ${receipt.reason ?? 'duplicate'}` : 'Imported'}</dd>
            <dt>Warning</dt>
            <dd>{receipt.warning ?? '—'}</dd>
          </dl>
        </div>
      ) : null}

      <p className="console-footnote">
        This page supports manual notes, text/Markdown files, browser history exports, and AI chat exports. Use Manual Memory
        for PDF, voice note, and voice conversation flows. API endpoint:{' '}
        <code>{API_URL}/v1/twins/:twinId/artifacts</code>
      </p>
    </section>
  )
}

function AiChatImportReview({
  preview,
  receipt,
}: {
  preview: AiChatImportPreview | null
  receipt: ArtifactReceipt | null
}) {
  if (!preview) {
    return (
      <div className="console-panel">
        <h3>AI chat import review</h3>
        <p className="console-status">No conversations detected yet.</p>
      </div>
    )
  }

  return (
    <div className="console-panel">
      <div className="console-panel-header">
        <h3>AI chat import review</h3>
        {receipt ? (
          <span className={receipt.skipped ? 'console-chip warn' : 'console-chip'}>
            {receipt.skipped ? 'Skipped' : 'Imported'}
          </span>
        ) : null}
      </div>
      <dl className="console-mini-dl">
        <dt>Provider</dt>
        <dd>{preview.provider}</dd>
        <dt>Conversations</dt>
        <dd>{preview.conversations.length}</dd>
        <dt>Messages</dt>
        <dd>{preview.messageCount}</dd>
      </dl>
      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>Conversation</th>
              <th>Messages</th>
              <th>First</th>
              <th>Last</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.conversations.map((conversation, index) => (
              <tr key={conversation.sourceConversationId ?? `${conversation.title ?? 'conversation'}-${index}`}>
                <td>{conversation.title ?? conversation.sourceConversationId ?? 'Untitled conversation'}</td>
                <td>{conversation.messageCount}</td>
                <td>{conversation.firstMessageAt ?? '—'}</td>
                <td>{conversation.lastMessageAt ?? '—'}</td>
                <td>{receipt ? (receipt.skipped ? 'Skipped' : 'Imported') : 'Ready'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
