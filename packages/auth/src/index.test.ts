import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";
import {
  createWalletChallenge,
  hasScope,
  loadAuthConfig,
  parseBearerToken,
  signSessionToken,
  verifySessionToken,
  verifyWalletChallenge,
} from "./index";

const authConfig = {
  jwtSecret: "test-secret",
  tokenIssuer: "sivraj-test",
};

describe("parseBearerToken", () => {
  it("returns the bearer token", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("rejects missing and malformed headers", () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("Basic abc123")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
  });
});

describe("session tokens", () => {
  it("signs and verifies auth claims", async () => {
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
        walletAddress: "0xabc",
      },
      authConfig,
    );

    const claims = await verifySessionToken(token, authConfig);

    expect(claims).toEqual({
      sub: "user-id",
      type: "user",
      scopes: ["artifact:upload"],
      twinId: "twin-id",
      walletAddress: "0xabc",
      clientId: undefined,
    });
  });

  it("rejects the wrong issuer", async () => {
    const token = await signSessionToken(
      { sub: "user-id", type: "user", scopes: [] },
      authConfig,
    );

    await expect(
      verifySessionToken(token, { ...authConfig, tokenIssuer: "wrong" }),
    ).rejects.toThrow();
  });
});

describe("scopes", () => {
  it("checks scopes", () => {
    expect(
      hasScope(
        { sub: "user-id", type: "user", scopes: ["artifact:upload"] },
        "artifact:upload",
      ),
    ).toBe(true);
    expect(
      hasScope(
        { sub: "user-id", type: "user", scopes: ["memory:read"] },
        "artifact:upload",
      ),
    ).toBe(false);
  });
});

describe("wallet challenge", () => {
  it("verifies a real Sui personal message signature", async () => {
    const keypair = new Ed25519Keypair();
    const walletAddress = keypair.getPublicKey().toSuiAddress();
    const challenge = await createWalletChallenge(authConfig, walletAddress);
    const signed = await keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );

    const wallet = await verifyWalletChallenge({
      config: authConfig,
      challengeToken: challenge.challengeToken,
      message: challenge.message,
      signature: signed.signature,
      walletAddress,
    });

    expect(wallet.address).toBe(walletAddress);
  });

  it("rejects a mismatched wallet address", async () => {
    const keypair = new Ed25519Keypair();
    const challenge = await createWalletChallenge(authConfig);
    const signed = await keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );

    await expect(
      verifyWalletChallenge({
        config: authConfig,
        challengeToken: challenge.challengeToken,
        message: challenge.message,
        signature: signed.signature,
        walletAddress: "0x0",
      }),
    ).rejects.toThrow();
  });

  it("rejects a mismatched challenge message", async () => {
    const keypair = new Ed25519Keypair();
    const walletAddress = keypair.getPublicKey().toSuiAddress();
    const challenge = await createWalletChallenge(authConfig, walletAddress);
    const signed = await keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );

    await expect(
      verifyWalletChallenge({
        config: authConfig,
        challengeToken: challenge.challengeToken,
        message: `${challenge.message}\nchanged`,
        signature: signed.signature,
        walletAddress,
      }),
    ).rejects.toThrow();
  });
});

describe("loadAuthConfig", () => {
  it("loads auth env", () => {
    expect(
      loadAuthConfig({ JWT_SECRET: "secret", TOKEN_ISSUER: "issuer" }),
    ).toEqual({
      jwtSecret: "secret",
      tokenIssuer: "issuer",
    });
  });
});
