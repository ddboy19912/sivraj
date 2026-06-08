import { auditEvents, type Db } from "@sivraj/db";

async function createAuditEvent(
  db: Db,
  input: {
    twinId: string;
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: input.eventType,
    resourceType: "source_artifact",
    resourceId: input.resourceId,
    metadata: input.metadata,
  });
}

export function createAuditMethods(db: Db) {
  return {
    createAuditEvent: (input: Parameters<typeof createAuditEvent>[1]) =>
      createAuditEvent(db, input),
  };
}
