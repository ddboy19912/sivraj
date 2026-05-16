import { describe, expect, it } from "vitest";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealPolicyConfig,
} from "./index";

const policy: SealPolicyConfig = {
  packageId: "0xpackage",
  policyId: "0xpolicy",
  threshold: 1,
  keyServers: [{ objectId: "0xkeyserver", weight: 1 }],
};

describe("Seal encryption adapter", () => {
  it("encrypts with the configured policy and returns ciphertext metadata", async () => {
    const calls: unknown[] = [];
    const encryptor = createSealEncryptor({
      suiClient: {} as never,
      policy,
      client: {
        async encrypt(input) {
          calls.push(input);
          return { encryptedObject: new Uint8Array([1, 2, 3]) };
        },
      },
    });

    const result = await encryptor.encrypt({
      data: new TextEncoder().encode("private memory"),
    });

    expect(calls).toEqual([
      {
        threshold: 1,
        packageId: "0xpackage",
        id: "0xpolicy",
        data: new TextEncoder().encode("private memory"),
        aad: undefined,
      },
    ]);
    expect(result).toMatchObject({
      encryptedBytes: new Uint8Array([1, 2, 3]),
      ciphertextSha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      packageId: "0xpackage",
      policyId: "0xpolicy",
      threshold: 1,
      keyServerObjectIds: ["0xkeyserver"],
    });
  });

  it("parses comma-separated key servers", () => {
    expect(parseSealKeyServers("0xone, 0xtwo")).toEqual([
      { objectId: "0xone", weight: 1 },
      { objectId: "0xtwo", weight: 1 },
    ]);
  });

  it("parses JSON key servers", () => {
    expect(
      parseSealKeyServers(
        '[{"objectId":"0xone","weight":2,"aggregatorUrl":"https://seal.example"}]',
      ),
    ).toEqual([
      { objectId: "0xone", weight: 2, aggregatorUrl: "https://seal.example" },
    ]);
  });

  it("rejects impossible threshold config", () => {
    expect(() =>
      assertSealPolicyConfig({
        ...policy,
        threshold: 2,
      }),
    ).toThrow("Seal threshold cannot exceed total key server weight");
  });
});
