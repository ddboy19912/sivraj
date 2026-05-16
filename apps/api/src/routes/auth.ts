import { createWalletChallenge, loadAuthConfig, signSessionToken, verifyWalletChallenge } from "@sivraj/auth";
import { apiClients, twins, users, walletAccounts } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDependencies } from "../app.js";

export function createAuthRoutes({ db }: AppDependencies) {
  const authRoutes = new Hono();

  authRoutes.post("/challenge", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const walletAddress = optionalString(body["walletAddress"]);
  const challenge = await createWalletChallenge(loadAuthConfig(process.env), walletAddress);

  return c.json(challenge);
  });

  authRoutes.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid_json_body" }, 400);
  }

  const walletAddress = requiredString(body["walletAddress"]);
  const message = requiredString(body["message"]);
  const signature = requiredString(body["signature"]);
  const challengeToken = requiredString(body["challengeToken"]);

  if (!walletAddress || !message || !signature || !challengeToken) {
    return c.json({ error: "missing_required_auth_fields" }, 400);
  }

  try {
    const wallet = await verifyWalletChallenge({
      config: loadAuthConfig(process.env),
      challengeToken,
      message,
      signature,
      walletAddress,
    });

    const user = await upsertWalletUser(db, wallet.address);
    const twin = await ensureTwin(db, user.id);
    const token = await signSessionToken(
      {
        sub: user.id,
        type: "user",
        scopes: ["artifact:upload"],
        twinId: twin.id,
        walletAddress: wallet.address,
      },
      loadAuthConfig(process.env),
    );

    return c.json({
      token,
      userId: user.id,
      twinId: twin.id,
      walletAddress: wallet.address,
    });
  } catch {
    return c.json({ error: "wallet_verification_failed" }, 401);
  }
  });

  return authRoutes;
}

async function upsertWalletUser(db: AppDependencies["db"], address: string) {
  const existing = await db
    .select({ userId: walletAccounts.userId })
    .from(walletAccounts)
    .where(and(eq(walletAccounts.chain, "sui"), eq(walletAccounts.address, address)))
    .limit(1);

  if (existing[0]) {
    const [user] = await db.select().from(users).where(eq(users.id, existing[0].userId)).limit(1);

    if (user) {
      return user;
    }
  }

  const [user] = await db.insert(users).values({ displayName: "Sivraj User" }).returning();

  await db.insert(walletAccounts).values({
    userId: user.id,
    chain: "sui",
    address,
    isPrimary: true,
  });

  return user;
}

async function ensureTwin(db: AppDependencies["db"], userId: string) {
  const [existing] = await db.select().from(twins).where(eq(twins.userId, userId)).limit(1);

  if (existing) {
    return existing;
  }

  const [twin] = await db.insert(twins).values({ userId, name: "Primary Twin" }).returning();

  return twin;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
