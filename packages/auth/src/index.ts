import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

export type AuthSubjectType = "user" | "client" | "agent" | "service";

export type AuthClaims = {
  sub: string;
  type: AuthSubjectType;
  scopes: string[];
  twinId?: string;
  clientId?: string;
  walletAddress?: string;
};

export type ChallengeClaims = {
  nonce: string;
  message: string;
};

export type AuthConfig = {
  jwtSecret: string;
  tokenIssuer: string;
};

export type VerifiedWallet = {
  address: string;
  message: string;
};

const textEncoder = new TextEncoder();

export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function hasScope(claims: AuthClaims, scope: string): boolean {
  return claims.scopes.includes(scope);
}

export function assertScope(claims: AuthClaims, scope: string): void {
  if (!hasScope(claims, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

export async function signSessionToken(
  claims: AuthClaims,
  config: AuthConfig,
  expiresIn = "1h",
): Promise<string> {
  return new SignJWT({
    type: claims.type,
    scopes: claims.scopes,
    twinId: claims.twinId,
    clientId: claims.clientId,
    walletAddress: claims.walletAddress,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(config.tokenIssuer)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(config.jwtSecret));
}

export async function verifySessionToken(
  token: string,
  config: AuthConfig,
): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, secretKey(config.jwtSecret), {
    issuer: config.tokenIssuer,
  });

  const sub = payload.sub;
  const type = payload["type"];
  const scopes = payload["scopes"];

  if (!sub || !isSubjectType(type) || !Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) {
    throw new Error("Invalid auth token claims");
  }

  return {
    sub,
    type,
    scopes,
    twinId: stringClaim(payload["twinId"]),
    clientId: stringClaim(payload["clientId"]),
    walletAddress: stringClaim(payload["walletAddress"]),
  };
}

export async function createWalletChallenge(
  config: AuthConfig,
  walletAddress?: string,
): Promise<ChallengeClaims & { challengeToken: string }> {
  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const addressLine = walletAddress ? `Wallet: ${walletAddress}` : "Wallet: unknown";
  const message = [
    "Sign in to Sivraj",
    addressLine,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");

  const challengeToken = await new SignJWT({ nonce, message })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(config.tokenIssuer)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey(config.jwtSecret));

  return { nonce, message, challengeToken };
}

export async function verifyWalletChallenge(params: {
  config: AuthConfig;
  challengeToken: string;
  message: string;
  signature: string;
  walletAddress: string;
  suiClient?: ClientWithCoreApi;
}): Promise<VerifiedWallet> {
  const { payload } = await jwtVerify(params.challengeToken, secretKey(params.config.jwtSecret), {
    issuer: params.config.tokenIssuer,
  });

  if (payload["message"] !== params.message) {
    throw new Error("Challenge message mismatch");
  }

  const publicKey = await verifyPersonalMessageSignature(
    textEncoder.encode(params.message),
    params.signature,
    {
      address: params.walletAddress,
      client: params.suiClient,
    },
  );

  const address = publicKey.toSuiAddress();

  if (address.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw new Error("Wallet address mismatch");
  }

  return { address, message: params.message };
}

export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const jwtSecret = env["JWT_SECRET"];

  if (!jwtSecret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }

  return {
    jwtSecret,
    tokenIssuer: env["TOKEN_ISSUER"] || "sivraj",
  };
}

function secretKey(secret: string): Uint8Array {
  return textEncoder.encode(secret);
}

function isSubjectType(value: unknown): value is AuthSubjectType {
  return value === "user" || value === "client" || value === "agent" || value === "service";
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
