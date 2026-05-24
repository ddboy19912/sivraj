import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { ReflectionRun } from '../types'

export function ReflectionsPage() {
  const { session, isSessionForWallet, onSessionRefreshed, selectedReflectionId, setSelectedReflectionId } =
    useConsoleContext()
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [runs, setRuns] = useState<ReflectionRun[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  async function loadRuns() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const response = await getAuthedJson<{ reflections: ReflectionRun[] }>(
        `/v1/twins/${session.twinId}/reflections`,
        session,
        onSessionRefreshed,
      )
      setRuns(response.reflections)
      setStatus(`${response.reflections.length} reflection run(s).`)
    } catch (error) {
      setRuns([])
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadRuns()
    }
  }, [isSessionForWallet, session?.twinId])

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault()

    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsGenerating(true)

    try {
      const body: Record<string, unknown> = {}

      if (periodStart) {
        body.periodStart = new Date(periodStart).toISOString()
      }

      if (periodEnd) {
        body.periodEnd = new Date(periodEnd).toISOString()
      }

      const response = await postAuthedJson<{
        reflectionRunId: string
        status: string
        jobId?: string
      }>(
        `/v1/twins/${session.twinId}/reflections/weekly`,
        body,
        session,
        onSessionRefreshed,
      )
      setSelectedReflectionId(response.reflectionRunId)
      setStatus(`Weekly reflection queued (${response.reflectionRunId}).`)
      await loadRuns()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Weekly reflection test</h2>
      </div>

      <form className="console-form inline" onSubmit={handleGenerate}>
        <label>
          <span>Period start</span>
          <input type="datetime-local" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        </label>
        <label>
          <span>Period end</span>
          <input type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
        </label>
        <div className="console-actions">
          <button className="primary-action" type="submit" disabled={!isSessionForWallet || isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate weekly reflection'}
          </button>
          <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadRuns()}>
            Refresh list
          </button>
        </div>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Period</th>
              <th>Storage ref</th>
              <th>Hash</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className={run.id === selectedReflectionId ? 'selected' : undefined}>
                <td>
                  <button className="text-action" type="button" onClick={() => setSelectedReflectionId(run.id)}>
                    {run.id.slice(0, 8)}…
                  </button>
                </td>
                <td>{run.status}</td>
                <td>
                  {run.periodStart} → {run.periodEnd}
                </td>
                <td>{run.summaryStorageRef ?? '—'}</td>
                <td>{run.summarySha256 ?? '—'}</td>
                <td>
                  <code>{JSON.stringify(run.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
