import { describe, expect, it, vi } from "vitest";
import {
  buildConnectorSyncEnqueueInput,
  buildConnectorSyncQueueFailureAudit,
  buildConnectorSyncQueueWarning,
  buildConnectorSyncResponseBody,
  buildConnectorSyncRunValues,
  enqueueConnectorSyncJob,
  handleConnectorAccountSync,
  loadConnectorAccountForSync,
  loadConnectorSourceForSync,
  readConnectorSyncErrorMessage,
  readConnectorSyncSourceError,
} from "./connector-account-sync.js";

describe("connector account sync helpers", () => {
  it("builds queue warnings", () => {
    expect(buildConnectorSyncQueueWarning({
      connectorSyncQueueConfigured: false,
      queued: null,
    })).toBe("connector_sync_queue_not_configured");

    expect(buildConnectorSyncQueueWarning({
      connectorSyncQueueConfigured: true,
      queued: null,
    })).toBe("connector_sync_queue_failed");
  });

  it("builds sync response bodies", () => {
    expect(buildConnectorSyncResponseBody({
      syncRun: { id: "sync-1" },
      queued: { jobId: "job-1" },
      connectorSyncQueueConfigured: true,
    })).toEqual({
      syncRun: { id: "sync-1" },
      jobId: "job-1",
      warning: null,
    });
  });

  it("builds sync run insert values", () => {
    expect(buildConnectorSyncRunValues({
      twinId: "twin-1",
      account: { id: "account-1", provider: "github", cursor: "main" },
      source: { id: "source-1", cursor: "feature" },
      mode: "incremental",
      requestedBy: "user-1",
    })).toMatchObject({
      connectorAccountId: "account-1",
      connectorSourceId: "source-1",
      cursorBefore: "feature",
      status: "queued",
    });
  });

  it("reads connector source errors", () => {
    expect(readConnectorSyncSourceError({ ok: false, error: { status: 404, body: { error: "missing" } } }))
      .toEqual({ status: 404, body: { error: "missing" } });
    expect(readConnectorSyncSourceError({ ok: true })).toBeNull();
  });

  it("reads connector sync error messages", () => {
    expect(readConnectorSyncErrorMessage(new Error("queue down"))).toBe("queue down");
    expect(readConnectorSyncErrorMessage("queue down")).toBe("Unknown queue error");
  });

  it("loads connector accounts for sync", async () => {
    const connected = await loadConnectorAccountForSync({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "account-1", provider: "github", status: "connected", cursor: null }],
          }),
        }),
      }),
    } as never, "twin-1", "account-1");

    expect(connected).toMatchObject({ ok: true, value: { id: "account-1" } });

    const missing = await loadConnectorAccountForSync({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    } as never, "twin-1", "missing");

    expect(missing).toMatchObject({
      ok: false,
      error: { status: 404, body: { error: "connector_account_not_found" } },
    });
  });

  it("loads connector sources for sync", async () => {
    const source = await loadConnectorSourceForSync({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "source-1", cursor: "cursor-1" }],
          }),
        }),
      }),
    } as never, {
      twinId: "twin-1",
      accountId: "account-1",
      connectorSourceId: "source-1",
    });

    expect(source).toMatchObject({ ok: true, value: { id: "source-1" } });
  });

  it("records queue failures while enqueueing connector sync jobs", async () => {
    const inserted: unknown[] = [];
    const queued = await enqueueConnectorSyncJob({
      db: {
        insert: () => ({
          values: async (value: unknown) => {
            inserted.push(value);
          },
        }),
      } as never,
      connectorSyncQueue: {
        enqueueConnectorSync: vi.fn().mockRejectedValue(new Error("queue unavailable")),
      },
      twinId: "twin-1",
      syncRunId: "sync-1",
      enqueueInput: buildConnectorSyncEnqueueInput({
        syncRunId: "sync-1",
        twinId: "twin-1",
        account: { id: "account-1", provider: "github" },
        source: null,
        mode: "manual",
      }),
    });

    expect(queued).toBeNull();
    expect(inserted[0]).toMatchObject({
      eventType: "connector.sync_queue_failed",
      metadata: { error: "queue unavailable" },
    });
  });

  it("handles connector account sync requests", async () => {
    const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
    const response = await handleConnectorAccountSync({
      json,
    } as never, {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
      } as never,
      connectorSyncQueue: null,
      auth: { type: "user", sub: "user-1" },
      twinId: "twin-1",
      accountId: "missing",
      mode: "manual",
      connectorSourceId: null,
    });

    expect(json).toHaveBeenCalledWith(
      { error: "connector_account_not_found" },
      404,
    );
    expect(response).toEqual({
      body: { error: "connector_account_not_found" },
      status: 404,
    });
  });

  it("builds enqueue payloads and failure audits", () => {
    expect(buildConnectorSyncEnqueueInput({
      syncRunId: "sync-1",
      twinId: "twin-1",
      account: { id: "account-1", provider: "slack" },
      source: null,
      mode: "full",
    })).toEqual({
      syncRunId: "sync-1",
      twinId: "twin-1",
      connectorAccountId: "account-1",
      connectorSourceId: null,
      provider: "slack",
      mode: "full",
    });

    expect(buildConnectorSyncQueueFailureAudit({
      twinId: "twin-1",
      syncRunId: "sync-1",
      error: "queue unavailable",
    })).toMatchObject({
      eventType: "connector.sync_queue_failed",
      metadata: { error: "queue unavailable" },
    });
  });
});
