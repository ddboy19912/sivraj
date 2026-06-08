export function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    return null
  }
}
