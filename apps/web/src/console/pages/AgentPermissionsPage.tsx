import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { AgentClientsResponse, AgentClientRow } from '../types'

const DEFAULT_AGENT_SCOPES = [
  'agent:context:read',
  'agent:sources:read',
  'agent:project_profile:read',
  'agent:memory:search',
  'agent:writeback:create',
]

export function AgentPermissionsPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [clients, setClients] = useState<AgentClientRow[]>([])
  const [agentName, setAgentName] = useState('Codex')
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440)
  const [tokenPreview, setTokenPreview] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function loadClients() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const response = await getAuthedJson<AgentClientsResponse>(
        `/v1/twins/${session.twinId}/agents/clients`,
        session,
        onSessionRefreshed,
      )
      setClients(response.clients)
      setStatus(`${response.clients.length} coding-agent permission grant(s).`)
    } catch (error) {
      setClients([])
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function createAgentToken() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await postAuthedJson<{
        token: string
        clientId: string
        grantId: string
        expiresAt: string
      }>(
        `/v1/twins/${session.twinId}/agents/tokens`,
        {
          agentName,
          scopes: DEFAULT_AGENT_SCOPES,
          expiresInMinutes,
        },
        session,
        onSessionRefreshed,
      )
      setTokenPreview(response.token)
      setStatus(`Created ${agentName} token. Copy it now; Sivraj will not show the token again.`)
      await loadClients()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function revokeGrant(client: AgentClientRow) {
    if (!session || !isSessionForWallet) {
      return
    }

    const revokeId = client.grantId || client.clientId
    if (!revokeId) {
      setStatus('Cannot revoke this grant because the API did not return a grant or client id.')
      return
    }

    setIsSubmitting(true)

    try {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/agents/clients/${revokeId}/revoke`,
        {},
        session,
        onSessionRefreshed,
      )
      setStatus(`Revoked grant ${client.grantId || revokeId}. Existing JWTs expire at their token expiry; new refresh/delegation should be denied by policy.`)
      await loadClients()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadClients()
    }
  }, [isSessionForWallet, session?.twinId])

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Agent permissions</h2>
      </div>

      <div className="console-panel">
        <dl>
          <dt>Purpose</dt>
          <dd>Create and revoke scoped coding-agent access to Sivraj context, retrieval, sources, and writebacks.</dd>
          <dt>Trust boundary</dt>
          <dd>Tokens are narrow, time-limited, and auditable. Private raw memories are not exported.</dd>
        </dl>
      </div>

      <form className="console-form inline" onSubmit={(event) => {
        event.preventDefault()
        void createAgentToken()
      }}>
        <label>
          <span>Agent name</span>
          <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
        </label>
        <label>
          <span>TTL minutes</span>
          <input
            type="number"
            min="15"
            max="43200"
            value={expiresInMinutes}
            onChange={(event) => setExpiresInMinutes(Number(event.target.value))}
          />
        </label>
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create agent token'}
        </button>
        <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadClients()}>
          {isLoading ? 'Refreshing...' : 'Refresh grants'}
        </button>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {tokenPreview ? (
        <div className="console-panel wide">
          <h3>New bearer token</h3>
          <p className="console-footnote">Use this token in your MCP server env as <code>SIVRAJ_API_TOKEN</code>.</p>
          <pre>{tokenPreview}</pre>
        </div>
      ) : null}

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Scopes</th>
              <th>Domains</th>
              <th>Expires</th>
              <th>Grant</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.grantId}>
                <td>{client.name}</td>
                <td>{client.status}</td>
                <td>{client.scopes.join(', ')}</td>
                <td>{client.memoryDomains.join(', ') || '—'}</td>
                <td>{client.expiresAt ?? '—'}</td>
                <td>{client.grantId.slice(0, 8)}…</td>
                <td>
                  <button
                    className="secondary-action compact"
                    type="button"
                    disabled={isSubmitting || client.status !== 'active'}
                    onClick={() => void revokeGrant(client)}
                  >
                    Revoke
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
