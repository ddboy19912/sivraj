import {
  buildEncryptedPayloadBody,
  buildPrivateSourceArtifactAad,
  buildPrivateSourceArtifactPayload,
  encodeBytesBase64,
  parseSealKeyServers,
  readSuiNetwork,
} from '@/lib/encryption/sivraj-core'
import { SealClient, type KeyServerConfig } from '@mysten/seal'
import { SuiGrpcClient } from '@mysten/sui/grpc'

type SourceType =
  | 'note'
  | 'markdown'
  | 'upload'
  | 'pdf'
  | 'ocr_pdf'
  | 'image'
  | 'voice_note'
  | 'voice_conversation'
  | 'onboarding_self_description'
  | 'browser_history'
  | 'chat_export'

type ClientEncryptionConfig = ReturnType<typeof readClientEncryptionConfig>

type ClientEncryptionRuntime = {
  config: ClientEncryptionConfig
  keyServers: KeyServerConfig[]
  sealClient: SealClient
}

const TRANSIENT_ENCRYPTION_RETRY_DELAYS_MS = [200, 600]
const TRANSIENT_ENCRYPTION_MESSAGE =
  'Secure memory encryption had a temporary network issue. Please retry.'

let encryptionRuntime: ClientEncryptionRuntime | null = null
let encryptionRuntimePromise: Promise<ClientEncryptionRuntime> | null = null

function readClientEncryptionConfig() {
  return {
    suiNetwork: readSuiNetwork(import.meta.env.VITE_SUI_NETWORK),
    suiRpcUrl: import.meta.env.VITE_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443',
    sealPackageId: import.meta.env.VITE_SEAL_PACKAGE_ID,
    sealPolicyId: import.meta.env.VITE_SEAL_POLICY_ID,
    sealKeyServers: import.meta.env.VITE_SEAL_KEY_SERVERS ?? '',
    sealThreshold: Number.parseInt(import.meta.env.VITE_SEAL_THRESHOLD ?? '1', 10),
  }
}

export function prewarmClientEncryption(): Promise<void> {
  return getClientEncryptionRuntime().then(() => undefined)
}

export function resetClientEncryptionRuntimeForTests() {
  encryptionRuntime = null
  encryptionRuntimePromise = null
}

function getClientEncryptionRuntime(): Promise<ClientEncryptionRuntime> {
  if (encryptionRuntime) {
    return Promise.resolve(encryptionRuntime)
  }

  if (encryptionRuntimePromise) {
    return encryptionRuntimePromise
  }

  encryptionRuntimePromise = Promise.resolve().then(() => {
    const config = readClientEncryptionConfig()
    const keyServers = parseSealKeyServers(config.sealKeyServers)

    validateClientEncryptionConfig(config, keyServers)

    const suiClient = new SuiGrpcClient({
      network: config.suiNetwork,
      baseUrl: config.suiRpcUrl,
    })
    const runtime = {
      config,
      keyServers,
      sealClient: new SealClient({
        suiClient,
        serverConfigs: keyServers,
      }),
    }

    encryptionRuntime = runtime
    return runtime
  }).finally(() => {
    encryptionRuntimePromise = null
  })

  return encryptionRuntimePromise
}

function validateClientEncryptionConfig(
  config: ClientEncryptionConfig,
  keyServers: KeyServerConfig[],
) {
  if (
    !config.sealPackageId ||
    !config.sealPolicyId ||
    keyServers.length === 0 ||
    !Number.isInteger(config.sealThreshold) ||
    config.sealThreshold < 1 ||
    config.sealThreshold > keyServers.length
  ) {
    throw new Error('Client encryption is not configured. Set VITE_SEAL_PACKAGE_ID, VITE_SEAL_POLICY_ID, and VITE_SEAL_KEY_SERVERS.')
  }
}

async function sha256Hex(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const bufferConstructor = (
    globalThis as typeof globalThis & {
      Buffer?: { from: (input: Uint8Array) => Uint8Array }
    }
  ).Buffer
  const hashInput = bufferConstructor
    ? bufferConstructor.from(new Uint8Array(buffer))
    : buffer
  const digest = await crypto.subtle.digest('SHA-256', hashInput as BufferSource)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function encryptWithRetry(input: {
  runtime: ClientEncryptionRuntime
  data: Uint8Array
  aad: Uint8Array
  attempt?: number
}) {
  const attempt = input.attempt ?? 0

  try {
    return await input.runtime.sealClient.encrypt({
      threshold: input.runtime.config.sealThreshold,
      packageId: input.runtime.config.sealPackageId,
      id: input.runtime.config.sealPolicyId,
      data: input.data,
      aad: input.aad,
    })
  } catch (error) {
    const retryDelay = TRANSIENT_ENCRYPTION_RETRY_DELAYS_MS[attempt]

    if (!retryDelay || !isTransientEncryptionError(error)) {
      throw isTransientEncryptionError(error)
        ? new Error(TRANSIENT_ENCRYPTION_MESSAGE)
        : error
    }

    await wait(retryDelay)
    return encryptWithRetry({ ...input, attempt: attempt + 1 })
  }
}

function isTransientEncryptionError(error: unknown) {
  const message = errorMessage(error).toLowerCase()

  return (
    message.includes('err_ssl_bad_record_mac_alert') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('key server')
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function buildClientEncryptedPayloadBody(input: {
  plaintextBytes: Uint8Array
  aadBytes: Uint8Array
}): Promise<EncryptedPayloadBody> {
  const runtime = await getClientEncryptionRuntime()
  const { encryptedObject } = await encryptWithRetry({
    runtime,
    data: input.plaintextBytes,
    aad: input.aadBytes,
  })

  return buildEncryptedPayloadBody({
    encryptedBytes: encryptedObject,
    ciphertextSha256: await sha256Hex(encryptedObject),
    seal: {
      packageId: runtime.config.sealPackageId,
      policyId: runtime.config.sealPolicyId,
      threshold: runtime.config.sealThreshold,
      keyServerObjectIds: runtime.keyServers.map((server) => server.objectId),
    },
    encodeBase64: encodeBytesBase64,
  })
}

type EncryptedPayloadBody = ReturnType<typeof buildEncryptedPayloadBody>

export async function buildClientEncryptedArtifactBody(input: {
  sourceType: SourceType
  title: string | null
  content: string
  metadata: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify(
      buildPrivateSourceArtifactPayload({
        title: input.title,
        content: input.content,
        metadata: input.metadata,
      }),
    ),
  )
  const aad = new TextEncoder().encode(
    JSON.stringify(
      buildPrivateSourceArtifactAad({
        sourceType: input.sourceType,
        encryptionBoundary: 'client',
      }),
    ),
  )

  return {
    sourceType: input.sourceType,
    metadata: publicArtifactMetadata(input.metadata),
    encryptedPayload: await buildClientEncryptedPayloadBody({
      plaintextBytes: payloadBytes,
      aadBytes: aad,
    }),
  }
}

function publicArtifactMetadata(metadata: Record<string, unknown>) {
  const blockedKeys = new Set(['fileName', 'filename', 'file_name', 'file', 'path', 'sourceFile', 'source_file', 'title', 'content', 'text', 'body', 'summary', 'transcript'])
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !blockedKeys.has(key)),
  )
}

export type { SourceType }
