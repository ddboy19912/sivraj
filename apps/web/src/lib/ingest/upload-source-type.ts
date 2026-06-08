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
