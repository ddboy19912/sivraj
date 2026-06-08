import { beforeEach, describe, it } from 'vitest'
import { resetAuthenticatedConsoleSession } from '@/tests/fixtures/console-fixtures'
import {
  runAgentContextScenario,
  runAgentPermissionsRevokeScenario,
  runAgentWritebacksApproveScenario,
  runAiChatDuplicateImportScenario,
  runBrowserHistoryIngestScenario,
  runCandidateFeedbackScenario,
  runConsoleIngestSubmitScenario,
  runConsoleNavigationScenario,
  runEngineeringReviewScenario,
  runEngineeringSourcesScenario,
  runInstructionPatchScenario,
  runPrivacyCheckScenario,
  runRetrievalSearchScenario,
  runWalletGateScenario,
} from '@/console/console-test-scenarios'

describe('Console navigation', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('renders console navigation pages', () => runConsoleNavigationScenario(), 10_000)
})

describe('Agent permissions', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('shows coding-agent permission grants and can revoke a grant', () => runAgentPermissionsRevokeScenario())
})

describe('Agent writebacks', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('shows encrypted agent writebacks and approves one into ingestion', () => runAgentWritebacksApproveScenario())
})

describe('Console ingest', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('submits ingestion from the console and stores shared artifact state', () => runConsoleIngestSubmitScenario())
  it('preserves explicit browser history source for generic export filenames', () => runBrowserHistoryIngestScenario())
  it('reviews AI chat imports and shows duplicate skips', () => runAiChatDuplicateImportScenario())
})

describe('Console retrieval', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('loads retrieval results from the memory search API', () => runRetrievalSearchScenario())
})

describe('Console candidates', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('sends candidate feedback approve actions', () => runCandidateFeedbackScenario())
})

describe('Agent context', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('loads coding agent context and renders copyable markdown', () => runAgentContextScenario())
})

describe('Instruction review', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('loads engineering review issues and submits a review action', () => runEngineeringReviewScenario())
})

describe('Instruction patch', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('generates instruction patch suggestions for repo agent files', () => runInstructionPatchScenario())
})

describe('Instruction sources', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('shows engineering instruction sources and extracted memories', () => runEngineeringSourcesScenario())
})

describe('Privacy check', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('renders privacy checklist pass and fail states', () => runPrivacyCheckScenario())
})

describe('Console wallet gate', () => {
  beforeEach(() => resetAuthenticatedConsoleSession())
  it('shows the global wallet gate instead of mounting console when wallet session is missing', () => runWalletGateScenario())
})
