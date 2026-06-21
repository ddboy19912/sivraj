import {
  BrainCircuit,
  FileStack,
  KeyRound,
  ListChecks,
  LoaderCircle,
} from "lucide-react";
import { useReducer } from "react";
import { toast } from "sonner";
import {
  ActionStrip,
  AgentClientsList,
  AgentScopeToggle,
  AgentsUnavailable,
  ContextStatus,
  PacketMetric,
} from "@/components/settings/AgentsSettingsSectionParts";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAgentClients,
  useAgentContext,
  useCreateAgentToken,
  useRevokeAgentClient,
} from "@/hooks/agents/use-agent-context";
import { API_URL, errorMessage } from "@/lib/api";
import {
  AGENT_CONTEXT_PRESETS,
  buildAgentTokenScopes,
  createAgentContextDownload,
  createMcpConfigDownload,
  downloadTextFile,
  formatGrantDate,
  resolveAgentContextPreset,
} from "@/lib/agents/agent-context";
import type { Session } from "@/lib/session";
import type {
  AgentClientGrant,
  AgentContextResponse,
  AgentContextPreset,
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
  preset: AgentContextPreset;
  agentName: string;
  expiresInMinutes: string;
  memorySearchEnabled: boolean;
  writebackEnabled: boolean;
  latestToken: AgentTokenResponse | null;
};

type AgentsSettingsAction =
  | { type: "SET_PRESET"; preset: AgentContextPreset }
  | { type: "SET_AGENT_NAME"; agentName: string }
  | { type: "SET_EXPIRY"; expiresInMinutes: string }
  | { type: "SET_MEMORY_SEARCH"; enabled: boolean }
  | { type: "SET_WRITEBACK"; enabled: boolean }
  | { type: "TOKEN_CREATED"; token: AgentTokenResponse };

const initialAgentsSettingsState: AgentsSettingsState = {
  preset: "codex",
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
    case "SET_PRESET":
      return { ...state, preset: action.preset };
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
  const [viewState, dispatchView] = useReducer(
    agentsSettingsReducer,
    initialAgentsSettingsState,
  );
  const {
    preset,
    agentName,
    expiresInMinutes,
    memorySearchEnabled,
    writebackEnabled,
    latestToken,
  } = viewState;
  const contextQuery = useAgentContext({ session, preset, onSessionRefreshed });
  const clientsQuery = useAgentClients({ session, onSessionRefreshed });
  const createTokenMutation = useCreateAgentToken({
    session,
    onSessionRefreshed,
  });
  const revokeMutation = useRevokeAgentClient({ session, onSessionRefreshed });
  const context = contextQuery.data ?? null;
  const contextExport = context?.contextExport ?? null;
  const mcpConfig = session
    ? createMcpConfigDownload({
        preset,
        token: latestToken?.token ?? null,
        twinId: session.twinId,
        apiUrl: API_URL,
        includeMemorySearch: memorySearchEnabled,
        includeWriteback: writebackEnabled,
      })
    : null;
  const selectedPreset =
    AGENT_CONTEXT_PRESETS.find((option) => option.id === preset) ??
    AGENT_CONTEXT_PRESETS[0];

  async function createToken() {
    if (!session) {
      return;
    }

    const scopes = buildAgentTokenScopes({
      memorySearchEnabled,
      writebackEnabled,
    });

    try {
      const token = await createTokenMutation.mutateAsync({
        agentName: agentName.trim() || "Coding Agent",
        scopes,
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

  async function revokeClient(grant: AgentClientGrant) {
    try {
      await revokeMutation.mutateAsync(grant.grantId);
      toast.success("Agent access revoked");
    } catch (error) {
      toast.error("Revoke failed", { description: errorMessage(error) });
    }
  }

  function downloadContextPacket() {
    if (!contextExport) {
      return;
    }

    downloadTextFile(createAgentContextDownload(contextExport));
  }

  function downloadMcpConfig() {
    if (!mcpConfig) {
      return;
    }

    downloadTextFile(mcpConfig);
  }

  if (!session) {
    return <AgentsUnavailable />;
  }

  return (
    <section className="space-y-4">
      <header className="overflow-hidden rounded-[20px] border border-white/10 bg-[#05080c]/88">
        <div className="relative p-4 sm:p-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(var(--theme-color-rgb),0.72),transparent)]" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
                Agents
              </p>
              <h2 className="text-xl font-semibold text-[#f7fdff] sm:text-2xl">
                Context handoff
              </h2>
            </div>
            <div className="grid min-w-[min(100%,420px)] grid-cols-3 gap-2">
              <HeaderStat label="Preset" value={selectedPreset.label} />
              <HeaderStat
                label="Items"
                value={contextExport ? String(contextExport.itemCount) : "0"}
              />
              <HeaderStat
                label="Grants"
                value={String(clientsQuery.data?.clients.length ?? 0)}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <AgentPacketPanel
          context={context}
          contextError={contextQuery.error}
          contextExport={contextExport}
          isLoadingContext={contextQuery.isLoading || contextQuery.isFetching}
          mcpConfig={mcpConfig}
          preset={preset}
          selectedPreset={selectedPreset}
          onDownloadContextPacket={downloadContextPacket}
          onDownloadMcpConfig={downloadMcpConfig}
          onPresetChange={(nextPreset) =>
            dispatchView({
              type: "SET_PRESET",
              preset: nextPreset,
            })
          }
        />

        <div className="grid content-start gap-4">
          <AgentTokenPanel
            agentName={agentName}
            expiresInMinutes={expiresInMinutes}
            isCreatingToken={createTokenMutation.isPending}
            latestToken={latestToken}
            memorySearchEnabled={memorySearchEnabled}
            writebackEnabled={writebackEnabled}
            onAgentNameChange={(nextAgentName) =>
              dispatchView({
                type: "SET_AGENT_NAME",
                agentName: nextAgentName,
              })
            }
            onCreateToken={() => void createToken()}
            onExpiryChange={(nextExpiry) =>
              dispatchView({
                type: "SET_EXPIRY",
                expiresInMinutes: nextExpiry,
              })
            }
            onMemorySearchChange={(enabled) =>
              dispatchView({
                type: "SET_MEMORY_SEARCH",
                enabled,
              })
            }
            onWritebackChange={(enabled) =>
              dispatchView({
                type: "SET_WRITEBACK",
                enabled,
              })
            }
          />

          <AgentClientsList
            clients={clientsQuery.data?.clients ?? []}
            error={clientsQuery.error}
            isLoading={clientsQuery.isLoading || clientsQuery.isFetching}
            revokingGrantId={revokeMutation.variables ?? null}
            onRevoke={(grant) => void revokeClient(grant)}
          />
        </div>
      </div>
    </section>
  );
}

type AgentPresetOption = (typeof AGENT_CONTEXT_PRESETS)[number];
type AgentContextDownload = ReturnType<typeof createMcpConfigDownload>;

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-white/8 bg-black/18 px-3 py-2">
      <span className="block text-[11px] font-semibold text-white/38">
        {label}
      </span>
      <span className="block truncate text-sm font-semibold text-white/82">
        {value}
      </span>
    </div>
  );
}

function AgentPacketPanel({
  context,
  contextError,
  contextExport,
  isLoadingContext,
  mcpConfig,
  preset,
  selectedPreset,
  onDownloadContextPacket,
  onDownloadMcpConfig,
  onPresetChange,
}: {
  context: AgentContextResponse | null;
  contextError: unknown;
  contextExport: AgentContextResponse["contextExport"] | null;
  isLoadingContext: boolean;
  mcpConfig: AgentContextDownload | null;
  preset: AgentContextPreset;
  selectedPreset: AgentPresetOption;
  onDownloadContextPacket: () => void;
  onDownloadMcpConfig: () => void;
  onPresetChange: (preset: AgentContextPreset) => void;
}) {
  const inventory = context?.profileSummary.inventory ?? null;

  return (
    <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#05080c]/88">
      <div className="border-b border-white/8 p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
              Packet
            </p>
            <h3 className="truncate text-lg font-semibold text-white/90">
              {selectedPreset.targetFile}
            </h3>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-semibold text-white/44">Preset</span>
            <Select
              value={preset}
              onValueChange={(value) =>
                onPresetChange(resolveAgentContextPreset(value))
              }
            >
              <SelectTrigger
                size="sm"
                aria-label="Agent context preset"
                className="h-10 rounded-[12px] border-white/10 bg-white/[0.045]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {AGENT_CONTEXT_PRESETS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        <ContextStatus
          isLoading={isLoadingContext}
          error={contextError}
          warnings={contextExport?.warnings ?? []}
        />

        {contextExport ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <PacketMetric
              icon={<ListChecks className="size-4" />}
              label="Included"
              value={`${contextExport.itemCount} items`}
            />
            <PacketMetric
              icon={<BrainCircuit className="size-4" />}
              label="Extracted"
              value={`${inventory?.engineeringMemoryCount ?? context?.profileSummary.totalEngineeringMemories ?? 0} memories`}
            />
            <PacketMetric
              icon={<FileStack className="size-4" />}
              label="Agent sources"
              value={`${inventory?.agentInstructionSourceCount ?? 0} files`}
            />
          </div>
        ) : null}

        <SourceInventoryNotice
          itemCount={contextExport?.itemCount ?? 0}
          sourceCount={inventory?.engineeringSourceCount ?? 0}
        />

        <div className="overflow-hidden rounded-[16px] border border-white/8 bg-black/14">
          <ActionStrip
            detail={contextExport?.targetFile ?? selectedPreset.targetFile}
            label="Packet"
            value={contextExport?.content ?? ""}
            disabled={!contextExport}
            downloadLabel={`Download ${contextExport?.targetFile ?? selectedPreset.targetFile}`}
            onDownload={onDownloadContextPacket}
          />
          <ActionStrip
            detail={mcpConfig?.filename ?? `${preset}-sivraj-mcp.json`}
            label="MCP config"
            value={mcpConfig?.content ?? ""}
            disabled={!mcpConfig}
            downloadLabel="Download MCP config"
            onDownload={onDownloadMcpConfig}
          />
        </div>
      </div>
    </div>
  );
}

function SourceInventoryNotice({
  itemCount,
  sourceCount,
}: {
  itemCount: number;
  sourceCount: number;
}) {
  if (sourceCount <= 0 || itemCount > 0) {
    return null;
  }

  return (
    <div className="rounded-[14px] border border-amber-200/18 bg-amber-300/8 px-3 py-2 text-xs font-semibold leading-5 text-amber-100/74">
      {sourceCount} engineering source{sourceCount === 1 ? "" : "s"} found; no
      approved or active packet items yet.
    </div>
  );
}

function AgentTokenPanel({
  agentName,
  expiresInMinutes,
  isCreatingToken,
  latestToken,
  memorySearchEnabled,
  writebackEnabled,
  onAgentNameChange,
  onCreateToken,
  onExpiryChange,
  onMemorySearchChange,
  onWritebackChange,
}: {
  agentName: string;
  expiresInMinutes: string;
  isCreatingToken: boolean;
  latestToken: AgentTokenResponse | null;
  memorySearchEnabled: boolean;
  writebackEnabled: boolean;
  onAgentNameChange: (agentName: string) => void;
  onCreateToken: () => void;
  onExpiryChange: (expiresInMinutes: string) => void;
  onMemorySearchChange: (enabled: boolean) => void;
  onWritebackChange: (enabled: boolean) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#05080c]/88">
      <div className="flex min-h-14 items-center gap-3 border-b border-white/8 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/[0.045] text-[rgb(var(--theme-color-rgb))]">
          <KeyRound className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white/88">Agent token</h3>
          <p className="text-[11px] font-medium text-white/42">
            Read-only default
          </p>
        </div>
      </div>

      <div className="p-4">
        <AgentTokenFields
          agentName={agentName}
          expiresInMinutes={expiresInMinutes}
          onAgentNameChange={onAgentNameChange}
          onExpiryChange={onExpiryChange}
        />

        <div className="mt-3 grid gap-2">
          <AgentScopeToggle
            checked={memorySearchEnabled}
            label="Memory search"
            description="agent:memory:search"
            onChange={onMemorySearchChange}
          />
          <AgentScopeToggle
            checked={writebackEnabled}
            label="Writebacks"
            description="agent:writeback:create"
            onChange={onWritebackChange}
          />
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isCreatingToken}
          onClick={onCreateToken}
          className="mt-4 h-9 w-full rounded-[12px]"
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
  );
}

function AgentTokenFields({
  agentName,
  expiresInMinutes,
  onAgentNameChange,
  onExpiryChange,
}: {
  agentName: string;
  expiresInMinutes: string;
  onAgentNameChange: (agentName: string) => void;
  onExpiryChange: (expiresInMinutes: string) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_128px]">
      <label className="grid gap-2" htmlFor="agent-token-name">
        <span className="text-xs font-semibold text-white/44">Agent name</span>
        <Input
          id="agent-token-name"
          value={agentName}
          onChange={(event) => onAgentNameChange(event.target.value)}
          className="h-10 rounded-[12px] border-white/10 bg-white/[0.045] px-3 text-sm"
        />
      </label>
      <div className="grid gap-2">
        <span className="text-xs font-semibold text-white/44">Expires</span>
        <Select value={expiresInMinutes} onValueChange={onExpiryChange}>
          <SelectTrigger
            size="sm"
            aria-label="Agent token expiry"
            className="h-10 rounded-[12px] border-white/10 bg-white/[0.045]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {TOKEN_TTL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CreatedTokenPanel({ token }: { token: AgentTokenResponse }) {
  return (
    <div className="mt-4 rounded-[16px] border border-[rgba(var(--theme-color-rgb),0.24)] bg-[rgba(var(--theme-color-rgb),0.075)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white/72">Token shown once</p>
        <ClipboardActionButton
          action="copy"
          value={token.token}
          aria-label="Copy agent token"
          feedbackLabel="Copied token"
          className="size-7 rounded-[10px]"
        />
      </div>
      <p className="break-all font-mono text-[11px] leading-5 text-white/72">
        {token.token}
      </p>
      <p className="mt-2 text-[11px] font-medium text-white/44">
        Expires {formatGrantDate(token.expiresAt)}
      </p>
    </div>
  );
}
