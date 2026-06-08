import { InstructionPatchSummaryPanels } from '@/console/pages/instruction-patch/InstructionPatchSummaryPanels'
import type { EngineeringInstructionPatchResponse } from '@/types/console.types'

type InstructionPatchResultsProps = {
  patch: EngineeringInstructionPatchResponse
  onCopy: () => void
}

export function InstructionPatchResults({ patch, onCopy }: InstructionPatchResultsProps) {
  return (
    <>
      <InstructionPatchSummaryPanels patch={patch} />

      {patch.patch.warnings.length > 0 ? (
        <div className="console-panel wide">
          <h3>Warnings</h3>
          <ul className="console-context-items">
            {patch.patch.warnings.map((warning) => (
              <li key={warning}>
                <strong>{warning}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="console-panel wide">
        <div className="console-panel-header">
          <h3>{patch.patch.targetFile} preview</h3>
          <button className="secondary-action compact" type="button" onClick={onCopy}>
            Copy export
          </button>
        </div>
        <pre>{patch.patch.content || patch.patch.suggestedMarkdown}</pre>
      </div>
    </>
  )
}
