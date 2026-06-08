import type { SourceType } from '@/lib/encryption'

const SOURCE_TYPES: SourceType[] = [
  'note',
  'markdown',
  'upload',
  'browser_history',
  'chat_export',
]

type IngestFormProps = {
  sourceType: SourceType
  title: string
  content: string
  isSessionForWallet: boolean
  isSubmitting: boolean
  onSourceTypeSelected: (value: SourceType) => void
  onTitleChange: (value: string) => void
  onContentChanged: (value: string) => void
  onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSubmit: (event: React.FormEvent) => void
}

export function IngestForm({
  sourceType,
  title,
  content,
  isSessionForWallet,
  isSubmitting,
  onSourceTypeSelected,
  onTitleChange,
  onContentChanged,
  onFileSelected,
  onSubmit,
}: IngestFormProps) {
  return (
    <form className="console-form" onSubmit={onSubmit}>
      <label>
        <span>Source type</span>
        <select
          value={sourceType}
          onChange={(event) => void onSourceTypeSelected(event.target.value as SourceType)}
        >
          {SOURCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Title (optional)</span>
        <input value={title} onChange={(event) => onTitleChange(event.target.value)} />
      </label>

      <label>
        <span>Content</span>
        <textarea
          value={content}
          onChange={(event) => void onContentChanged(event.target.value)}
          rows={8}
        />
      </label>

      <label>
        <span>Text/Markdown/Browser history/AI chat file</span>
        <input
          type="file"
          accept=".txt,.md,.markdown,.json,.csv,.html,.htm"
          onChange={onFileSelected}
        />
      </label>

      <div className="console-actions">
        <button
          className="primary-action"
          type="submit"
          disabled={!isSessionForWallet || isSubmitting}
        >
          {isSubmitting ? 'Uploading...' : 'Submit encrypted artifact'}
        </button>
      </div>
    </form>
  )
}
