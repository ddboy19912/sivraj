import type { SourceType } from './encryption'

export function isBrowserHistoryFile(file: File) {
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

export function isMarkdownFile(file: File) {
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
