import { ConsoleRefreshButton } from "@/console/console-page-ui";
import { CONNECTOR_PROVIDERS } from "@/console/pages/connectors/connector-page-constants";

type ConnectorsConnectFormProps = {
  provider: string;
  displayName: string;
  sourceId: string;
  sourceName: string;
  sourceUri: string;
  syncCadence: string;
  isLoading: boolean;
  onProviderChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onSourceIdChange: (value: string) => void;
  onSourceNameChange: (value: string) => void;
  onSourceUriChange: (value: string) => void;
  onSyncCadenceChange: (value: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
};

export function ConnectorsConnectForm(props: ConnectorsConnectFormProps) {
  return (
    <div className="console-form">
      <div className="form-row">
        <label>
          <span>Provider</span>
          <select
            value={props.provider}
            onChange={(event) => props.onProviderChange(event.target.value)}
          >
            {CONNECTOR_PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Account label</span>
          <input
            value={props.displayName}
            onChange={(event) => props.onDisplayNameChange(event.target.value)}
          />
        </label>
      </div>
      <ConnectorSourceFields {...props} />
      {props.provider === "browser_history" ? (
        <p className="console-banner warn">
          Browser history files should be imported through the Ingest page so raw history stays inside encrypted artifact storage.
        </p>
      ) : null}
      <div className="console-actions">
        <button
          className="primary-action"
          type="button"
          disabled={props.isLoading}
          onClick={props.onConnect}
        >
          Connect source
        </button>
        <ConsoleRefreshButton
          isLoading={props.isLoading}
          label="Refresh"
          onClick={props.onRefresh}
        />
      </div>
    </div>
  );
}

function ConnectorSourceFields(props: ConnectorsConnectFormProps) {
  return (
    <>
      <div className="form-row">
        <label>
          <span>Source ID</span>
          <input
            value={props.sourceId}
            onChange={(event) => props.onSourceIdChange(event.target.value)}
          />
        </label>
        <label>
          <span>Source name</span>
          <input
            value={props.sourceName}
            onChange={(event) => props.onSourceNameChange(event.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>Source URI</span>
          <input
            value={props.sourceUri}
            onChange={(event) => props.onSourceUriChange(event.target.value)}
          />
        </label>
        <label>
          <span>Sync cadence</span>
          <select
            value={props.syncCadence}
            onChange={(event) => props.onSyncCadenceChange(event.target.value)}
          >
            <option value="manual">Manual</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
      </div>
    </>
  );
}
