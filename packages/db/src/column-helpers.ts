import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

type PgTableWithId = { id: AnyPgColumn };

export function primaryId() {
  return uuid("id").primaryKey().defaultRandom();
}

export function tzTimestamp(name: string) {
  return timestamp(name, { withTimezone: true });
}

export function createdAtColumn() {
  return tzTimestamp("created_at").notNull().defaultNow();
}

function updatedAtColumn() {
  return tzTimestamp("updated_at").notNull().defaultNow();
}

export function rowTimestamps() {
  return {
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  };
}

export function metadataColumn() {
  return jsonb("metadata").$type<unknown>();
}

export function twinIdColumn<T extends PgTableWithId>(table: () => T) {
  return uuid("twin_id")
    .notNull()
    .references(() => table().id, { onDelete: "cascade" });
}

export function nullableTwinIdColumn<T extends PgTableWithId>(table: () => T) {
  return uuid("twin_id").references(() => table().id, { onDelete: "set null" });
}

export function optionalUuidRef<T extends PgTableWithId>(
  columnName: string,
  table: () => T,
  onDelete: "set null" | "cascade" = "set null",
) {
  return uuid(columnName).references(() => table().id, { onDelete });
}

export function textArrayColumn(name: string) {
  return text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);
}

export function uuidArrayColumn(name: string) {
  return uuid(name)
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`);
}

export function connectorSyncStateColumns() {
  return {
    cursor: text("cursor"),
    lastSyncAt: tzTimestamp("last_sync_at"),
    nextSyncAt: tzTimestamp("next_sync_at"),
    errorCode: text("error_code"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  };
}
