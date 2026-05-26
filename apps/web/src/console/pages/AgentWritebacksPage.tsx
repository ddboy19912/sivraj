import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson, postJson } from '../../lib/api'
import { buildClientEncryptedAgentWritebackBody } from '../../lib/encryption'
import { useConsoleContext } from '../context'
import type { AgentWritebackRow, AgentWritebacksResponse } from '../types'

export function AgentWritebacksPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId, setJobId } = useConsoleContext()
  const [rows, setRows] = useState<AgentWritebackRow[]>([])
  const [statusFilter, setStatusFilter] = useState('pending')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentToken, setAgentToken] = useState('')
  const [agentName, setAgentName] = useState('Codex')
  const [repo, setRepo] = useState('sivraj')
  const [branch, setBranch] = useState('main')
  const [taskSummary, setTaskSummary] = useState('')
  const [filesTouched, setFilesTouched] = useState('')
  const [commandsRun, setCommandsRun] = useState('')
  const [testsRun, setTestsRun] = useState('')
  const [decisions, setDecisions] = useState('')
  const [bugsFound, setBugsFound] = useState('')
  const [followUps, setFollowUps] = useState('')
  const [userCorrections, setUserCorrections] = useState('')

  async function loadWritebacks() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
      const response = await getAuthedJson<AgentWritebacksResponse>(
        `/v1/twins/${session.twinId}/agents/writebacks${query}`,
        session,
        onSessionRefreshed,
      )
      setRows(response.writebacks)
      setStatus(`${response.writebacks.length} encrypted agent writeback(s).`)
    } catch (error) {
      setRows([])
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function approveWriteback(writebackId: string) {
    if (!session || !isSessionForWallet) {
      return
    }

    setIsSubmitting(true)

    try {
      const response = await postAuthedJson<{
        artifactId: string
        processingJobId: string | null
      }>(
        `/v1/twins/${session.twinId}/agents/writebacks/${writebackId}/approve`,
        {},
        session,
        onSessionRefreshed,
      )
      setArtifactId(response.artifactId)
      setJobId(response.processingJobId ?? '')
      setStatus(`Approved writeback ${writebackId}. Artifact ${response.artifactId} queued for ingestion.`)
      await loadWritebacks()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function rejectWriteback(writebackId: string) {
    if (!session || !isSessionForWallet) {
      return
    }

    setIsSubmitting(true)

    try {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/agents/writebacks/${writebackId}/reject`,
        {},
        session,
        onSessionRefreshed,
      )
      setStatus(`Rejected writeback ${writebackId}.`)
      await loadWritebacks()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function createEncryptedWriteback() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    const trimmedToken = agentToken.trim()
    if (!trimmedToken) {
      setStatus('Paste an agent token with agent:writeback:create.')
      return
    }

    if (!taskSummary.trim()) {
      setStatus('Task summary is required.')
      return
    }

    setIsSubmitting(true)

    try {
      const body = await buildClientEncryptedAgentWritebackBody({
        twinId: session.twinId,
        agentName: agentName.trim() || 'Coding Agent',
        repo: repo.trim(),
        branch: branch.trim(),
        taskSummary: taskSummary.trim(),
        filesTouched: lines(filesTouched),
        commandsRun: lines(commandsRun),
        testsRun: lines(testsRun),
        decisions: lines(decisions),
        bugsFound: lines(bugsFound),
        followUps: lines(followUps),
        userCorrections: lines(userCorrections),
      })
      const response = await postJson<{
        writebackId: string
        status: string
        rawStorageRef: string
      }>(
        `/v1/twins/${session.twinId}/agents/writebacks`,
        body,
        trimmedToken,
      )
      setStatus(`Created encrypted writeback ${response.writebackId}. Status ${response.status}.`)
      setTaskSummary('')
      await loadWritebacks()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadWritebacks()
    }
  }, [isSessionForWallet, session?.twinId, statusFilter])

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Agent writeback review</h2>
      </div>

      <div className="console-panel">
        <dl>
          <dt>Purpose</dt>
          <dd>Review encrypted coding-agent session summaries before they enter Sivraj ingestion.</dd>
          <dt>Privacy boundary</dt>
          <dd>The table shows hashes, counts, and storage refs. It does not decrypt or display the raw writeback body.</dd>
        </dl>
      </div>

      <form className="console-form wide" onSubmit={(event) => {
        event.preventDefault()
        void createEncryptedWriteback()
      }}>
        <h3>Create encrypted test writeback</h3>
        <p className="console-footnote">This encrypts in the browser, then sends ciphertext to the API using a scoped agent token.</p>
        <label>
          <span>Agent bearer token</span>
          <textarea value={agentToken} onChange={(event) => setAgentToken(event.target.value)} placeholder="Paste token with agent:writeback:create" />
        </label>
        <div className="console-form-grid">
          <label>
            <span>Agent</span>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          </label>
          <label>
            <span>Repo</span>
            <input value={repo} onChange={(event) => setRepo(event.target.value)} />
          </label>
          <label>
            <span>Branch</span>
            <input value={branch} onChange={(event) => setBranch(event.target.value)} />
          </label>
        </div>
        <label>
          <span>Task summary</span>
          <textarea value={taskSummary} onChange={(event) => setTaskSummary(event.target.value)} placeholder="What did the coding agent do?" />
        </label>
        <div className="console-form-grid">
          <label>
            <span>Files touched</span>
            <textarea value={filesTouched} onChange={(event) => setFilesTouched(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>Commands run</span>
            <textarea value={commandsRun} onChange={(event) => setCommandsRun(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>Tests run</span>
            <textarea value={testsRun} onChange={(event) => setTestsRun(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>Decisions</span>
            <textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>Bugs found</span>
            <textarea value={bugsFound} onChange={(event) => setBugsFound(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>Follow ups</span>
            <textarea value={followUps} onChange={(event) => setFollowUps(event.target.value)} placeholder="One per line" />
          </label>
          <label>
            <span>User corrections</span>
            <textarea value={userCorrections} onChange={(event) => setUserCorrections(event.target.value)} placeholder="One per line" />
          </label>
        </div>
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Encrypting...' : 'Create encrypted writeback'}
        </button>
      </form>

      <div className="console-actions">
        <label className="console-inline-label">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </label>
        <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadWritebacks()}>
          {isLoading ? 'Loading...' : 'Refresh writebacks'}
        </button>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Repo</th>
              <th>Counts</th>
              <th>Storage</th>
              <th>Approved artifact</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id.slice(0, 8)}…</td>
                <td>{row.agentName}</td>
                <td>{row.status}</td>
                <td>{row.repo ?? '—'} {row.branch ? `· ${row.branch}` : ''}</td>
                <td>
                  files {row.counts.filesTouched} · commands {row.counts.commandsRun} · tests {row.counts.testsRun} · decisions {row.counts.decisions}
                </td>
                <td>{row.rawStorageRef ? `${row.rawStorageRef.slice(0, 22)}…` : '—'}</td>
                <td>{row.approvedArtifactId ? `${row.approvedArtifactId.slice(0, 8)}…` : '—'}</td>
                <td className="console-row-actions">
                  <button
                    className="secondary-action compact"
                    type="button"
                    disabled={isSubmitting || row.status !== 'pending'}
                    onClick={() => void approveWriteback(row.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="secondary-action compact"
                    type="button"
                    disabled={isSubmitting || row.status !== 'pending'}
                    onClick={() => void rejectWriteback(row.id)}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
