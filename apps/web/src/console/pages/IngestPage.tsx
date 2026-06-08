import { API_URL } from '@/lib/api'
import { AiChatImportReview } from '@/console/pages/ingest/AiChatImportReview'
import { IngestForm } from '@/console/pages/ingest/IngestForm'
import { IngestReceiptPanel } from '@/console/pages/ingest/IngestReceiptPanel'
import { useIngestPage } from '@/console/pages/ingest/use-ingest-page'

export function IngestPage() {
  const ingest = useIngestPage()

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Ingestion test</h2>
      </div>

      {!ingest.isSessionForWallet ? (
        <p className="console-banner warn">
          Connect wallet and sign in to test ingestion.
        </p>
      ) : null}

      <IngestForm
        sourceType={ingest.sourceType}
        title={ingest.title}
        content={ingest.content}
        isSessionForWallet={ingest.isSessionForWallet}
        isSubmitting={ingest.isSubmitting}
        onSourceTypeSelected={ingest.handleSourceTypeSelected}
        onTitleChange={ingest.setTitle}
        onContentChanged={ingest.handleContentChanged}
        onFileSelected={ingest.handleFileSelected}
        onSubmit={ingest.handleSubmit}
      />

      {ingest.sourceType === 'chat_export' ? (
        <AiChatImportReview preview={ingest.aiChatPreview} receipt={ingest.receipt} />
      ) : null}

      {ingest.status ? <p className="console-status">{ingest.status}</p> : null}
      {ingest.receipt ? <IngestReceiptPanel receipt={ingest.receipt} /> : null}

      <p className="console-footnote">
        This page supports manual notes, text/Markdown files, browser history exports, and AI chat exports. Use Manual Memory
        for PDF, voice note, and voice conversation flows. API endpoint:{' '}
        <code>{API_URL}/v1/twins/:twinId/artifacts</code>
      </p>
    </section>
  )
}
