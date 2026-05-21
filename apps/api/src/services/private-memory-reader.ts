import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  createSealDecryptor,
  parseSealKeyServers,
  type SealDecryptor,
} from "@sivraj/crypto-seal";
import { createWalrusReader, type WalrusReader } from "@sivraj/storage-walrus";

type PrivateMemoryReaderConfig = {
  suiRpcUrl: string;
  suiPrivateKey: string;
  suiNetwork: "mainnet" | "testnet" | "devnet" | "localnet";
  sealPackageId: string;
  sealPolicyId: string;
  sealKeyServers: string;
  sealThreshold: number;
};

export type PrivateMemoryReader = {
  readPrivateMemory(input: {
    rawStorageRef: string;
    artifactId: string;
    twinId: string;
  }): Promise<string>;
};

export function createPrivateMemoryReader(params: {
  walrus: WalrusReader;
  seal: SealDecryptor;
}): PrivateMemoryReader {
  const decoder = new TextDecoder();

  return {
    async readPrivateMemory(input) {
      const encryptedBytes = await params.walrus.read({
        rawStorageRef: input.rawStorageRef,
      });
      const decrypted = await params.seal.decrypt({ encryptedBytes });

      return decoder.decode(decrypted.plaintext);
    },
  };
}

export function createConfiguredPrivateMemoryReader(
  env: Record<string, string | undefined>,
): PrivateMemoryReader | undefined {
  const config = readPrivateMemoryReaderConfig(env);

  if (!config) {
    return undefined;
  }

  const suiClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  });
  const signer = Ed25519Keypair.fromSecretKey(config.suiPrivateKey);
  const keyServers = parseSealKeyServers(config.sealKeyServers);

  return createPrivateMemoryReader({
    walrus: createWalrusReader({
      config: {
        network: config.suiNetwork,
        rpcUrl: config.suiRpcUrl,
      },
    }),
    seal: createSealDecryptor({
      suiClient,
      signer,
      policy: {
        packageId: config.sealPackageId,
        policyId: config.sealPolicyId,
        threshold: config.sealThreshold,
        keyServers,
      },
    }),
  });
}

function readPrivateMemoryReaderConfig(
  env: Record<string, string | undefined>,
): PrivateMemoryReaderConfig | undefined {
  const suiRpcUrl = env["SUI_RPC_URL"];
  const suiPrivateKey = env["SUI_PRIVATE_KEY"];
  const sealPackageId = env["SEAL_PACKAGE_ID"];
  const sealPolicyId = env["SEAL_POLICY_ID"];
  const sealKeyServers = env["SEAL_KEY_SERVERS"];

  if (
    !suiRpcUrl ||
    !suiPrivateKey ||
    !sealPackageId ||
    !sealPolicyId ||
    !sealKeyServers
  ) {
    return undefined;
  }

  return {
    suiRpcUrl,
    suiPrivateKey,
    suiNetwork: readSuiNetwork(env["SUI_NETWORK"]),
    sealPackageId,
    sealPolicyId,
    sealKeyServers,
    sealThreshold: readInteger(env["SEAL_THRESHOLD"], 1),
  };
}

function readSuiNetwork(
  value: string | undefined,
): PrivateMemoryReaderConfig["suiNetwork"] {
  if (
    value === "mainnet" ||
    value === "testnet" ||
    value === "devnet" ||
    value === "localnet"
  ) {
    return value;
  }

  return "testnet";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
