import { ConsolePage, ConsoleStatus } from "@/console/console-page-ui";
import { ConnectorsAccountsTable } from "@/console/pages/connectors/ConnectorsAccountsTable";
import { ConnectorsConnectForm } from "@/console/pages/connectors/ConnectorsConnectForm";
import { useConnectorsPage } from "@/console/pages/connectors/use-connectors-page";

export function ConnectorsPage() {
  const connectors = useConnectorsPage();

  return (
    <ConsolePage title="Connectors">
      <ConnectorsConnectForm
        provider={connectors.provider}
        displayName={connectors.displayName}
        sourceId={connectors.sourceId}
        sourceName={connectors.sourceName}
        sourceUri={connectors.sourceUri}
        syncCadence={connectors.syncCadence}
        isLoading={connectors.isLoading}
        onProviderChange={connectors.selectProvider}
        onDisplayNameChange={connectors.setDisplayName}
        onSourceIdChange={connectors.setSourceId}
        onSourceNameChange={connectors.setSourceName}
        onSourceUriChange={connectors.setSourceUri}
        onSyncCadenceChange={connectors.setSyncCadence}
        onConnect={() => void connectors.connectSource()}
        onRefresh={() => void connectors.loadConnectors()}
      />

      <ConsoleStatus status={connectors.status} />

      <div className="console-grid">
        <div className="console-panel wide">
          <h3>Connected sources</h3>
          <ConnectorsAccountsTable
            connectors={connectors.connectors}
            isLoading={connectors.isLoading}
            onSyncAccount={(accountId, sourceId) =>
              void connectors.syncAccount(accountId, sourceId)
            }
          />
        </div>

        <div className="console-panel wide">
          <h3>Recent sync runs</h3>
          <pre>{JSON.stringify(connectors.connectors?.recentSyncRuns ?? [], null, 2)}</pre>
        </div>
      </div>
    </ConsolePage>
  );
}
