import { ConsoleInfoPanel, ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { AgentWritebackCreateForm } from '@/console/pages/agent-writebacks/AgentWritebackCreateForm'
import { AgentWritebacksTable } from '@/console/pages/agent-writebacks/AgentWritebacksTable'
import { AgentWritebacksToolbar } from '@/console/pages/agent-writebacks/AgentWritebacksToolbar'
import { useAgentWritebacks } from '@/console/pages/agent-writebacks/use-agent-writebacks'

export function AgentWritebacksPage() {
  const writebacks = useAgentWritebacks()

  return (
    <ConsolePage title="Agent writeback review">
      <ConsoleInfoPanel
        items={[
          {
            term: 'Purpose',
            detail:
              'Review encrypted coding-agent session summaries before they enter Sivraj ingestion.',
          },
          {
            term: 'Privacy boundary',
            detail:
              'The table shows hashes, counts, and storage refs. It does not decrypt or display the raw writeback body.',
          },
        ]}
      />

      <AgentWritebackCreateForm
        agentToken={writebacks.agentToken}
        agentName={writebacks.agentName}
        repo={writebacks.repo}
        branch={writebacks.branch}
        taskSummary={writebacks.taskSummary}
        filesTouched={writebacks.filesTouched}
        commandsRun={writebacks.commandsRun}
        testsRun={writebacks.testsRun}
        decisions={writebacks.decisions}
        bugsFound={writebacks.bugsFound}
        followUps={writebacks.followUps}
        userCorrections={writebacks.userCorrections}
        isSubmitting={writebacks.isSubmitting}
        onAgentTokenChange={writebacks.setAgentToken}
        onAgentNameChange={writebacks.setAgentName}
        onRepoChange={writebacks.setRepo}
        onBranchChange={writebacks.setBranch}
        onTaskSummaryChange={writebacks.setTaskSummary}
        onFilesTouchedChange={writebacks.setFilesTouched}
        onCommandsRunChange={writebacks.setCommandsRun}
        onTestsRunChange={writebacks.setTestsRun}
        onDecisionsChange={writebacks.setDecisions}
        onBugsFoundChange={writebacks.setBugsFound}
        onFollowUpsChange={writebacks.setFollowUps}
        onUserCorrectionsChange={writebacks.setUserCorrections}
        onSubmit={() => void writebacks.createEncryptedWriteback()}
      />

      <AgentWritebacksToolbar
        statusFilter={writebacks.statusFilter}
        isLoading={writebacks.isLoading}
        onStatusFilterChange={writebacks.setStatusFilter}
        onRefresh={() => void writebacks.loadWritebacks()}
      />

      <ConsoleStatus status={writebacks.status} />
      <AgentWritebacksTable
        rows={writebacks.rows}
        isSubmitting={writebacks.isSubmitting}
        onApprove={(id) => void writebacks.approveWriteback(id)}
        onReject={(id) => void writebacks.rejectWriteback(id)}
      />
    </ConsolePage>
  )
}
