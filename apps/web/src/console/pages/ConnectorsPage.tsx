import { useCallback, useEffect, useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { ConnectorAccountResponse, ConnectorSyncResponse, ConnectorsResponse } from '../types'

const PROVIDERS = [
  { value: 'github', label: 'GitHub' },
  { value: 'browser_history', label: 'Browser history' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
  { value: 'notion', label: 'Notion' },
  { value: 'google_drive', label: 'Google Drive' },
  { value: 'microsoft_onedrive', label: 'Microsoft OneDrive' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude' },
]

const PROVIDER_DEFAULTS: Record<string, { label: string; sourceId: string; sourceName: string; sourceUri: string }> = {
  github: {
    label: 'GitHub repository sync',
    sourceId: 'github:owner/repo',
    sourceName: 'owner/repo',
    sourceUri: 'https://github.com/owner/repo',
  },
  notion: {
    label: 'Notion page sync',
    sourceId: 'notion-page-id',
    sourceName: 'Notion page',
    sourceUri: 'https://www.notion.so/workspace/Page-00000000000000000000000000000000',
  },
  browser_history: {
    label: 'Browser history import',
    sourceId: 'browser-history',
    sourceName: 'Browser history',
    sourceUri: '',
  },
  slack: {
    label: 'Slack workspace sync',
    sourceId: 'C1234567890',
    sourceName: 'Slack channel',
    sourceUri: '',
  },
  email: {
    label: 'Gmail inbox sync',
    sourceId: 'gmail:inbox',
    sourceName: 'Gmail inbox',
    sourceUri: 'gmail://me',
  },
  calendar: {
    label: 'Google Calendar sync',
    sourceId: 'primary',
    sourceName: 'Primary calendar',
    sourceUri: 'google-calendar://primary',
  },
  google_drive: {
    label: 'Google Drive folder sync',
    sourceId: 'root',
    sourceName: 'Google Drive folder',
    sourceUri: 'google-drive://root',
  },
  microsoft_onedrive: {
    label: 'OneDrive folder sync',
    sourceId: 'root',
    sourceName: 'OneDrive folder',
    sourceUri: 'microsoft-onedrive://root',
  },
}

export function ConnectorsPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [connectors, setConnectors] = useState<ConnectorsResponse | null>(null)
  const [provider, setProvider] = useState('github')
  const [displayName, setDisplayName] = useState('GitHub repository sync')
  const [sourceId, setSourceId] = useState('github:owner/repo')
  const [sourceName, setSourceName] = useState('owner/repo')
  const [sourceUri, setSourceUri] = useState('https://github.com/owner/repo')
  const [syncCadence, setSyncCadence] = useState('manual')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadConnectors = useCallback(async () => {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const response = await getAuthedJson<ConnectorsResponse>(
        `/v1/twins/${session.twinId}/connectors`,
        session,
        onSessionRefreshed,
      )
      setConnectors(response)
      setStatus(null)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [isSessionForWallet, onSessionRefreshed, session])

  useEffect(() => {
    if (session && isSessionForWallet) {
      void loadConnectors()
    }
  }, [isSessionForWallet, loadConnectors, session])

  function selectProvider(value: string) {
    setProvider(value)
    const defaults = PROVIDER_DEFAULTS[value]

    if (!defaults) {
      return
    }

    setDisplayName(defaults.label)
    setSourceId(defaults.sourceId)
    setSourceName(defaults.sourceName)
    setSourceUri(defaults.sourceUri)
  }

  async function connectSource() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const response = await postAuthedJson<ConnectorAccountResponse>(
        `/v1/twins/${session.twinId}/connectors/accounts`,
        {
          provider,
          displayName: displayName.trim(),
          externalAccountId: displayName.trim(),
          syncCadence,
          source: sourceId.trim()
            ? {
                externalSourceId: sourceId.trim(),
                displayName: sourceName.trim() || sourceId.trim(),
                uri: sourceUri.trim() || undefined,
              }
            : undefined,
        },
        session,
        onSessionRefreshed,
      )
      setStatus(`Connected ${response.account.displayName}.`)
      await loadConnectors()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function syncAccount(accountId: string, connectorSourceId?: string | null) {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const response = await postAuthedJson<ConnectorSyncResponse>(
        `/v1/twins/${session.twinId}/connectors/accounts/${accountId}/sync`,
        {
          mode: 'manual',
          connectorSourceId,
        },
        session,
        onSessionRefreshed,
      )
      setStatus(response.warning ? response.warning : `Queued sync ${response.syncRun.id}.`)
      await loadConnectors()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Connectors</h2>
      </div>

      <div className="console-form">
        <div className="form-row">
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(event) => selectProvider(event.target.value)}>
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Account label</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>Source ID</span>
            <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
          </label>
          <label>
            <span>Source name</span>
            <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>Source URI</span>
            <input value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} />
          </label>
          <label>
            <span>Sync cadence</span>
            <select value={syncCadence} onChange={(event) => setSyncCadence(event.target.value)}>
              <option value="manual">Manual</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
        </div>
        {provider === 'browser_history' ? (
          <p className="console-banner warn">
            Browser history files should be imported through the Ingest page so raw history stays inside encrypted artifact storage.
          </p>
        ) : null}
        <div className="console-actions">
          <button className="primary-action" type="button" disabled={isLoading} onClick={() => void connectSource()}>
            Connect source
          </button>
          <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadConnectors()}>
            Refresh
          </button>
        </div>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      <div className="console-grid">
        <div className="console-panel wide">
          <h3>Connected sources</h3>
          {connectors?.accounts.length ? (
            <div className="console-table-wrap">
              <table className="console-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Cadence</th>
                    <th>Last sync</th>
                    <th>Next sync</th>
                    <th>Last result</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {connectors.accounts.map((account) => {
                    const source = account.sources[0]
                    const run = account.lastSyncRun

                    return (
                      <tr key={account.id}>
                        <td>{account.provider}</td>
                        <td>{source?.displayName ?? account.displayName}</td>
                        <td>{account.status}</td>
                        <td>{account.syncCadence}</td>
                        <td>{account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'Never'}</td>
                        <td>{account.nextSyncAt ? new Date(account.nextSyncAt).toLocaleString() : '—'}</td>
                        <td>
                          {run
                            ? `${run.status}: +${run.addedCount} ~${run.updatedCount} skip ${run.skippedCount} fail ${run.failedCount}`
                            : 'No syncs'}
                        </td>
                        <td>
                          <button
                            className="secondary-action compact"
                            type="button"
                            disabled={isLoading}
                            onClick={() => void syncAccount(account.id, source?.id ?? null)}
                          >
                            Sync
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No connectors linked yet.</p>
          )}
        </div>

        <div className="console-panel wide">
          <h3>Recent sync runs</h3>
          <pre>{JSON.stringify(connectors?.recentSyncRuns ?? [], null, 2)}</pre>
        </div>
      </div>
    </section>
  )
}
