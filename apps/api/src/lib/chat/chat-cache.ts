/**
 * Short-lived caches for chat runtime dependencies.
 *
 * Avoids repeated DB reads for provider config and twin identity profile within a turn burst.
 */
import { twinIdentityProfiles, twins } from "@sivraj/db";
import { eq } from "drizzle-orm";
import type { ApiDb } from "../../app.js";
import type { ChatRuntimeConfig } from "../../types/chat.types.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { readPositiveInteger } from "./helpers.js";
import { resolveRuntimeProviderConfig } from "../../routes/chat-provider-config.js";
import type { CoreCommsContext } from "./turn-types.js";

const CHAT_PROVIDER_CONFIG_CACHE_TTL_DEFAULT_MS = 5_000;
const CHAT_CORE_COMMS_CACHE_TTL_DEFAULT_MS = 30_000;

const runtimeProviderConfigCache = new Map<string, {
  expiresAt: number;
  value?: ChatRuntimeConfig | null;
  promise?: Promise<ChatRuntimeConfig | null>;
}>();

const coreCommsContextCache = new Map<string, {
  expiresAt: number;
  value?: CoreCommsContext;
  promise?: Promise<CoreCommsContext>;
}>();

/** Cached LLM provider config for a twin (TTL from `CHAT_PROVIDER_CONFIG_CACHE_TTL_MS`). */
export async function loadCachedRuntimeProviderConfig(
  db: ApiDb,
  twinId: string,
): Promise<ChatRuntimeConfig | null> {
  const ttlMs = readPositiveInteger(
    process.env["CHAT_PROVIDER_CONFIG_CACHE_TTL_MS"],
    CHAT_PROVIDER_CONFIG_CACHE_TTL_DEFAULT_MS,
  );
  const now = Date.now();
  const cached = runtimeProviderConfigCache.get(twinId);
  if (cached && cached.expiresAt > now) {
    if ("value" in cached) {
      return cached.value ?? null;
    }
    if (cached.promise) {
      return cached.promise;
    }
  }
  const promise = resolveRuntimeProviderConfig(db, twinId, process.env)
    .then((value) => {
      runtimeProviderConfigCache.set(twinId, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      runtimeProviderConfigCache.delete(twinId);
      throw error;
    });
  runtimeProviderConfigCache.set(twinId, {
    promise,
    expiresAt: now + ttlMs,
  });
  return promise;
}

/** Cached assistant/user identity fields used in prompts and memory intake. */
export async function loadCachedCoreCommsContext(
  db: ApiDb,
  twinId: string,
): Promise<CoreCommsContext> {
  const ttlMs = readPositiveInteger(
    process.env["CHAT_CORE_COMMS_CACHE_TTL_MS"],
    CHAT_CORE_COMMS_CACHE_TTL_DEFAULT_MS,
  );
  const now = Date.now();
  const cached = coreCommsContextCache.get(twinId);
  if (cached && cached.expiresAt > now) {
    if (cached.value) {
      return cached.value;
    }
    if (cached.promise) {
      return cached.promise;
    }
  }
  const promise = loadCoreCommsContext(db, twinId)
    .then((value) => {
      coreCommsContextCache.set(twinId, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      coreCommsContextCache.delete(twinId);
      throw error;
    });
  coreCommsContextCache.set(twinId, {
    promise,
    expiresAt: now + ttlMs,
  });
  return promise;
}

export async function loadCoreCommsContext(db: ApiDb, twinId: string): Promise<CoreCommsContext> {
  const [[twin], [profile]] = await Promise.all([
    db
      .select({ name: twins.name })
      .from(twins)
      .where(eq(twins.id, twinId))
      .limit(1),
    db
      .select({
        displayName: twinIdentityProfiles.displayName,
        aliases: twinIdentityProfiles.aliases,
        emails: twinIdentityProfiles.emails,
        phones: twinIdentityProfiles.phones,
        handles: twinIdentityProfiles.handles,
      })
      .from(twinIdentityProfiles)
      .where(eq(twinIdentityProfiles.twinId, twinId))
      .limit(1),
  ]);
  return {
    assistantName: optionalString(twin?.name),
    displayName: optionalString(profile?.displayName),
    aliases: profile?.aliases ?? [],
    emails: profile?.emails ?? [],
    phones: profile?.phones ?? [],
    handles: readRecord(profile?.handles),
  };
}
