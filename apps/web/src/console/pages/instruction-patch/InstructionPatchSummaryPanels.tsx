import type { EngineeringInstructionPatchResponse } from '@/types/console.types'

type InstructionPatchSummaryPanelsProps = {
  patch: EngineeringInstructionPatchResponse
}

export function InstructionPatchSummaryPanels({ patch }: InstructionPatchSummaryPanelsProps) {
  return (
    <div className="console-grid">
      <div className="console-panel">
        <h3>Patch summary</h3>
        <dl>
          <dt>Target</dt>
          <dd>{patch.patch.targetFile}</dd>
          <dt>Preset</dt>
          <dd>{patch.patch.preset}</dd>
          <dt>Format</dt>
          <dd>{patch.patch.format}</dd>
          <dt>Operation</dt>
          <dd>{patch.patch.operation}</dd>
          <dt>Rules</dt>
          <dd>{patch.patch.itemCount}</dd>
          <dt>Auto write</dt>
          <dd>{patch.policy.autoWriteEnabled ? 'Enabled' : 'Disabled'}</dd>
        </dl>
      </div>
      <div className="console-panel">
        <h3>Quality</h3>
        <dl>
          <dt>Score</dt>
          <dd>{Math.round(patch.patch.quality.score * 100)}%</dd>
          <dt>Label</dt>
          <dd>{patch.patch.quality.label}</dd>
          <dt>Ready</dt>
          <dd>{patch.patch.quality.readyForAgent ? 'Yes' : 'No'}</dd>
          <dt>Evidence</dt>
          <dd>{patch.patch.evidence.length}</dd>
        </dl>
      </div>
    </div>
  )
}
