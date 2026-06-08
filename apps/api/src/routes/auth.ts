import { createHash, randomBytes } from "node:crypto";
import {
  FIRST_PARTY_USER_SCOPES,
  createWalletChallenge,
  loadAuthConfig,
  signSessionToken,
  verifyWalletChallenge,
} from "@sivraj/auth";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { refreshSessions, twins, users, walletAccounts } from "@sivraj/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { getSuiAuthClient } from "../sui-client.js";
import { requiredString, type JsonObjectBodyResult } from "../lib/http/route-helpers.js";

const ACCESS_TOKEN_TTL = "15m";
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthRoutes({ db }: AppDependencies) {
  const authRoutes = new Hono();

  authRoutes.post("/challenge", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const walletAddress = optionalString(body["walletAddress"]);
    const authConfig = readAuthConfig();

    if (!authConfig) {
      return c.json({ error: "auth_not_configured" }, 503);
    }

    const challenge = await createWalletChallenge(authConfig, walletAddress);

    return c.json(challenge);
  });

  authRoutes.post("/verify", async (c) => handleWalletVerify(c, db));
  authRoutes.post("/refresh", async (c) => handleTokenRefresh(c, db));

  return authRoutes;
}

async function parseAuthJsonBody(c: Context): Promise<JsonObjectBodyResult> {
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: c.json({ error: "invalid_json_body" }, 400) };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

async function handleWalletVerify(c: Context, db: AppDependencies["db"]) {
  const parsedBody = await parseAuthJsonBody(c);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const credentials = readWalletCredentials(parsedBody.body);

  if (!credentials.ok) {
    return c.json({ error: credentials.error }, 400);
  }

  const authConfig = readAuthConfig();

  if (!authConfig) {
    return c.json({ error: "auth_not_configured" }, 503);
  }

  try {
    const wallet = await verifyWalletChallenge({
      config: authConfig,
      challengeToken: credentials.value.challengeToken,
      message: credentials.value.message,
      signature: credentials.value.signature,
      walletAddress: credentials.value.walletAddress,
      suiClient: getSuiAuthClient(process.env),
    });

    const user = await upsertWalletUser(db, wallet.address);
    const twin = await ensureTwin(db, user.id);
    const session = await createApiSession({
      db,
      authConfig,
      userId: user.id,
      twinId: twin.id,
      walletAddress: wallet.address,
      now: new Date(),
    });

    return c.json({
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      userId: user.id,
      twinId: twin.id,
      walletAddress: wallet.address,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    if (process.env["NODE_ENV"] !== "production") {
      console.warn("wallet verification failed:", reason);
    }

    return c.json(
      {
        error: "wallet_verification_failed",
        ...(process.env["NODE_ENV"] !== "production" ? { reason } : {}),
      },
      401,
    );
  }
}

async function handleTokenRefresh(c: Context, db: AppDependencies["db"]) {
  const parsedBody = await parseAuthJsonBody(c);

  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const refreshToken = requiredString(parsedBody.body["refreshToken"]);
  const walletAddressInput = requiredString(parsedBody.body["walletAddress"]);
  const walletAddress = walletAddressInput
    ? normalizeSuiAddress(walletAddressInput)
    : "";

  if (!refreshToken || !walletAddress) {
    return c.json({ error: "missing_required_refresh_fields" }, 400);
  }

  const authConfig = readAuthConfig();

  if (!authConfig) {
    return c.json({ error: "auth_not_configured" }, 503);
  }

  const now = new Date();
  const session = await findActiveRefreshSession(db, refreshToken, walletAddress, now);

  if (!session) {
    return c.json({ error: "invalid_refresh_token" }, 401);
  }

  const revoked = await revokeRefreshSession(db, session.id, now);

  if (!revoked) {
    return c.json({ error: "invalid_refresh_token" }, 401);
  }

  const nextSession = await createApiSession({
    db,
    authConfig,
    userId: session.userId,
    twinId: session.twinId,
    walletAddress: session.walletAddress,
    now,
    scopes: session.scopes,
  });

  return c.json({
    token: nextSession.token,
    refreshToken: nextSession.refreshToken,
    expiresAt: nextSession.expiresAt.toISOString(),
    userId: session.userId,
    twinId: session.twinId,
    walletAddress: session.walletAddress,
  });
}

function readWalletCredentials(body: Record<string, unknown>) {
  const walletAddressInput = requiredString(body["walletAddress"]);
  const walletAddress = walletAddressInput
    ? normalizeSuiAddress(walletAddressInput)
    : "";
  const message = requiredString(body["message"]);
  const signature = requiredString(body["signature"]);
  const challengeToken = requiredString(body["challengeToken"]);

  if (!walletAddress || !message || !signature || !challengeToken) {
    return { ok: false as const, error: "missing_required_auth_fields" };
  }

  return {
    ok: true as const,
    value: {
      walletAddress,
      message,
      signature,
      challengeToken,
    },
  };
}

async function findActiveRefreshSession(
  db: AppDependencies["db"],
  refreshToken: string,
  walletAddress: string,
  now: Date,
) {
  const [session] = await db
    .select()
    .from(refreshSessions)
    .where(
      and(
        eq(refreshSessions.tokenHash, hashRefreshToken(refreshToken)),
        eq(refreshSessions.walletAddress, walletAddress),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, now),
      ),
    )
    .limit(1);

  return session ?? null;
}

async function revokeRefreshSession(
  db: AppDependencies["db"],
  sessionId: string,
  now: Date,
) {
  const revokedSessions = await db
    .update(refreshSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(refreshSessions.id, sessionId), isNull(refreshSessions.revokedAt)))
    .returning({ id: refreshSessions.id });

  return revokedSessions.length > 0;
}

async function createApiSession(input: {
  db: AppDependencies["db"];
  authConfig: NonNullable<ReturnType<typeof readAuthConfig>>;
  userId: string;
  twinId: string;
  walletAddress: string;
  now: Date;
  scopes?: string[];
}) {
  const scopes =
    input.scopes && input.scopes.length > 0
      ? input.scopes
      : [...FIRST_PARTY_USER_SCOPES];
  const expiresAt = new Date(input.now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshToken = createRefreshToken();
  const refreshExpiresAt = new Date(input.now.getTime() + REFRESH_TOKEN_TTL_MS);
  const token = await signSessionToken(
    {
      sub: input.userId,
      type: "user",
      scopes,
      twinId: input.twinId,
      walletAddress: input.walletAddress,
    },
    input.authConfig,
    ACCESS_TOKEN_TTL,
  );

  await input.db.insert(refreshSessions).values({
    userId: input.userId,
    twinId: input.twinId,
    walletAddress: input.walletAddress,
    tokenHash: hashRefreshToken(refreshToken),
    scopes,
    expiresAt: refreshExpiresAt,
  });

  return {
    token,
    refreshToken,
    expiresAt,
  };
}

async function upsertWalletUser(db: AppDependencies["db"], address: string) {
  const existing = await db
    .select({ userId: walletAccounts.userId })
    .from(walletAccounts)
    .where(
      and(eq(walletAccounts.chain, "sui"), eq(walletAccounts.address, address)),
    )
    .limit(1);

  if (existing[0]) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing[0].userId))
      .limit(1);

    if (user) {
      return user;
    }
  }

  const [user] = await db
    .insert(users)
    .values({ displayName: "Sivraj User" })
    .returning();

  await db.insert(walletAccounts).values({
    userId: user.id,
    chain: "sui",
    address,
    isPrimary: true,
  });

  return user;
}

async function ensureTwin(db: AppDependencies["db"], userId: string) {
  const [existing] = await db
    .select()
    .from(twins)
    .where(eq(twins.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [twin] = await db
    .insert(twins)
    .values({ userId, name: "Primary Twin" })
    .returning();

  return twin;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readAuthConfig() {
  try {
    return loadAuthConfig(process.env);
  } catch {
    return null;
  }
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
