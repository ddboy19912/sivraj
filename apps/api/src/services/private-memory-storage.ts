import { TextEncoder } from "node:util";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import { type EnvSource, loadConfig } from "@sivraj/config";
import { createWalrusStorage, type WalrusStorage } from "@sivraj/storage-walrus";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import type {
  PrivateMemoryStorage,
  PrivateMemoryStorageInput,
  PrivateMemoryStorageOutput,
} from "../app.js";

const textEncoder = new TextEncoder();

export function createPrivateMemoryStorage(env: EnvSource): PrivateMemoryStorage {
  let service: PrivateMemoryStorage | null = null;

  return {
    async storePrivateMemory(input) {
      service ??= createConfiguredPrivateMemoryStorage(env);
      return service.storePrivateMemory(input);
    },
  };
}

export function createPrivateMemoryStorageService(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
}): PrivateMemoryStorage {
  return {
    async storePrivateMemory(input) {
      const plaintextBytes = textEncoder.encode(input.content);
      const aad = textEncoder.encode(JSON.stringify({
        twinId: input.twinId,
        sourceType: input.sourceType,
        title: input.title,
      }));
      const encrypted = await params.seal.encrypt({
        data: plaintextBytes,
        aad,
      });
      const stored = await params.walrus.store({
        bytes: encrypted.encryptedBytes,
        attributes: {
          twinId: input.twinId,
          sourceType: input.sourceType,
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          ciphertextSha256: encrypted.ciphertextSha256,
        },
      });

      return {
        rawStorageRef: stored.rawStorageRef,
        ciphertextSha256: encrypted.ciphertextSha256,
        seal: {
          packageId: encrypted.packageId,
          policyId: encrypted.policyId,
          threshold: encrypted.threshold,
          keyServerObjectIds: encrypted.keyServerObjectIds,
        },
        walrus: {
          blobId: stored.blobId,
          blobObjectId: stored.blobObjectId,
          startEpoch: stored.startEpoch,
          endEpoch: stored.endEpoch,
          size: stored.size,
        },
      } satisfies PrivateMemoryStorageOutput;
    },
  };
}

function createConfiguredPrivateMemoryStorage(env: EnvSource): PrivateMemoryStorage {
  const config = loadConfig(env);
  const policy: SealPolicyConfig = {
    packageId: config.seal.packageId,
    policyId: config.seal.policyId,
    threshold: config.seal.threshold,
    keyServers: parseSealKeyServers(config.seal.keyServers),
  };

  assertSealPolicyConfig(policy);

  const suiClient = new SuiGrpcClient({
    network: config.sui.network,
    baseUrl: config.sui.rpcUrl,
  });

  return createPrivateMemoryStorageService({
    seal: createSealEncryptor({
      suiClient,
      policy,
    }),
    walrus: createWalrusStorage({
      config: {
        network: config.walrus.network as "mainnet" | "testnet" | "devnet" | "localnet",
        rpcUrl: config.sui.rpcUrl,
        privateKey: config.sui.privateKey,
        epochs: config.walrus.epochs,
        deletable: config.walrus.deletable,
      },
    }),
  });
}
