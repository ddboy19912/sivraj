import type { SourceType } from '@/lib/encryption'

const BROWSER_HISTORY_KEYWORDS = ['history', 'browser', 'chrome', 'firefox', 'safari', 'edge'] as const
const BROWSER_HISTORY_EXTENSIONS = ['.json', '.csv', '.html', '.htm', '.txt'] as const

function isBrowserHistoryFile(file: File) {
  const name = file.name.toLowerCase()

  return BROWSER_HISTORY_KEYWORDS.some((keyword) => name.includes(keyword)) &&
    BROWSER_HISTORY_EXTENSIONS.some((extension) => name.endsWith(extension))
}

function isMarkdownFile(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || file.type.includes('markdown')
}

export function inferUploadSourceType(file: File): SourceType {
  if (isMarkdownFile(file)) {
    return 'markdown'
  }

  if (isBrowserHistoryFile(file)) {
    return 'browser_history'
  }

  return 'upload'
}

export function buildUploadMetadata(file: File, sourceType: SourceType) {
  return {
    fileName: file.name,
    fileType: file.type || inferFileType(file.name),
    fileSize: file.size,
    uploadKind: 'file' as const,
    ...(sourceType === 'browser_history'
      ? { importer: 'browser_history_export' as const }
      : sourceType === 'chat_export'
        ? { importer: 'ai_chat_export' as const }
      : {}),
  }
}

function inferFileType(name: string) {
  const normalized = name.toLowerCase()

  if (normalized.endsWith('.json')) {
    return 'application/json'
  }

  if (normalized.endsWith('.csv')) {
    return 'text/csv'
  }

  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'text/html'
  }

  return isMarkdownFile({ name, type: '' } as File) ? 'text/markdown' : 'text/plain'
}
