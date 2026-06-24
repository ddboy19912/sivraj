import { CheckCircle2, Download, KeyRound, LoaderCircle, RotateCcw, XCircle } from "lucide-react";
import { useReducer, useState } from "react";
import { toast } from "sonner";
import {
  AgentsUnavailable,
  ContextStatus,
} from "@/components/settings/AgentsSettingsSectionParts";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApplyEngineeringReviewAction,
  useAgentClients,
  useAgentContext,
  useCreateAgentToken,
  useEngineeringReviewQueue,
  useRevokeAgentClient,
} from "@/hooks/agents/use-agent-context";
import { API_URL, errorMessage } from "@/lib/api";
import {
  AGENT_CONTEXT_PRESETS,
  AGENT_MCP_CLIENTS,
  AGENT_MCP_TRANSPORTS,
  buildAgentTokenScopes,
  createAgentContextDownload,
  createMcpConfigDownload,
  describeGrant,
  downloadTextFile,
  formatGrantDate,
  resolveAgentContextPreset,
  resolveAgentMcpClient,
  resolveAgentMcpTransport,
} from "@/lib/agents/agent-context";
import { cn } from "@/lib/ui/utils";
import type { Session } from "@/lib/session";
import type {
  AgentClientGrant,
  AgentContextPreset,
  AgentContextResponse,
  AgentEngineeringReviewAction,
  AgentEngineeringReviewCandidate,
  AgentEngineeringReviewQueueResponse,
  AgentMcpClient,
  AgentMcpTransport,
  AgentTokenResponse,
} from "@/types/agent-context.types";

type AgentsSettingsSectionProps = {
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
};

const TOKEN_TTL_OPTIONS = [
  { value: "60", label: "1 hour" },
  { value: "1440", label: "24 hours" },
  { value: "10080", label: "7 days" },
];

type AgentsSettingsState = {
  skillPreset: AgentContextPreset;
  mcpClient: AgentMcpClient;
  mcpTransport: AgentMcpTransport;
  agentName: string;
  expiresInMinutes: string;
  memorySearchEnabled: boolean;
  writebackEnabled: boolean;
  latestToken: AgentTokenResponse | null;
};

type AgentsSettingsAction =
  | { type: "SET_SKILL_PRESET"; preset: AgentContextPreset }
  | { type: "SET_MCP_CLIENT"; client: AgentMcpClient }
  | { type: "SET_MCP_TRANSPORT"; transport: AgentMcpTransport }
  | { type: "SET_AGENT_NAME"; agentName: string }
  | { type: "SET_EXPIRY"; expiresInMinutes: string }
  | { type: "SET_MEMORY_SEARCH"; enabled: boolean }
  | { type: "SET_WRITEBACK"; enabled: boolean }
  | { type: "TOKEN_CREATED"; token: AgentTokenResponse };

const initialAgentsSettingsState: AgentsSettingsState = {
  skillPreset: "codex",
  mcpClient: "generic_json",
  mcpTransport: "stdio",
  agentName: "Sivraj Coding Agent",
  expiresInMinutes: "1440",
  memorySearchEnabled: false,
  writebackEnabled: false,
  latestToken: null,
};

function agentsSettingsReducer(
  state: AgentsSettingsState,
  action: AgentsSettingsAction,
): AgentsSettingsState {
  switch (action.type) {
    case "SET_SKILL_PRESET":
      return { ...state, skillPreset: action.preset };
    case "SET_MCP_CLIENT":
      return { ...state, mcpClient: action.client };
    case "SET_MCP_TRANSPORT":
      return { ...state, mcpTransport: action.transport };
    case "SET_AGENT_NAME":
      return { ...state, agentName: action.agentName };
    case "SET_EXPIRY":
      return { ...state, expiresInMinutes: action.expiresInMinutes };
    case "SET_MEMORY_SEARCH":
      return { ...state, memorySearchEnabled: action.enabled };
    case "SET_WRITEBACK":
      return { ...state, writebackEnabled: action.enabled };
    case "TOKEN_CREATED":
      return { ...state, latestToken: action.token };
  }
}

export function AgentsSettingsSection({
  session,
  onSessionRefreshed,
}: AgentsSettingsSectionProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [viewState, dispatchView] = useReducer(
    agentsSettingsReducer,
    initialAgentsSettingsState,
  );
  const {
    skillPreset,
    mcpClient,
    mcpTransport,
    agentName,
    expiresInMinutes,
    memorySearchEnabled,
    writebackEnabled,
    latestToken,
  } = viewState;
  const contextQuery = useAgentContext({
    session,
    preset: skillPreset,
    onSessionRefreshed,
  });
  const clientsQuery = useAgentClients({ session, onSessionRefreshed });
  const reviewQueueQuery = useEngineeringReviewQueue({
    session,
    onSessionRefreshed,
  });
  const applyReviewMutation = useApplyEngineeringReviewAction({
    session,
    onSessionRefreshed,
  });
  const createTokenMutation = useCreateAgentToken({
    session,
    onSessionRefreshed,
  });
  const revokeMutation = useRevokeAgentClient({ session, onSessionRefreshed });
  const contextExport = contextQuery.data?.contextExport ?? null;
  const mcpConfig = session
    ? createMcpConfigDownload({
        preset: skillPreset,
        client: mcpClient,
        transport: mcpTransport,
        token: latestToken?.token ?? null,
        twinId: session.twinId,
        apiUrl: API_URL,
        includeMemorySearch: memorySearchEnabled,
        includeWriteback: writebackEnabled,
      })
    : null;

  async function createToken() {
    if (!session) {
      return;
    }

    try {
      const token = await createTokenMutation.mutateAsync({
        agentName: agentName.trim() || "Coding Agent",
        scopes: buildAgentTokenScopes({
          memorySearchEnabled,
          writebackEnabled,
        }),
        expiresInMinutes: Number.parseInt(expiresInMinutes, 10),
      });
      dispatchView({ type: "TOKEN_CREATED", token });
      toast.success("Agent token created");
    } catch (error) {
      toast.error("Token creation failed", {
        description: errorMessage(error),
      });
    }
  }

  async function applyCandidateReview(
    candidate: AgentEngineeringReviewCandidate,
    action: AgentEngineeringReviewAction,
  ) {
    try {
      await applyReviewMutation.mutateAsync({
        candidateId: candidate.id,
        action,
      });
      toast.success(action === "keep_active" ? "Memory approved" : "Memory rejected");
    } catch (error) {
      toast.error("Review action failed", {
        description: errorMessage(error),
      });
    }
  }

  async function revokeClient(grant: AgentClientGrant) {
    try {
      await revokeMutation.mutateAsync(grant.grantId);
      toast.success("Agent access revoked");
    } catch (error) {
      toast.error("Revoke failed", { description: errorMessage(error) });
    }
  }

  function downloadContextPacket() {
    if (contextExport) {
      downloadTextFile(createAgentContextDownload(contextExport));
    }
  }

  function downloadMcpConfig() {
    if (mcpConfig) {
      downloadTextFile(mcpConfig);
    }
  }

  if (!session) {
    return <AgentsUnavailable />;
  }

  return (
    <section className="text-[#f7fdff]">
      <header className="pb-10">
        <h2 className="mt-4 text-3xl font-semibold text-[#f7fdff]">
          Agent setup
        </h2>
      </header>

      <AgentSkillsSection
        contextError={contextQuery.error}
        contextExport={contextExport}
        isLoadingContext={contextQuery.isLoading || contextQuery.isFetching}
        skillPreset={skillPreset}
        pendingCandidateCount={selectPendingReviewCandidates(reviewQueueQuery.data).length}
        onDownloadContextPacket={downloadContextPacket}
        onOpenReview={() => setReviewOpen(true)}
        onSkillPresetChange={(preset) =>
          dispatchView({ type: "SET_SKILL_PRESET", preset })
        }
      />

      <McpSection
        mcpClient={mcpClient}
        mcpConfig={mcpConfig}
        mcpTransport={mcpTransport}
        tokenReady={latestToken !== null}
        onDownloadMcpConfig={downloadMcpConfig}
        onMcpClientChange={(client) =>
          dispatchView({ type: "SET_MCP_CLIENT", client })
        }
        onMcpTransportChange={(transport) =>
          dispatchView({ type: "SET_MCP_TRANSPORT", transport })
        }
      />

      <AccessSection
        agentName={agentName}
        clients={clientsQuery.data?.clients ?? []}
        clientsError={clientsQuery.error}
        expiresInMinutes={expiresInMinutes}
        isCreatingToken={createTokenMutation.isPending}
        isLoadingClients={clientsQuery.isLoading || clientsQuery.isFetching}
        latestToken={latestToken}
        memorySearchEnabled={memorySearchEnabled}
        revokingGrantId={revokeMutation.variables ?? null}
        writebackEnabled={writebackEnabled}
        onAgentNameChange={(nextAgentName) =>
          dispatchView({ type: "SET_AGENT_NAME", agentName: nextAgentName })
        }
        onCreateToken={() => void createToken()}
        onExpiryChange={(nextExpiry) =>
          dispatchView({ type: "SET_EXPIRY", expiresInMinutes: nextExpiry })
        }
        onMemorySearchChange={(enabled) =>
          dispatchView({ type: "SET_MEMORY_SEARCH", enabled })
        }
        onRevoke={(grant) => void revokeClient(grant)}
        onWritebackChange={(enabled) =>
          dispatchView({ type: "SET_WRITEBACK", enabled })
        }
      />

      <EngineeringReviewDialog
        error={reviewQueueQuery.error}
        isLoading={reviewQueueQuery.isLoading || reviewQueueQuery.isFetching}
        open={reviewOpen}
        queue={reviewQueueQuery.data ?? null}
        reviewVariables={applyReviewMutation.variables ?? null}
        onOpenChange={setReviewOpen}
        onReview={applyCandidateReview}
      />
    </section>
  );
}

function AgentSkillsSection({
  contextError,
  contextExport,
  isLoadingContext,
  onDownloadContextPacket,
  onOpenReview,
  onSkillPresetChange,
  pendingCandidateCount,
  skillPreset,
}: {
  contextError: unknown;
  contextExport: AgentContextResponse["contextExport"] | null;
  isLoadingContext: boolean;
  onDownloadContextPacket: () => void;
  onOpenReview: () => void;
  onSkillPresetChange: (preset: AgentContextPreset) => void;
  pendingCandidateCount: number;
  skillPreset: AgentContextPreset;
}) {
  return (
    <FlatSection label="Agent skills">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-end">
        <SelectField
          ariaLabel="Agent skill output format"
          label="Output"
          value={skillPreset}
          onChange={(value) =>
            onSkillPresetChange(resolveAgentContextPreset(value))
          }
          options={AGENT_CONTEXT_PRESETS.map((option) => ({
            value: option.id,
            label: option.targetFile,
          }))}
        />
        <ArtifactActions
          detail={contextExport?.targetFile ?? "AGENTS.md"}
          disabled={!contextExport}
          downloadLabel={`Download ${contextExport?.targetFile ?? "AGENTS.md"}`}
          label="Skill file"
          onDownload={onDownloadContextPacket}
          value={contextExport?.content ?? ""}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
        <span className="grid gap-1 text-sm font-medium text-white/48">
          <span>
            {pendingCandidateCount > 0
              ? `${pendingCandidateCount} candidate ${pendingCandidateCount === 1 ? "memory" : "memories"} waiting`
              : "No pending agent memories"}
          </span>
          <span className="text-xs font-medium text-white/34">
            Agents only receive approved engineering memories.
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onOpenReview}
          className="h-9 rounded-[4px] border-white/10 bg-white/[0.035] px-3 text-white/70 hover:bg-white/[0.07] hover:text-white/90"
        >
          Review candidates
        </Button>
      </div>
      <ContextStatus
        isLoading={isLoadingContext}
        error={contextError}
        warnings={[]}
      />
    </FlatSection>
  );
}

function McpSection({
  mcpClient,
  mcpConfig,
  mcpTransport,
  onDownloadMcpConfig,
  onMcpClientChange,
  onMcpTransportChange,
  tokenReady,
}: {
  mcpClient: AgentMcpClient;
  mcpConfig: ReturnType<typeof createMcpConfigDownload> | null;
  mcpTransport: AgentMcpTransport;
  onDownloadMcpConfig: () => void;
  onMcpClientChange: (client: AgentMcpClient) => void;
  onMcpTransportChange: (transport: AgentMcpTransport) => void;
  tokenReady: boolean;
}) {
  return (
    <FlatSection label="MCP">
      <div className="grid gap-5 lg:grid-cols-[280px_240px_minmax(0,1fr)] lg:items-end">
        <SelectField
          ariaLabel="MCP target"
          label="Target"
          value={mcpClient}
          onChange={(value) => onMcpClientChange(resolveAgentMcpClient(value))}
          options={AGENT_MCP_CLIENTS.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
        <SelectField
          ariaLabel="MCP transport"
          label="Transport"
          value={mcpTransport}
          onChange={(value) =>
            onMcpTransportChange(resolveAgentMcpTransport(value))
          }
          options={AGENT_MCP_TRANSPORTS.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
        <ArtifactActions
          detail={mcpConfig?.filename ?? "sivraj-mcp-stdio.json"}
          disabled={!mcpConfig}
          downloadLabel="Download MCP setup"
          label={tokenReady ? "Config with token" : "Config template"}
          onDownload={onDownloadMcpConfig}
          value={mcpConfig?.content ?? ""}
        />
      </div>
      {mcpConfig ? <CodePreview content={mcpConfig.content} /> : null}
    </FlatSection>
  );
}

function AccessSection({
  agentName,
  clients,
  clientsError,
  expiresInMinutes,
  isCreatingToken,
  isLoadingClients,
  latestToken,
  memorySearchEnabled,
  onAgentNameChange,
  onCreateToken,
  onExpiryChange,
  onMemorySearchChange,
  onRevoke,
  onWritebackChange,
  revokingGrantId,
  writebackEnabled,
}: {
  agentName: string;
  clients: AgentClientGrant[];
  clientsError: unknown;
  expiresInMinutes: string;
  isCreatingToken: boolean;
  isLoadingClients: boolean;
  latestToken: AgentTokenResponse | null;
  memorySearchEnabled: boolean;
  onAgentNameChange: (agentName: string) => void;
  onCreateToken: () => void;
  onExpiryChange: (expiresInMinutes: string) => void;
  onMemorySearchChange: (enabled: boolean) => void;
  onRevoke: (grant: AgentClientGrant) => void;
  onWritebackChange: (enabled: boolean) => void;
  revokingGrantId: string | null;
  writebackEnabled: boolean;
}) {
  return (
    <FlatSection label="Access">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,540px)_minmax(280px,320px)]">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_220px]">
          <label className="grid gap-2" htmlFor="agent-token-name">
            <span className="text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
              Name
            </span>
            <Input
              id="agent-token-name"
              value={agentName}
              onChange={(event) => onAgentNameChange(event.target.value)}
              className="h-11 rounded-[4px] border border-white/8 bg-white/[0.045] px-4 font-mono text-sm text-[#f7fdff] shadow-none focus-visible:border-[rgba(var(--theme-color-rgb),0.48)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb),0.16)]"
            />
          </label>
          <SelectField
            ariaLabel="Agent token expiry"
            label="Expires"
            value={expiresInMinutes}
            onChange={onExpiryChange}
            options={TOKEN_TTL_OPTIONS}
          />
          <div className="sm:col-span-2">
            <div className="flex flex-wrap gap-x-8 gap-y-3 py-2">
              <ScopeCheckbox
                checked={memorySearchEnabled}
                label="Memory search"
                onChange={onMemorySearchChange}
              />
              <ScopeCheckbox
                checked={writebackEnabled}
                label="Writebacks"
                onChange={onWritebackChange}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isCreatingToken}
              onClick={onCreateToken}
              className="mt-6 h-11 rounded-lg border-[rgba(var(--theme-color-rgb),0.44)] bg-[rgba(var(--theme-color-rgb),0.16)] px-6! text-[rgb(var(--theme-color-rgb))] hover:border-[rgba(var(--theme-color-rgb),0.68)] hover:bg-[rgba(var(--theme-color-rgb),0.22)]"
            >
              {isCreatingToken ? (
                <LoaderCircle
                  className="size-3.5 animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <KeyRound className="size-3.5" data-icon="inline-start" />
              )}
              Create token
            </Button>
            {latestToken ? <CreatedTokenPanel token={latestToken} /> : null}
          </div>
        </div>
        <GrantList
          clients={clients}
          error={clientsError}
          isLoading={isLoadingClients}
          revokingGrantId={revokingGrantId}
          onRevoke={onRevoke}
        />
      </div>
    </FlatSection>
  );
}

function FlatSection({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="grid gap-5 border-t border-white/10 py-8 lg:grid-cols-[260px_minmax(0,1fr)]">
      <h3 className="pt-1 text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
        {label}
      </h3>
      <div className="grid min-w-0 gap-7">{children}</div>
    </section>
  );
}

function SelectField({
  ariaLabel,
  label,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          size="sm"
          aria-label={ariaLabel}
          className="h-11 rounded-[4px] border border-white/8 bg-white/[0.045] px-4 text-sm text-[#f7fdff] shadow-none focus-visible:border-[rgba(var(--theme-color-rgb),0.48)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb),0.16)]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ArtifactActions({
  detail,
  disabled,
  downloadLabel,
  label,
  onDownload,
  value,
}: {
  detail: string;
  disabled: boolean;
  downloadLabel: string;
  label: string;
  onDownload: () => void;
  value: string;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white/86">
          {label}
        </span>
        <span className="mt-0.5 block max-w-[220px] truncate font-mono text-xs font-medium text-white/40">
          {detail}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <ClipboardActionButton
          action="copy"
          value={value}
          disabled={disabled}
          aria-label={`Copy ${label}`}
          feedbackLabel={`Copied ${label}`}
          className="size-9 rounded-[4px] border border-white/10 bg-white/[0.035] text-white/42 hover:bg-white/[0.07] hover:text-white/78"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          disabled={disabled}
          aria-label={downloadLabel}
          title={downloadLabel}
          onClick={onDownload}
          className="size-9 rounded-[4px] border-white/10 bg-white/[0.035] text-white/42 hover:bg-white/[0.07] hover:text-white/78"
        >
          <Download className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}

function ScopeCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium text-white/76">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 accent-[rgb(var(--theme-color-rgb))]"
      />
      {label}
    </label>
  );
}

function GrantList({
  clients,
  error,
  isLoading,
  onRevoke,
  revokingGrantId,
}: {
  clients: AgentClientGrant[];
  error: unknown;
  isLoading: boolean;
  onRevoke: (grant: AgentClientGrant) => void;
  revokingGrantId: string | null;
}) {
  if (error) {
    return (
      <div>
        <p className="mb-4 text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
          Grants
        </p>
        <p className="text-sm font-medium text-red-100/72">
          Clients unavailable: {errorMessage(error)}
        </p>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div>
        <p className="mb-4 text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
          No active grants
        </p>
        <div className="grid min-h-[150px] place-items-center rounded-[6px] border border-dashed border-white/14 bg-black/12 px-6 text-center">
          <div className="grid justify-items-center gap-3 text-white/34">
            <RotateCcw className="size-6" />
            <p className="max-w-48 text-sm font-medium leading-6">
              {isLoading
                ? "Loading grants"
                : "Tokens will appear here once generated."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid content-start gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
          Active grants
        </p>
        {isLoading ? (
          <LoaderCircle className="size-3.5 animate-spin text-white/36" />
        ) : null}
      </div>
      {clients.map((grant) => (
        <div
          key={grant.grantId}
          className="flex min-w-0 items-center gap-3 border-b border-white/8 py-2 last:border-b-0"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              grant.status === "active" && "bg-emerald-200/80",
              grant.status === "revoked" && "bg-red-200/70",
              grant.status === "expired" && "bg-white/30",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white/82">
              {grant.name}
            </span>
            <span className="block truncate text-[11px] font-medium text-white/42">
              {describeGrant(grant)}
            </span>
          </span>
          {grant.status === "active" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              disabled={revokingGrantId === grant.grantId}
              aria-label={`Revoke ${grant.name}`}
              title={`Revoke ${grant.name}`}
              onClick={() => onRevoke(grant)}
              className="rounded-[10px]"
            >
              {revokingGrantId === grant.grantId ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CodePreview({ content }: { content: string }) {
  return (
    <div className="overflow-hidden rounded-[6px] border border-white/10 bg-[#020406]/86">
      <div className="flex h-9 items-center justify-between border-b border-white/10 bg-white/[0.035] px-4">
        <div className="flex gap-2">
          <span className="size-3 rounded-full bg-[#8f6d78]" />
          <span className="size-3 rounded-full bg-[#a88368]" />
          <span className="size-3 rounded-full bg-[#5b7691]" />
        </div>
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-white/44 uppercase">
          JSON configuration
        </p>
      </div>
      <pre className="max-h-80 overflow-auto px-7 py-8 font-mono text-[12px] leading-7 text-[rgb(var(--theme-color-rgb))]">
        <code>{content}</code>
      </pre>
    </div>
  );
}

function CreatedTokenPanel({ token }: { token: AgentTokenResponse }) {
  return (
    <div className="mt-3 border-t border-white/8 pt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white/60">Token shown once</p>
        <ClipboardActionButton
          action="copy"
          value={token.token}
          aria-label="Copy agent token"
          feedbackLabel="Copied token"
          className="size-7 rounded-[10px]"
        />
      </div>
      <p className="break-all font-mono text-[11px] leading-5 text-white/66">
        {token.token}
      </p>
      <p className="mt-1 text-[11px] font-medium text-white/40">
        Expires {formatGrantDate(token.expiresAt)}
      </p>
    </div>
  );
}

function EngineeringReviewDialog({
  error,
  isLoading,
  onOpenChange,
  onReview,
  open,
  queue,
  reviewVariables,
}: {
  error: unknown;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (
    candidate: AgentEngineeringReviewCandidate,
    action: AgentEngineeringReviewAction,
  ) => Promise<void>;
  open: boolean;
  queue: AgentEngineeringReviewQueueResponse | null;
  reviewVariables: {
    candidateId: string;
    action: AgentEngineeringReviewAction;
  } | null;
}) {
  const [confirmationTarget, setConfirmationTarget] = useState<{
    action: Extract<AgentEngineeringReviewAction, "keep_active" | "reject">;
    candidate: AgentEngineeringReviewCandidate;
  } | null>(null);
  const pendingCandidates = selectPendingReviewCandidates(queue);
  const isConfirming = Boolean(
    confirmationTarget &&
      reviewVariables?.candidateId === confirmationTarget.candidate.id &&
      reviewVariables.action === confirmationTarget.action,
  );

  async function confirmReviewAction() {
    if (!confirmationTarget) {
      return;
    }

    await onReview(confirmationTarget.candidate, confirmationTarget.action);
    setConfirmationTarget(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="grid h-[min(680px,calc(100svh-48px))] max-w-[760px] grid-rows-[auto_minmax(0,1fr)] rounded-[16px]">
          <DialogHeader>
            <DialogTitle className="pr-3 text-base">Review agent memories</DialogTitle>
            <DialogDescription>
              Approve candidate engineering memories before agents can export them.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {isLoading ? (
              <ReviewDialogStatus icon={<LoaderCircle className="size-5 animate-spin" />} label="Loading candidates" />
            ) : error ? (
              <ReviewDialogStatus icon={<XCircle className="size-5" />} label={`Review queue unavailable: ${errorMessage(error)}`} />
            ) : pendingCandidates.length === 0 ? (
              <ReviewDialogStatus icon={<CheckCircle2 className="size-5" />} label="No pending agent memories" />
            ) : (
              <div className="grid gap-0">
                {pendingCandidates.map((candidate) => {
                  const busy = reviewVariables?.candidateId === candidate.id;

                  return (
                    <div
                      key={candidate.id}
                      className="grid gap-4 border-b border-white/8 py-4 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                    >
                      <div className="min-w-0">
                        <h3 className="mb-1 truncate text-sm font-semibold text-white/90">
                          {candidate.subject ?? "Untitled agent memory"}
                        </h3>
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-semibold text-white/42">
                          <span className="font-mono text-[rgb(var(--theme-color-rgb))]">
                            {candidate.engineeringMemoryType}
                          </span>
                          <span>{candidate.scope}</span>
                        </div>
                        <p className="text-sm leading-6 text-white/82">
                          {candidate.agentContextLine ?? "No agent context line was extracted."}
                        </p>
                        <p className="mt-2 font-mono text-[11px] text-white/34">
                          {candidate.id}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2 md:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setConfirmationTarget({ candidate, action: "reject" })}
                          className="h-9 rounded-[4px] border-red-200/14 bg-red-300/8 px-3 text-red-100/72 hover:bg-red-300/12 hover:text-red-100"
                        >
                          {busy && reviewVariables?.action === "reject" ? (
                            <LoaderCircle className="size-3.5 animate-spin" data-icon="inline-start" />
                          ) : (
                            <XCircle className="size-3.5" data-icon="inline-start" />
                          )}
                          Reject
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setConfirmationTarget({ candidate, action: "keep_active" })}
                          className="h-9 rounded-[4px] border-[rgba(var(--theme-color-rgb),0.44)] bg-[rgba(var(--theme-color-rgb),0.14)] px-3 text-[rgb(var(--theme-color-rgb))] hover:bg-[rgba(var(--theme-color-rgb),0.2)]"
                        >
                          {busy && reviewVariables?.action === "keep_active" ? (
                            <LoaderCircle className="size-3.5 animate-spin" data-icon="inline-start" />
                          ) : (
                            <CheckCircle2 className="size-3.5" data-icon="inline-start" />
                          )}
                          Approve
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={confirmationTarget !== null}
        title={confirmationTitle(confirmationTarget)}
        description={confirmationDescription(confirmationTarget)}
        confirmLabel={confirmationTarget?.action === "reject" ? "Reject memory" : "Approve memory"}
        tone={confirmationTarget?.action === "reject" ? "destructive" : "default"}
        isPending={isConfirming}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isConfirming) {
            setConfirmationTarget(null);
          }
        }}
        onConfirm={() => void confirmReviewAction()}
      />
    </>
  );
}

function confirmationTitle(
  target: {
    action: Extract<AgentEngineeringReviewAction, "keep_active" | "reject">;
    candidate: AgentEngineeringReviewCandidate;
  } | null,
) {
  return target?.action === "reject"
    ? "Reject this memory?"
    : "Approve this memory?";
}

function confirmationDescription(
  target: {
    action: Extract<AgentEngineeringReviewAction, "keep_active" | "reject">;
    candidate: AgentEngineeringReviewCandidate;
  } | null,
) {
  return target?.action === "reject"
    ? "Rejected memories stay out of agent exports and MCP context."
    : "Approved memories can be included in agent skill exports and MCP context.";
}

function ReviewDialogStatus({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="grid min-h-[220px] place-items-center text-center">
      <div className="grid justify-items-center gap-3 text-white/44">
        {icon}
        <p className="max-w-sm text-sm font-medium leading-6">{label}</p>
      </div>
    </div>
  );
}

function selectPendingReviewCandidates(
  queue: AgentEngineeringReviewQueueResponse | null | undefined,
) {
  return queue?.candidates.filter((candidate) => candidate.status === "candidate") ?? [];
}
