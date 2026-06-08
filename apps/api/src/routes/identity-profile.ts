import { auditEvents, twinIdentityProfiles, twins, users } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, type AuthorizedTwin } from "../lib/http/route-auth.js";
import { parseJsonObjectBody } from "../lib/http/route-helpers.js";

type ProfileResponse = {
  twinId: string;
  displayName: string | null;
  aliases: string[];
  emails: string[];
  phones: string[];
  handles: Record<string, string[]>;
  selfDescriptionArtifactId: string | null;
  onboardingStatus: OnboardingStatus;
  firstMeetIntroStatus: FirstMeetIntroStatus;
  shouldPlayFirstMeetIntro: boolean;
  events: TwinRuntimeEvent[];
};

type OnboardingStatus = "not_started" | "in_progress" | "completed";
type FirstMeetIntroStatus = "not_started" | "issued" | "consumed";

export type UserLifecycleState = {
  onboardingStatus: OnboardingStatus | undefined;
  firstMeetIntroStatus: FirstMeetIntroStatus | undefined;
  shouldPlayFirstMeetIntro: boolean;
};

export type TwinRuntimeEvent = {
  type: "first_meet_intro.requested";
  eventId: string;
  dedupeKey: string;
  text: string;
  voiceStyle: "energetic";
};

export function createIdentityProfileRoutes({ db }: AppDependencies) {
  const identityRoutes = new Hono<AuthEnv>();

  identityRoutes.get("/identity-profile", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }
    const { auth, twinId } = routeAuth.value;

    const [profile] = await db
      .select()
      .from(twinIdentityProfiles)
      .where(eq(twinIdentityProfiles.twinId, twinId))
      .limit(1);
    const twinName = await loadTwinName(db, twinId);
    const [user] = auth.type === "service"
      ? []
      : await db
          .select({
            onboardingStatus: users.onboardingStatus,
            firstMeetIntroStatus: users.firstMeetIntroStatus,
          })
          .from(users)
          .where(eq(users.id, auth.sub))
          .limit(1);

    return c.json(
      formatIdentityProfile(
        twinId,
        profile,
        {
          onboardingStatus: user?.onboardingStatus,
          firstMeetIntroStatus: user?.firstMeetIntroStatus,
          shouldPlayFirstMeetIntro: false,
        },
        { twinName },
      ),
    );
  });

  identityRoutes.put("/identity-profile", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return putIdentityProfile(c, db, routeAuth.value);
  });

  identityRoutes.post("/identity-profile/first-meet-intro/consumed", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return consumeFirstMeetIntro(c, db, routeAuth.value);
  });

  return identityRoutes;
}

async function putIdentityProfile(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const parsedBody = await parseJsonObjectBody(c);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const parsed = parseIdentityProfilePayload(parsedBody.body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, parsed.status);
  }

  if (parsed.payload.hasOnboardingStatus && auth.type === "service") {
    return c.json({ error: "user_onboarding_status_required" }, 403);
  }

  const [existing] = await db
    .select()
    .from(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, twinId))
    .limit(1);
  const nextSelfDescriptionArtifactId = resolveSelfDescriptionArtifactId(
    existing,
    parsed.payload,
  );

  if (parsed.payload.onboardingStatus === "completed" && !nextSelfDescriptionArtifactId) {
    return c.json({ error: "missing_onboarding_memory_artifact" }, 400);
  }

  const profile = await upsertTwinIdentityProfile(db, twinId, existing, parsed.payload);
  const twinName = await loadTwinName(db, twinId);
  const userLifecycle = await syncUserLifecycleState(
    db,
    auth,
    parsed.payload.onboardingStatus,
  );

  writeIdentityProfileAuditEvent(db, {
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "twin_identity_profile.updated",
    resourceType: "twin_identity_profile",
    resourceId: profile.id,
    metadata: {
      walletAddress: auth.walletAddress,
      aliasCount: parsed.payload.aliases.length,
      emailCount: parsed.payload.emails.length,
      phoneCount: parsed.payload.phones.length,
      handleKinds: Object.keys(parsed.payload.handles),
      onboardingStatus: userLifecycle.onboardingStatus,
      firstMeetIntroStatus: userLifecycle.firstMeetIntroStatus,
    },
  });

  return c.json(
    formatIdentityProfile(twinId, profile, userLifecycle, { twinName }),
  );
}

type ParsedIdentityProfilePayload = {
  displayName: string | null;
  aliases: string[];
  emails: string[];
  phones: string[];
  handles: Record<string, string[]>;
  hasSelfDescriptionArtifactId: boolean;
  selfDescriptionArtifactId: string | null | undefined;
  hasOnboardingStatus: boolean;
  onboardingStatus: OnboardingStatus | undefined;
};

function parseIdentityProfilePayload(payload: Record<string, unknown>):
  | { ok: true; payload: ParsedIdentityProfilePayload }
  | { ok: false; error: string; status: 400 } {
  const aliases = readStringList(payload["aliases"]);
  const emails = readStringList(payload["emails"]);
  const phones = readStringList(payload["phones"]);
  const handles = readHandles(payload["handles"]);
  const hasOnboardingStatus = Object.prototype.hasOwnProperty.call(payload, "onboardingStatus");
  const onboardingStatus = hasOnboardingStatus
    ? readOnboardingStatus(payload["onboardingStatus"])
    : undefined;

  if (!aliases || !emails || !phones || !handles || onboardingStatus === null) {
    return { ok: false, error: "invalid_identity_profile", status: 400 };
  }

  const hasSelfDescriptionArtifactId = Object.prototype.hasOwnProperty.call(
    payload,
    "selfDescriptionArtifactId",
  );

  return {
    ok: true,
    payload: {
      displayName: optionalTrimmedString(payload["displayName"]),
      aliases,
      emails,
      phones,
      handles,
      hasSelfDescriptionArtifactId,
      selfDescriptionArtifactId: hasSelfDescriptionArtifactId
        ? optionalTrimmedString(payload["selfDescriptionArtifactId"])
        : undefined,
      hasOnboardingStatus,
      onboardingStatus,
    },
  };
}

function resolveSelfDescriptionArtifactId(
  existing: unknown,
  payload: ParsedIdentityProfilePayload,
): string | null {
  if (payload.hasSelfDescriptionArtifactId) {
    return payload.selfDescriptionArtifactId ?? null;
  }

  const record = existing && typeof existing === "object"
    ? existing as Record<string, unknown>
    : {};

  return optionalTrimmedString(
    record["selfDescriptionArtifactId"] ?? record["self_description_artifact_id"],
  );
}

async function upsertTwinIdentityProfile(
  db: AppDependencies["db"],
  twinId: string,
  existing: typeof twinIdentityProfiles.$inferSelect | undefined,
  payload: ParsedIdentityProfilePayload,
) {
  const nextValues = {
    displayName: payload.displayName,
    aliases: payload.aliases,
    emails: payload.emails,
    phones: payload.phones,
    handles: payload.handles,
    ...(payload.hasSelfDescriptionArtifactId
      ? { selfDescriptionArtifactId: payload.selfDescriptionArtifactId }
      : {}),
    updatedAt: new Date(),
  };

  const [profile] = existing
    ? await db
        .update(twinIdentityProfiles)
        .set(nextValues)
        .where(eq(twinIdentityProfiles.twinId, twinId))
        .returning()
    : await db
        .insert(twinIdentityProfiles)
        .values({ twinId, ...nextValues })
        .returning();

  return profile;
}

async function syncUserLifecycleState(
  db: AppDependencies["db"],
  auth: AuthorizedTwin["auth"],
  onboardingStatus: OnboardingStatus | undefined,
): Promise<UserLifecycleState> {
  if (auth.type === "service") {
    return {
      onboardingStatus,
      firstMeetIntroStatus: undefined,
      shouldPlayFirstMeetIntro: false,
    };
  }

  if (onboardingStatus) {
    if (onboardingStatus === "completed") {
      const [issuedUser] = await db
        .update(users)
        .set({
          onboardingStatus,
          firstMeetIntroStatus: "issued",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, auth.sub),
            eq(users.firstMeetIntroStatus, "not_started"),
          ),
        )
        .returning({
          onboardingStatus: users.onboardingStatus,
          firstMeetIntroStatus: users.firstMeetIntroStatus,
        });

      if (issuedUser) {
        return {
          onboardingStatus: issuedUser.onboardingStatus,
          firstMeetIntroStatus: issuedUser.firstMeetIntroStatus,
          shouldPlayFirstMeetIntro: true,
        };
      }
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        onboardingStatus,
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.sub))
      .returning({
        onboardingStatus: users.onboardingStatus,
        firstMeetIntroStatus: users.firstMeetIntroStatus,
      });

    return {
      onboardingStatus: updatedUser?.onboardingStatus ?? onboardingStatus,
      firstMeetIntroStatus: updatedUser?.firstMeetIntroStatus,
      shouldPlayFirstMeetIntro: false,
    };
  }

  const [user] = await db
    .select({
      onboardingStatus: users.onboardingStatus,
      firstMeetIntroStatus: users.firstMeetIntroStatus,
    })
    .from(users)
    .where(eq(users.id, auth.sub))
    .limit(1);

  return {
    onboardingStatus: user?.onboardingStatus,
    firstMeetIntroStatus: user?.firstMeetIntroStatus,
    shouldPlayFirstMeetIntro: false,
  };
}

async function consumeFirstMeetIntro(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  if (auth.type === "service") {
    return c.json({ error: "user_first_meet_intro_required" }, 403);
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      firstMeetIntroStatus: "consumed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, auth.sub),
        eq(users.firstMeetIntroStatus, "issued"),
      ),
    )
    .returning({
      onboardingStatus: users.onboardingStatus,
      firstMeetIntroStatus: users.firstMeetIntroStatus,
    });

  const [currentUser] = updatedUser
    ? [updatedUser]
    : await db
        .select({
          onboardingStatus: users.onboardingStatus,
          firstMeetIntroStatus: users.firstMeetIntroStatus,
        })
        .from(users)
        .where(eq(users.id, auth.sub))
        .limit(1);

  return c.json({
    twinId,
    onboardingStatus: currentUser?.onboardingStatus ?? "completed",
    firstMeetIntroStatus: currentUser?.firstMeetIntroStatus ?? "consumed",
    shouldPlayFirstMeetIntro: false,
    events: [],
  });
}

function readProfileRecord(profile: unknown): Record<string, unknown> {
  return profile && typeof profile === "object"
    ? profile as Record<string, unknown>
    : {};
}

function readProfileField(record: Record<string, unknown>, camelKey: string, snakeKey: string) {
  return record[camelKey] ?? record[snakeKey];
}

export function formatIdentityProfile(
  twinId: string,
  profile: unknown,
  lifecycle: UserLifecycleState,
  options: { twinName?: string | null } = {},
): ProfileResponse {
  const record = readProfileRecord(profile);
  const onboardingStatus =
    readOnboardingStatus(lifecycle.onboardingStatus) ?? "not_started";
  const firstMeetIntroStatus =
    readFirstMeetIntroStatus(lifecycle.firstMeetIntroStatus) ??
    defaultFirstMeetIntroStatus(onboardingStatus);

  return {
    twinId,
    displayName: optionalTrimmedString(readProfileField(record, "displayName", "display_name")),
    aliases: readStringList(record["aliases"]) ?? [],
    emails: readStringList(record["emails"]) ?? [],
    phones: readStringList(record["phones"]) ?? [],
    handles: readHandles(record["handles"]) ?? {},
    selfDescriptionArtifactId: optionalTrimmedString(
      readProfileField(record, "selfDescriptionArtifactId", "self_description_artifact_id"),
    ),
    onboardingStatus,
    firstMeetIntroStatus,
    shouldPlayFirstMeetIntro:
      lifecycle.shouldPlayFirstMeetIntro && firstMeetIntroStatus === "issued",
    events: buildIdentityProfileEvents({
      twinId,
      twinName: options.twinName,
      profileRecord: record,
      onboardingStatus,
      firstMeetIntroStatus,
    }),
  };
}

async function loadTwinName(
  db: AppDependencies["db"],
  twinId: string,
): Promise<string | null> {
  const [twin] = await db
    .select({ name: twins.name })
    .from(twins)
    .where(eq(twins.id, twinId))
    .limit(1);

  return twin?.name ?? null;
}

function buildIdentityProfileEvents(input: {
  twinId: string;
  twinName: string | null | undefined;
  profileRecord: Record<string, unknown>;
  onboardingStatus: OnboardingStatus;
  firstMeetIntroStatus: FirstMeetIntroStatus;
}): TwinRuntimeEvent[] {
  if (
    input.onboardingStatus !== "completed" ||
    input.firstMeetIntroStatus !== "issued"
  ) {
    return [];
  }

  const twinName = optionalTrimmedString(input.twinName) ?? "your Twin";
  const displayName = optionalTrimmedString(
    readProfileField(input.profileRecord, "displayName", "display_name"),
  );

  return [
    {
      type: "first_meet_intro.requested",
      eventId: `${input.twinId}:first-meet-intro`,
      dedupeKey: `${input.twinId}:first-meet-intro`,
      text: buildOnboardingGreeting(twinName, displayName ?? ""),
      voiceStyle: "energetic",
    },
  ];
}

function buildOnboardingGreeting(twinName: string, userName: string) {
  const trimmedName = userName.trim();
  const hello = trimmedName ? `Hi ${trimmedName}! ` : "";

  return `${hello}I'm ${twinName}. It's really good to finally meet you. I've got your first memory now, and I'm ready to start learning your world with you.`;
}

function readOnboardingStatus(value: unknown): OnboardingStatus | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "not_started" ||
    value === "in_progress" ||
    value === "completed"
  ) {
    return value;
  }

  return null;
}

function readFirstMeetIntroStatus(value: unknown): FirstMeetIntroStatus | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "not_started" ||
    value === "issued" ||
    value === "consumed"
  ) {
    return value;
  }

  return null;
}

function defaultFirstMeetIntroStatus(
  onboardingStatus: OnboardingStatus,
): FirstMeetIntroStatus {
  return onboardingStatus === "completed" ? "consumed" : "not_started";
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const list = value
    .map((item) => optionalTrimmedString(item))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(list)).slice(0, 50);
}

function readHandles(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const handles: Record<string, string[]> = {};

  for (const [rawKey, rawValue] of entries) {
    const key = optionalTrimmedString(rawKey);

    if (!key) {
      continue;
    }

    const values = Array.isArray(rawValue)
      ? readStringList(rawValue)
      : readStringList([rawValue]);

    if (!values) {
      return null;
    }

    if (values.length > 0) {
      handles[key] = values;
    }
  }

  return handles;
}

function writeIdentityProfileAuditEvent(
  db: AppDependencies["db"],
  event: typeof auditEvents.$inferInsert,
) {
  void Promise.resolve(db.insert(auditEvents).values(event)).catch(
    (error: unknown) => {
      console.error("identity profile audit write failed", error);
    },
  );
}
