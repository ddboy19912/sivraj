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
  | 'browser_history'

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

function readSuiNetwork(value: unknown): 'mainnet' | 'testnet' | 'devnet' | 'localnet' {
  return value === 'mainnet' || value === 'devnet' || value === 'localnet' ? value : 'testnet'
}

function parseClientSealKeyServers(value: string): KeyServerConfig[] {
  const trimmed = value.trim()

  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error('Client Seal key servers must be a JSON array or comma-separated object IDs.')
    }

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return { objectId: item, weight: 1 }
        }

        if (item && typeof item === 'object') {
          const objectId = (item as { objectId?: unknown }).objectId
          const weight = (item as { weight?: unknown }).weight

          if (typeof objectId === 'string') {
            return {
              objectId,
              weight: typeof weight === 'number' ? weight : 1,
            }
          }
        }

        throw new Error('Invalid client Seal key server config.')
      })
      .filter((server) => server.objectId.length > 0)
  }

  return trimmed
    .split(',')
    .map((objectId) => ({
      objectId: objectId.trim(),
      weight: 1,
    }))
    .filter((server) => server.objectId.length > 0)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }

  return btoa(binary)
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildClientEncryptedArtifactBody(input: {
  sourceType: SourceType
  title: string | null
  content: string
  metadata: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const config = readClientEncryptionConfig()
  const keyServers = parseClientSealKeyServers(config.sealKeyServers)

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

  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: 'source_artifact',
      version: 1,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
    }),
  )
  const aad = new TextEncoder().encode(
    JSON.stringify({
      sourceType: input.sourceType,
      kind: 'source_artifact',
      version: 1,
      encryptionBoundary: 'client',
    }),
  )
  const suiClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  })
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: keyServers,
  })
  const { encryptedObject } = await sealClient.encrypt({
    threshold: config.sealThreshold,
    packageId: config.sealPackageId,
    id: config.sealPolicyId,
    data: payloadBytes,
    aad,
  })

  return {
    sourceType: input.sourceType,
    encryptedPayload: {
      ciphertextBase64: bytesToBase64(encryptedObject),
      ciphertextSha256: await sha256Hex(encryptedObject),
      seal: {
        packageId: config.sealPackageId,
        policyId: config.sealPolicyId,
        threshold: config.sealThreshold,
        keyServerObjectIds: keyServers.map((server) => server.objectId),
      },
    },
  }
}

export type { SourceType }
