import { describe, expect, it } from "vitest";
import {
  decodeEncryptedPayloadBytes,
  isEmptyEncryptedPayload,
  parseEncryptedPayloadFields,
  readEncryptedPayload,
  readEncryptedSeal,
} from "./encrypted-payload.js";

describe("parseEncryptedPayloadFields", () => {
  it("extracts ciphertext and seal fields", () => {
    expect(parseEncryptedPayloadFields({
      ciphertextBase64: "aGk=",
      ciphertextSha256: "a".repeat(64),
      seal: { packageId: "pkg", policyId: "pol", threshold: 1, keyServerObjectIds: ["ks1"] },
    })).toMatchObject({
      ciphertextBase64: "aGk=",
      ciphertextSha256: "a".repeat(64),
    });
  });
});

describe("isEmptyEncryptedPayload", () => {
  it("detects empty payloads", () => {
    expect(isEmptyEncryptedPayload(parseEncryptedPayloadFields({}))).toBe(true);
    expect(isEmptyEncryptedPayload(parseEncryptedPayloadFields({ ciphertextBase64: "aGk=" }))).toBe(false);
  });
});

describe("readEncryptedSeal", () => {
  it("validates seal metadata", () => {
    const fields = parseEncryptedPayloadFields({
      seal: { packageId: "pkg", policyId: "pol", threshold: 1, keyServerObjectIds: ["ks1"] },
    });
    expect(readEncryptedSeal(fields)).toMatchObject({ packageId: "pkg", threshold: 1 });
    expect(readEncryptedSeal(parseEncryptedPayloadFields({ seal: { packageId: "pkg" } }))).toBeNull();
  });
});

describe("decodeEncryptedPayloadBytes", () => {
  it("verifies ciphertext hashes", () => {
    const bytes = Buffer.from("hi");
    const base64 = bytes.toString("base64");
    const sha = "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";
    expect(decodeEncryptedPayloadBytes(base64, sha)?.toString()).toBe("hi");
    expect(decodeEncryptedPayloadBytes(base64, "deadbeef".repeat(8))).toBeNull();
  });
});

describe("readEncryptedPayload", () => {
  it("returns null for empty payloads", () => {
    expect(readEncryptedPayload({})).toBeNull();
  });

  it("rejects incomplete payloads", () => {
    expect(() => readEncryptedPayload({ ciphertextBase64: "aGk=" })).toThrow("invalid_encrypted_payload");
  });

  it("accepts valid encrypted payloads", () => {
    const bytes = Buffer.from("hi");
    const base64 = bytes.toString("base64");
    const sha = "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";
    const payload = readEncryptedPayload({
      ciphertextBase64: base64,
      ciphertextSha256: sha,
      seal: {
        packageId: "pkg",
        policyId: "pol",
        threshold: 1,
        keyServerObjectIds: ["ks1"],
      },
    });

    expect(payload?.encryptedBytes.toString()).toBe("hi");
    expect(payload?.seal.packageId).toBe("pkg");
  });
});
