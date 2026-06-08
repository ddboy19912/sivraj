import { describe, expect, it } from 'vitest'
import { inferUploadSourceType } from '@/lib/ingest/upload-source-type'

describe('inferUploadSourceType', () => {
  it('detects browser history exports', () => {
    expect(inferUploadSourceType({ name: 'chrome-history.json', type: '', size: 1 } as File))
      .toBe('browser_history')
    expect(inferUploadSourceType({ name: 'notes.txt', type: '', size: 1 } as File))
      .toBe('upload')
  })

  it('detects markdown uploads', () => {
    expect(inferUploadSourceType({ name: 'README.md', type: '', size: 1 } as File))
      .toBe('markdown')
  })
})
