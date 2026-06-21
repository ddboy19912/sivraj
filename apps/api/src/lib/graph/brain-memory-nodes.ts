import { canonicalMemories, twinIdentityProfiles } from "@sivraj/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import {
  formatCurrentTruthSearchContent,
  readCurrentTruthContext,
} from "../chat/current-truth.js";

export type BrainGraphRouteNode = {
  id: string;
  twinId: string;
  nodeType: "person" | "organization" | "project" | "concept" | "event" | "artifact" | "goal" | "decision" | "topic" | "other";
  name: string;
  normalizedName: string;
  description: string | null;
  properties: unknown;
  confidenceScore: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type CurrentTruthContext = NonNullable<ReturnType<typeof readCurrentTruthContext>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function loadBrainMemoryGraphNodes(input: {
  db: AppDependencies["db"];
  twinId: string;
  nodeType: BrainGraphRouteNode["nodeType"] | null;
  limit: number;
}): Promise<BrainGraphRouteNode[]> {
  const [identityProfiles, currentTruthMemories] = await Promise.all([
    input.db
      .select()
      .from(twinIdentityProfiles)
      .where(eq(twinIdentityProfiles.twinId, input.twinId))
      .limit(1),
    input.db
      .select()
      .from(canonicalMemories)
      .where(and(
        eq(canonicalMemories.twinId, input.twinId),
        eq(canonicalMemories.status, "approved"),
        sql`${canonicalMemories.metadata}->'currentTruth' is not null`,
      ))
      .orderBy(desc(canonicalMemories.updatedAt))
      .limit(Math.max(1, Math.min(input.limit, 200))),
  ]);

  const nodes = [
    ...identityProfiles.flatMap(formatIdentityProfileGraphNodes),
    ...currentTruthMemories.flatMap(formatCanonicalCurrentTruthGraphNode),
  ];

  return nodes
    .filter((node) => !input.nodeType || node.nodeType === input.nodeType)
    .slice()
    .sort(compareBrainGraphRouteNodes)
    .slice(0, input.limit);
}

export function formatCanonicalCurrentTruthGraphNode(
  row: typeof canonicalMemories.$inferSelect,
): BrainGraphRouteNode[] {
  const currentTruth = readCurrentTruthContext(row.metadata);
  if (!currentTruth) {
    return [];
  }

  const metadata = asRecord(row.metadata);
  const sourceArtifactIds = uniqueStrings([
    ...readUuidArray(metadata["sourceArtifactIds"]),
    ...readUuidArray(asRecord(metadata["currentTruth"])["sourceArtifactIds"]),
    ...(isUuid(currentTruth.sourceArtifactId) ? [currentTruth.sourceArtifactId] : []),
  ]);
  const sourceType = readString(metadata["sourceType"]) ?? sourceTypeForCurrentTruth(currentTruth);
  const title = formatCurrentTruthNodeTitle({
    subject: row.subject,
    currentTruth,
  });

  return [{
    id: `brain-memory:canonical:${row.id}`,
    twinId: row.twinId,
    nodeType: currentTruth.kind === "engineering_memory" ? "concept" : "person",
    name: title,
    normalizedName: normalizeNodeName(title),
    description: formatCurrentTruthSearchContent({
      subject: row.subject,
      currentTruth,
    }),
    properties: {
      kind: "canonical_current_truth",
      canonicalMemoryId: row.id,
      canonicalMemoryIds: [row.id],
      memoryType: row.memoryType,
      sourceType,
      ...(sourceArtifactIds.length > 0 ? { sourceArtifactIds } : {}),
      currentTruthKind: currentTruth.kind,
      slot: currentTruth.slot,
      qualifier: currentTruth.qualifier,
      subject: row.subject,
      valueType: currentTruth.valueType,
      mutable: currentTruth.mutable,
    },
    confidenceScore: row.confidenceScore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }];
}

export function formatIdentityProfileGraphNodes(
  profile: typeof twinIdentityProfiles.$inferSelect,
): BrainGraphRouteNode[] {
  const sourceArtifactIds = isUuid(profile.selfDescriptionArtifactId)
    ? [profile.selfDescriptionArtifactId]
    : [];
  const fields: Array<{ key: string; label: string; value: string }> = [
    ...(profile.displayName ? [{
      key: "display_name",
      label: "Name",
      value: profile.displayName,
    }] : []),
    ...profile.aliases.map((alias, index) => ({
      key: `alias_${index + 1}`,
      label: "Alias",
      value: alias,
    })),
    ...profile.emails.map((email, index) => ({
      key: `email_${index + 1}`,
      label: "Email",
      value: email,
    })),
    ...profile.phones.map((phone, index) => ({
      key: `phone_${index + 1}`,
      label: "Phone",
      value: phone,
    })),
    ...formatHandleFields(profile.handles),
  ].filter((field) => field.value.trim().length > 0);

  return fields.map((field) => ({
    id: `brain-memory:identity:${profile.id}:${field.key}`,
    twinId: profile.twinId,
    nodeType: "person" as const,
    name: `${field.label}: ${field.value}`,
    normalizedName: normalizeNodeName(`${field.label}: ${field.value}`),
    description: formatIdentityProfileDescription(field.label, field.value),
    properties: {
      kind: "identity_profile",
      profileId: profile.id,
      profileField: field.key,
      profileLabel: field.label,
      sourceType: "identity_profile",
      ...(sourceArtifactIds.length > 0
        ? {
            sourceArtifactId: sourceArtifactIds[0],
            sourceArtifactIds,
          }
        : {}),
    },
    confidenceScore: null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }));
}

function formatIdentityProfileDescription(label: string, value: string) {
  return label === "Name"
    ? `The user's name is ${value}. This was saved in the identity profile.`
    : `${label} saved in the user's identity profile: ${value}.`;
}

function compareBrainGraphRouteNodes(a: BrainGraphRouteNode, b: BrainGraphRouteNode) {
  return b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id);
}

function formatCurrentTruthNodeTitle(input: {
  subject: string | null;
  currentTruth: CurrentTruthContext;
}) {
  if (input.currentTruth.kind === "engineering_memory") {
    return input.currentTruth.engineeringSubject
      ?? input.subject
      ?? formatLabel(input.currentTruth.engineeringMemoryType ?? input.currentTruth.slot);
  }

  const slot = formatLabel(input.currentTruth.slot);
  const qualifier = input.currentTruth.qualifier ? formatLabel(input.currentTruth.qualifier) : null;
  const label = qualifier ? `${qualifier} ${slot}` : slot;
  return `${label}: ${input.currentTruth.value}`;
}

function sourceTypeForCurrentTruth(currentTruth: CurrentTruthContext) {
  return currentTruth.kind === "engineering_memory"
    ? "chat_hot_engineering_memory_intake"
    : "chat_hot_memory_intake";
}

function formatHandleFields(handles: unknown) {
  return Object.entries(asRecord(handles)).flatMap(([handleKind, value]) => (
    readStringArray(value).map((handle, index) => ({
      key: `handle_${normalizeNodeName(handleKind)}_${index + 1}`,
      label: `${formatLabel(handleKind)} handle`,
      value: handle,
    }))
  ));
}

function normalizeNodeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function formatLabel(value: string) {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\S+/gu, (word) => (
      word.length <= 2
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    ));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readUuidArray(value: unknown) {
  return readStringArray(value).filter(isUuid);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
