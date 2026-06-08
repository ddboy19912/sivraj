import { Fragment, type ReactNode, useEffectEvent, useLayoutEffect } from 'react'
import type { CodingAgentExportPreset } from '@/types/console.types'
import type { EngineeringProjectFields } from '@/types/console.types'

export function ConsolePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="console-page">
      <ConsolePageHeading title={title} />
      {children}
    </section>
  )
}

function ConsolePageHeading({ title }: { title: string }) {
  return (
    <div className="section-heading">
      <p className="eyebrow">Testing console</p>
      <h2>{title}</h2>
    </div>
  )
}

export function ConsoleInfoPanel({
  items,
  className = 'console-panel',
}: {
  items: Array<{ term: string; detail: ReactNode }>
  className?: string
}) {
  return (
    <div className={className}>
      <dl>
        {items.map((item) => (
          <Fragment key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.detail}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

export function ConsoleStatus({ status }: { status: string | null }) {
  return status ? <p className="console-status">{status}</p> : null
}

export function ConsoleRefreshButton({
  isLoading,
  label,
  loadingLabel = 'Loading...',
  onClick,
}: {
  isLoading: boolean
  label: string
  loadingLabel?: string
  onClick: () => void
}) {
  return (
    <button className="secondary-action" type="button" disabled={isLoading} onClick={onClick}>
      {isLoading ? loadingLabel : label}
    </button>
  )
}

export function useConsoleSessionEffect(
  isSessionForWallet: boolean,
  twinId: string | undefined,
  load: () => void | Promise<void>,
  reloadKey = '',
) {
  const loadLatest = useEffectEvent(load)

  useLayoutEffect(() => {
    if (isSessionForWallet) {
      void loadLatest()
    }
  }, [isSessionForWallet, reloadKey, twinId])
}

export function ConsoleTable({
  headers,
  children,
}: {
  headers: string[]
  children: ReactNode
}) {
  return (
    <div className="console-table-wrap">
      <table className="console-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const PROJECT_FIELD_LABELS = {
  engineering: {
    projectName: 'Project',
    repoName: 'Repo',
    packageName: 'Package',
    packageManager: 'Manager',
    frameworks: 'Frameworks',
  },
  context: {
    projectName: 'Project name',
    repoName: 'Repo name',
    packageName: 'Package name',
    packageManager: 'Package manager',
    frameworks: 'Frameworks',
  },
} as const

export function EngineeringProjectFieldInputs({
  values,
  onChange,
  variant = 'engineering',
  gitRemote,
  onGitRemoteChange,
}: {
  values: EngineeringProjectFields
  onChange: (field: keyof EngineeringProjectFields, value: string) => void
  variant?: keyof typeof PROJECT_FIELD_LABELS
  gitRemote?: string
  onGitRemoteChange?: (value: string) => void
}) {
  const labels = PROJECT_FIELD_LABELS[variant]

  return (
    <>
      <label>
        <span>{labels.projectName}</span>
        <input value={values.projectName} onChange={(event) => onChange('projectName', event.target.value)} />
      </label>
      <label>
        <span>{labels.repoName}</span>
        <input value={values.repoName} onChange={(event) => onChange('repoName', event.target.value)} />
      </label>
      <label>
        <span>{labels.packageName}</span>
        <input value={values.packageName} onChange={(event) => onChange('packageName', event.target.value)} />
      </label>
      <label>
        <span>{labels.packageManager}</span>
        <input value={values.packageManager} onChange={(event) => onChange('packageManager', event.target.value)} />
      </label>
      <label>
        <span>{labels.frameworks}</span>
        <input value={values.frameworks} onChange={(event) => onChange('frameworks', event.target.value)} />
      </label>
      {onGitRemoteChange ? (
        <label>
          <span>Git remote</span>
          <input value={gitRemote ?? ''} onChange={(event) => onGitRemoteChange(event.target.value)} />
        </label>
      ) : null}
    </>
  )
}

const EXPORT_PRESET_OPTIONS: Array<{ value: CodingAgentExportPreset; label: string }> = [
  { value: 'codex', label: 'Codex / AGENTS.md' },
  { value: 'claude_code', label: 'Claude Code / CLAUDE.md' },
  { value: 'cursor', label: 'Cursor / .cursor/rules' },
  { value: 'generic_mcp', label: 'Generic MCP / JSON' },
]

const INSTRUCTION_PATCH_PRESET_LABELS: Partial<Record<CodingAgentExportPreset, string>> = {
  cursor: 'Cursor / .cursor/rules/sivraj.mdc',
  generic_mcp: 'Generic MCP / sivraj-context.json',
}

export function ConsoleCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="console-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function ExportPresetSelect({
  value,
  onChange,
  variant = 'context',
}: {
  value: CodingAgentExportPreset
  onChange: (value: CodingAgentExportPreset) => void
  variant?: 'context' | 'instruction-patch'
}) {
  return (
    <label>
      <span>Export preset</span>
      <select value={value} onChange={(event) => onChange(event.target.value as CodingAgentExportPreset)}>
        {EXPORT_PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {variant === 'instruction-patch'
              ? (INSTRUCTION_PATCH_PRESET_LABELS[option.value] ?? option.label)
              : option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
