type AgentWritebackCreateFormProps = {
  agentToken: string;
  agentName: string;
  repo: string;
  branch: string;
  taskSummary: string;
  filesTouched: string;
  commandsRun: string;
  testsRun: string;
  decisions: string;
  bugsFound: string;
  followUps: string;
  userCorrections: string;
  isSubmitting: boolean;
  onAgentTokenChange: (value: string) => void;
  onAgentNameChange: (value: string) => void;
  onRepoChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onTaskSummaryChange: (value: string) => void;
  onFilesTouchedChange: (value: string) => void;
  onCommandsRunChange: (value: string) => void;
  onTestsRunChange: (value: string) => void;
  onDecisionsChange: (value: string) => void;
  onBugsFoundChange: (value: string) => void;
  onFollowUpsChange: (value: string) => void;
  onUserCorrectionsChange: (value: string) => void;
  onSubmit: () => void;
};

export function AgentWritebackCreateForm(props: AgentWritebackCreateFormProps) {
  return (
    <form
      className="console-form wide"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h3>Create encrypted test writeback</h3>
      <p className="console-footnote">
        This encrypts in the browser, then sends ciphertext to the API using a scoped agent token.
      </p>
      <label>
        <span>Agent bearer token</span>
        <textarea
          value={props.agentToken}
          onChange={(event) => props.onAgentTokenChange(event.target.value)}
          placeholder="Paste token with agent:writeback:create"
        />
      </label>
      <div className="console-form-grid">
        <TextField label="Agent" value={props.agentName} onChange={props.onAgentNameChange} />
        <TextField label="Repo" value={props.repo} onChange={props.onRepoChange} />
        <TextField label="Branch" value={props.branch} onChange={props.onBranchChange} />
      </div>
      <label>
        <span>Task summary</span>
        <textarea
          value={props.taskSummary}
          onChange={(event) => props.onTaskSummaryChange(event.target.value)}
          placeholder="What did the coding agent do?"
        />
      </label>
      <div className="console-form-grid">
        <TextAreaField label="Files touched" value={props.filesTouched} onChange={props.onFilesTouchedChange} />
        <TextAreaField label="Commands run" value={props.commandsRun} onChange={props.onCommandsRunChange} />
        <TextAreaField label="Tests run" value={props.testsRun} onChange={props.onTestsRunChange} />
        <TextAreaField label="Decisions" value={props.decisions} onChange={props.onDecisionsChange} />
        <TextAreaField label="Bugs found" value={props.bugsFound} onChange={props.onBugsFoundChange} />
        <TextAreaField label="Follow ups" value={props.followUps} onChange={props.onFollowUpsChange} />
        <TextAreaField label="User corrections" value={props.userCorrections} onChange={props.onUserCorrectionsChange} />
      </div>
      <button className="primary-action" type="submit" disabled={props.isSubmitting}>
        {props.isSubmitting ? "Encrypting..." : "Create encrypted writeback"}
      </button>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="One per line" />
    </label>
  );
}
