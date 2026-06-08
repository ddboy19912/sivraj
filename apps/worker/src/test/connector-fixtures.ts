export function createConnectorAdapterTestInput(inserts: unknown[]) {
  return {
    db: { insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }) },
    syncRun: { id: "run-1", twinId: "twin-1" },
    account: { id: "account-1", cursor: "cursor-1", syncCadence: "daily" as const },
    source: { id: "source-1", cursor: "source-cursor" },
    privateSourceStorage: {},
    artifactProcessingQueue: {},
  } as never;
}
