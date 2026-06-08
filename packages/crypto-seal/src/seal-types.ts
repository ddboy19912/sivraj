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
