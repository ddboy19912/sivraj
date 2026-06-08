import { createHash } from "node:crypto";

export type EncryptedPayload = {
  encryptedBytes: Uint8Array;
  ciphertextSha256: string;
  seal: {
    packageId: string;
    policyId: string;
    threshold: number;
    keyServerObjectIds: string[];
  };
};

export type EncryptedPayloadFields = {
  ciphertextBase64: string | null;
  ciphertextSha256: string | null;
  seal: Record<string, unknown>;
};

export function parseEncryptedPayloadFields(value: unknown): EncryptedPayloadFields {
  const payload = recordMetadata(value);

  return {
    ciphertextBase64: optionalRawString(payload["ciphertextBase64"]),
    ciphertextSha256: optionalRawString(payload["ciphertextSha256"]),
    seal: recordMetadata(payload["seal"]),
  };
}

export function isEmptyEncryptedPayload(fields: EncryptedPayloadFields): boolean {
  return !fields.ciphertextBase64 &&
    !fields.ciphertextSha256 &&
    Object.keys(fields.seal).length === 0;
}

export function readEncryptedSeal(fields: EncryptedPayloadFields): EncryptedPayload["seal"] | null {
  const packageId = optionalRawString(fields.seal["packageId"]);
  const policyId = optionalRawString(fields.seal["policyId"]);
  const threshold = typeof fields.seal["threshold"] === "number" ? fields.seal["threshold"] : null;
  const keyServerObjectIds = Array.isArray(fields.seal["keyServerObjectIds"])
    ? fields.seal["keyServerObjectIds"].filter((item): item is string => typeof item === "string")
    : [];

  if (!packageId || !policyId || keyServerObjectIds.length === 0) {
    return null;
  }

  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > keyServerObjectIds.length) {
    return null;
  }

  return {
    packageId,
    policyId,
    threshold,
    keyServerObjectIds,
  };
}

export function decodeEncryptedPayloadBytes(ciphertextBase64: string, expectedSha256: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    return null;
  }

  const encryptedBytes = Buffer.from(ciphertextBase64, "base64");

  if (encryptedBytes.length === 0 || encryptedBytes.toString("base64") !== ciphertextBase64) {
    return null;
  }

  const actualSha256 = createHash("sha256").update(encryptedBytes).digest("hex");

  if (actualSha256 !== expectedSha256.toLowerCase()) {
    return null;
  }

  return encryptedBytes;
}

export function readEncryptedPayload(value: unknown): EncryptedPayload | null {
  const fields = parseEncryptedPayloadFields(value);

  if (isEmptyEncryptedPayload(fields)) {
    return null;
  }

  if (!fields.ciphertextBase64 || !fields.ciphertextSha256) {
    throw new Error("invalid_encrypted_payload");
  }

  const seal = readEncryptedSeal(fields);

  if (!seal) {
    throw new Error("invalid_encrypted_payload");
  }

  const encryptedBytes = decodeEncryptedPayloadBytes(fields.ciphertextBase64, fields.ciphertextSha256);

  if (!encryptedBytes) {
    throw new Error("invalid_encrypted_payload");
  }

  return {
    encryptedBytes,
    ciphertextSha256: createHash("sha256").update(encryptedBytes).digest("hex"),
    seal,
  };
}

function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalRawString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
