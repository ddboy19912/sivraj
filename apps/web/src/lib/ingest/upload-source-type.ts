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

function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
}

function isImageFile(file: File) {
  return file.type.startsWith('image/')
}

export function inferUploadSourceType(file: File): SourceType {
  if (isPdfFile(file)) {
    return 'pdf'
  }

  if (isImageFile(file)) {
    return 'image'
  }

  if (isMarkdownFile(file)) {
    return 'markdown'
  }

  if (isBrowserHistoryFile(file)) {
    return 'browser_history'
  }

  return 'upload'
}
