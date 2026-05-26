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
    metadata: publicArtifactMetadata(input.metadata),
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

export async function buildClientEncryptedAgentWritebackBody(input: {
  twinId: string
  agentName: string
  repo: string
  branch: string
  taskSummary: string
  filesTouched: string[]
  commandsRun: string[]
  testsRun: string[]
  decisions: string[]
  bugsFound: string[]
  followUps: string[]
  userCorrections: string[]
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

  const metadata = {
    uploadKind: 'agent_writeback',
    importer: 'sivraj_web_test_console',
    agentName: input.agentName,
    repo: input.repo || null,
    branch: input.branch || null,
    storageMode: 'encrypted_walrus',
    sensitivity: 'private',
  }
  const content = formatAgentWriteback(input)
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: 'source_artifact',
      version: 1,
      title: `Coding agent writeback: ${input.agentName}`,
      content,
      metadata,
    }),
  )
  const aad = new TextEncoder().encode(
    JSON.stringify({
      twinId: input.twinId,
      sourceType: 'note',
      kind: 'source_artifact',
      version: 1,
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
    agentName: input.agentName,
    repo: input.repo || undefined,
    branch: input.branch || undefined,
    taskSummarySha256: await sha256Text(input.taskSummary),
    counts: {
      filesTouched: input.filesTouched.length,
      commandsRun: input.commandsRun.length,
      testsRun: input.testsRun.length,
      decisions: input.decisions.length,
      bugsFound: input.bugsFound.length,
      followUps: input.followUps.length,
      userCorrections: input.userCorrections.length,
    },
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

function formatAgentWriteback(input: {
  agentName: string
  repo: string
  branch: string
  taskSummary: string
  filesTouched: string[]
  commandsRun: string[]
  testsRun: string[]
  decisions: string[]
  bugsFound: string[]
  followUps: string[]
  userCorrections: string[]
}) {
  const lines = [
    '# Coding Agent Writeback',
    '',
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo || 'unknown'}`,
    `Branch: ${input.branch || 'unknown'}`,
    '',
    '## Task Summary',
    input.taskSummary,
  ]

  pushList(lines, 'Files Touched', input.filesTouched)
  pushList(lines, 'Commands Run', input.commandsRun)
  pushList(lines, 'Tests Run', input.testsRun)
  pushList(lines, 'Decisions', input.decisions)
  pushList(lines, 'Bugs Found', input.bugsFound)
  pushList(lines, 'Follow Ups', input.followUps)
  pushList(lines, 'User Corrections', input.userCorrections)

  return `${lines.join('\n')}\n`
}

function pushList(lines: string[], title: string, values: string[]) {
  if (values.length > 0) {
    lines.push('', `## ${title}`, ...values.map((value) => `- ${value}`))
  }
}

function publicArtifactMetadata(metadata: Record<string, unknown>) {
  const blockedKeys = new Set(['fileName', 'filename', 'file_name', 'file', 'path', 'sourceFile', 'source_file', 'title', 'content', 'text', 'body', 'summary', 'transcript'])
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !blockedKeys.has(key)),
  )
}

async function sha256Text(value: string) {
  return sha256Hex(new TextEncoder().encode(value))
}

export type { SourceType }
