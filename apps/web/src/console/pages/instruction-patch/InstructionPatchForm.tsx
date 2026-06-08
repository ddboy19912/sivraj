import {
  ConsoleCheckbox,
  EngineeringProjectFieldInputs,
  ExportPresetSelect,
} from '@/console/console-page-ui'
import type { EngineeringProjectFields } from '@/types/console.types'
import type { CodingAgentExportPreset } from '@/types/console.types'

type InstructionPatchFormProps = {
  preset: CodingAgentExportPreset
  projectFields: EngineeringProjectFields
  includeCandidate: boolean
  isLoading: boolean
  onPresetChange: (value: CodingAgentExportPreset) => void
  onProjectFieldChange: (field: keyof EngineeringProjectFields, value: string) => void
  onIncludeCandidateChange: (value: boolean) => void
  onSubmit: () => void
}

export function InstructionPatchForm({
  preset,
  projectFields,
  includeCandidate,
  isLoading,
  onPresetChange,
  onProjectFieldChange,
  onIncludeCandidateChange,
  onSubmit,
}: InstructionPatchFormProps) {
  return (
    <form
      className="console-form inline"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <ExportPresetSelect
        value={preset}
        onChange={onPresetChange}
        variant="instruction-patch"
      />
      <EngineeringProjectFieldInputs
        values={projectFields}
        onChange={onProjectFieldChange}
      />
      <ConsoleCheckbox
        checked={includeCandidate}
        onChange={onIncludeCandidateChange}
        label="Include candidate rules"
      />
      <button className="primary-action" type="submit" disabled={isLoading}>
        {isLoading ? 'Generating...' : 'Generate patch'}
      </button>
    </form>
  )
}
