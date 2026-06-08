import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClientEncryptedArtifactBody,
  resetClientEncryptionRuntimeForTests,
} from "@/lib/encryption";

const sealMocks = vi.hoisted(() => ({
  encrypt: vi.fn(),
  sealConstructor: vi.fn(),
  suiConstructor: vi.fn(),
}));

vi.mock("@mysten/seal", () => ({
  SealClient: class {
    constructor(input: unknown) {
      sealMocks.sealConstructor(input);
    }

    encrypt(input: unknown) {
      return sealMocks.encrypt(input);
    }
  },
}));

vi.mock("@mysten/sui/grpc", () => ({
  SuiGrpcClient: class {
    constructor(input: unknown) {
      sealMocks.suiConstructor(input);
    }
  },
}));

describe("client encryption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_SUI_NETWORK", "testnet");
    vi.stubEnv("VITE_SUI_RPC_URL", "https://fullnode.testnet.sui.io:443");
    vi.stubEnv("VITE_SEAL_PACKAGE_ID", "0xpackage");
    vi.stubEnv("VITE_SEAL_POLICY_ID", "0xpolicy");
    vi.stubEnv("VITE_SEAL_KEY_SERVERS", "0xkeyserver");
    vi.stubEnv("VITE_SEAL_THRESHOLD", "1");
    sealMocks.encrypt.mockReset();
    sealMocks.sealConstructor.mockReset();
    sealMocks.suiConstructor.mockReset();
    resetClientEncryptionRuntimeForTests();
  });

  it("reuses the Seal runtime after first initialization", async () => {
    sealMocks.encrypt.mockResolvedValue({
      encryptedObject: new Uint8Array([1, 2, 3]),
    });

    await buildClientEncryptedArtifactBody(encryptionInput("first"));
    await buildClientEncryptedArtifactBody(encryptionInput("second"));

    expect(sealMocks.suiConstructor).toHaveBeenCalledTimes(1);
    expect(sealMocks.sealConstructor).toHaveBeenCalledTimes(1);
    expect(sealMocks.encrypt).toHaveBeenCalledTimes(2);
  });

  it("retries transient Seal key-server failures before surfacing them", async () => {
    sealMocks.encrypt
      .mockRejectedValueOnce(new Error("net::ERR_SSL_BAD_RECORD_MAC_ALERT"))
      .mockResolvedValueOnce({ encryptedObject: new Uint8Array([1, 2, 3]) });

    await expect(
      buildClientEncryptedArtifactBody(encryptionInput("retry")),
    ).resolves.toMatchObject({
      sourceType: "onboarding_self_description",
    });
    expect(sealMocks.encrypt).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient encryption failures", async () => {
    sealMocks.encrypt.mockRejectedValue(new Error("Invalid Seal policy"));

    await expect(
      buildClientEncryptedArtifactBody(encryptionInput("fail")),
    ).rejects.toThrow("Invalid Seal policy");
    expect(sealMocks.encrypt).toHaveBeenCalledTimes(1);
  });

  it("does not retry encryption configuration errors", async () => {
    vi.stubEnv("VITE_SEAL_KEY_SERVERS", "");
    resetClientEncryptionRuntimeForTests();

    await expect(
      buildClientEncryptedArtifactBody(encryptionInput("config")),
    ).rejects.toThrow("Client encryption is not configured");
    expect(sealMocks.encrypt).not.toHaveBeenCalled();
  });
});

function encryptionInput(content: string) {
  return {
    sourceType: "onboarding_self_description" as const,
    title: "Twin first memory",
    content,
    metadata: { onboarding: { kind: "first_memory" } },
  };
}
