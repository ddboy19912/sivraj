import type { ComponentType } from 'react'
import { ApiGuidePage } from '@/console/pages/ApiGuidePage'
import { AgentContextPage } from '@/console/pages/AgentContextPage'
import { AgentPermissionsPage } from '@/console/pages/AgentPermissionsPage'
import { AgentWritebacksPage } from '@/console/pages/AgentWritebacksPage'
import { ArtifactStatusPage } from '@/console/pages/ArtifactStatusPage'
import { CandidateMemoriesPage } from '@/console/pages/CandidateMemoriesPage'
import { ConnectorsPage } from '@/console/pages/ConnectorsPage'
import { EngineeringSourcesPage } from '@/console/pages/EngineeringSourcesPage'
import { EngineeringReviewPage } from '@/console/pages/EngineeringReviewPage'
import { GraphPage } from '@/console/pages/GraphPage'
import { IngestPage } from '@/console/pages/IngestPage'
import { InstructionPatchPage } from '@/console/pages/InstructionPatchPage'
import { PrivacyPage } from '@/console/pages/PrivacyPage'
import { ReflectionsPage } from '@/console/pages/ReflectionsPage'
import { RetrievalPage } from '@/console/pages/RetrievalPage'
import type { ConsolePage } from '@/types/console.types'

const CONSOLE_PAGE_COMPONENTS: Record<ConsolePage, ComponentType> = {
  ingest: IngestPage,
  'artifact-status': ArtifactStatusPage,
  retrieval: RetrievalPage,
  'candidate-memories': CandidateMemoriesPage,
  'agent-permissions': AgentPermissionsPage,
  'agent-writebacks': AgentWritebacksPage,
  'agent-context': AgentContextPage,
  'engineering-review': EngineeringReviewPage,
  'instruction-patch': InstructionPatchPage,
  'engineering-sources': EngineeringSourcesPage,
  graph: GraphPage,
  reflections: ReflectionsPage,
  connectors: ConnectorsPage,
  privacy: PrivacyPage,
  'api-guide': ApiGuidePage,
}

export function ConsolePageContent({ page }: { page: ConsolePage }) {
  const PageComponent = CONSOLE_PAGE_COMPONENTS[page]
  return <PageComponent />
}
