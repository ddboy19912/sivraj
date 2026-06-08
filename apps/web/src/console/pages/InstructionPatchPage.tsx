import { ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { InstructionPatchForm } from '@/console/pages/instruction-patch/InstructionPatchForm'
import { InstructionPatchResults } from '@/console/pages/instruction-patch/InstructionPatchResults'
import { useInstructionPatchPage } from '@/console/pages/instruction-patch/use-instruction-patch-page'

export function InstructionPatchPage() {
  const instructionPatch = useInstructionPatchPage()

  return (
    <ConsolePage title="Instruction patch">
      <InstructionPatchForm
        preset={instructionPatch.preset}
        projectFields={instructionPatch.projectFields}
        includeCandidate={instructionPatch.includeCandidate}
        isLoading={instructionPatch.isLoading}
        onPresetChange={instructionPatch.setPreset}
        onProjectFieldChange={instructionPatch.updateProjectField}
        onIncludeCandidateChange={instructionPatch.setIncludeCandidate}
        onSubmit={() => void instructionPatch.generatePatch()}
      />

      <ConsoleStatus status={instructionPatch.status} />

      {instructionPatch.patch ? (
        <InstructionPatchResults
          patch={instructionPatch.patch}
          onCopy={() => void instructionPatch.copyPatch()}
        />
      ) : null}
    </ConsolePage>
  )
}
