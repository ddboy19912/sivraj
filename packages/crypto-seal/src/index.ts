import { createHash } from "node:crypto";
import {
  EncryptedObject,
  SealClient,
  SessionKey,
  type KeyServerConfig,
  type SealCompatibleClient,
} from "@mysten/seal";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import type { Signer } from "@mysten/sui/cryptography";

export type SealPolicyConfig = {
  packageId: string;
  policyId: string;
  threshold: number;
  keyServers: KeyServerConfig[];
};

export type SealEncryptInput = {
  data: Uint8Array;
  aad?: Uint8Array;
};

export type SealEncryptOutput = {
  encryptedBytes: Uint8Array;
  ciphertextSha256: string;
  packageId: string;
  policyId: string;
  threshold: number;
  keyServerObjectIds: string[];
};

export type SealEncryptor = {
  encrypt(input: SealEncryptInput): Promise<SealEncryptOutput>;
};

export type SealDecryptInput = {
  encryptedBytes: Uint8Array;
};

export type SealDecryptOutput = {
  plaintext: Uint8Array;
  packageId: string;
  policyId: string;
  sealId: string;
};

export type SealDecryptor = {
  decrypt(input: SealDecryptInput): Promise<SealDecryptOutput>;
};

type SealEncryptClientLike = {
  encrypt(input: {
    threshold: number;
    packageId: string;
    id: string;
    data: Uint8Array;
    aad?: Uint8Array;
  }): Promise<{ encryptedObject: Uint8Array }>;
};

type SealDecryptClientLike = {
  decrypt(input: {
    data: Uint8Array;
    sessionKey: SessionKey;
    txBytes: Uint8Array;
  }): Promise<Uint8Array>;
};

export function createSealEncryptor(params: {
  suiClient: SealCompatibleClient;
  policy: SealPolicyConfig;
  client?: SealEncryptClientLike;
}): SealEncryptor {
  const client =
    params.client ??
    new SealClient({
      suiClient: params.suiClient,
      serverConfigs: params.policy.keyServers,
    });

  return {
    async encrypt(input) {
      const { encryptedObject } = await client.encrypt({
        threshold: params.policy.threshold,
        packageId: params.policy.packageId,
        id: params.policy.policyId,
        data: input.data,
        aad: input.aad,
      });

      return {
        encryptedBytes: encryptedObject,
        ciphertextSha256: sha256Hex(encryptedObject),
        packageId: params.policy.packageId,
        policyId: params.policy.policyId,
        threshold: params.policy.threshold,
        keyServerObjectIds: params.policy.keyServers.map(
          (server) => server.objectId,
        ),
      };
    },
  };
}

export function createSealDecryptor(params: {
  suiClient: SealCompatibleClient;
  signer: Signer;
  policy: SealPolicyConfig;
  client?: SealDecryptClientLike;
  ttlMin?: number;
}): SealDecryptor {
  assertSealPolicyConfig(params.policy);

  const client =
    params.client ??
    new SealClient({
      suiClient: params.suiClient,
      serverConfigs: params.policy.keyServers,
    });

  return {
    async decrypt(input) {
      const encryptedObject = EncryptedObject.parse(input.encryptedBytes);
      const sealId = normalizeHex(encryptedObject.id);
      const sessionKey = await SessionKey.create({
        address: params.signer.getPublicKey().toSuiAddress(),
        packageId: params.policy.packageId,
        ttlMin: params.ttlMin ?? 10,
        signer: params.signer,
        suiClient: params.suiClient,
      });
      const txBytes = await buildSealApprovalTxBytes({
        suiClient: params.suiClient,
        packageId: params.policy.packageId,
        policyId: params.policy.policyId,
        sealId,
      });
      const plaintext = await client.decrypt({
        data: input.encryptedBytes,
        sessionKey,
        txBytes,
      });

      return {
        plaintext,
        packageId: encryptedObject.packageId,
        policyId: params.policy.policyId,
        sealId,
      };
    },
  };
}

export async function buildSealApprovalTxBytes(params: {
  suiClient: SealCompatibleClient;
  packageId: string;
  policyId: string;
  sealId: string;
}): Promise<Uint8Array> {
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.packageId}::owner_policy::seal_approve`,
    arguments: [
      tx.pure.vector("u8", fromHex(normalizeHex(params.sealId))),
      tx.object(params.policyId),
    ],
  });

  return tx.build({
    client: params.suiClient,
    onlyTransactionKind: true,
  });
}

export function parseSealKeyServers(value: string): KeyServerConfig[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(
        "SEAL_KEY_SERVERS must be a JSON array or comma-separated object IDs",
      );
    }

    return parsed.map(parseKeyServerConfig);
  }

  return trimmed
    .split(",")
    .map((objectId) => ({
      objectId: objectId.trim(),
      weight: 1,
    }))
    .filter((server) => server.objectId.length > 0);
}

export function assertSealPolicyConfig(config: SealPolicyConfig): void {
  if (!config.packageId) {
    throw new Error("Missing required Seal package ID");
  }

  if (!config.policyId) {
    throw new Error("Missing required Seal policy ID");
  }

  if (!Number.isInteger(config.threshold) || config.threshold < 1) {
    throw new Error("Seal threshold must be a positive integer");
  }

  if (config.keyServers.length === 0) {
    throw new Error("At least one Seal key server is required");
  }

  const totalWeight = config.keyServers.reduce(
    (sum, server) => sum + server.weight,
    0,
  );

  if (config.threshold > totalWeight) {
    throw new Error("Seal threshold cannot exceed total key server weight");
  }
}

function parseKeyServerConfig(value: unknown): KeyServerConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Seal key server config");
  }

  const record = value as Record<string, unknown>;
  const objectId = stringField(record, "objectId");
  const weight = numberField(record, "weight", 1);
  const aggregatorUrl = optionalStringField(record, "aggregatorUrl");
  const apiKeyName = optionalStringField(record, "apiKeyName");
  const apiKey = optionalStringField(record, "apiKey");

  return {
    objectId,
    weight,
    ...(aggregatorUrl ? { aggregatorUrl } : {}),
    ...(apiKeyName ? { apiKeyName } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Seal key server ${key}`);
  }

  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid Seal key server ${key}`);
  }

  return value;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeHex(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}
