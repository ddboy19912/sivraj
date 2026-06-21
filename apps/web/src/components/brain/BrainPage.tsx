import { LoaderCircle, RefreshCw, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { BrainGraphScene } from "@/components/brain/BrainGraphScene";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
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
import { useBrainGraph } from "@/hooks/brain/use-brain-graph";
import {
  buildBrainGraphLayout,
  resolveVisibleBrainLayoutNodes,
  type BrainClusterKey,
  type BrainLayoutNode,
} from "@/lib/brain/graph";
import type { Session } from "@/lib/session";
import type { BrainCanonicalMemoryContext, BrainGraphResponse } from "@/types/brain.types";

type BrainPageProps = {
  session: Session;
  twinName: string;
  onSessionRefreshed: (session: Session) => void;
};

export function BrainPage({
  session,
  twinName,
  onSessionRefreshed,
}: BrainPageProps) {
  const { refetch, viewState } = useBrainGraph({ session, onSessionRefreshed });

  if (viewState.status === "loading" || viewState.status === "idle") {
    return <BrainLoadingStatus />;
  }

  if (viewState.status === "error") {
    return (
      <BrainStatus label="Graph unavailable" value={viewState.message}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </BrainStatus>
    );
  }

  if (viewState.status === "empty") {
    return (
      <BrainStatus
        label="No graph memories"
        value="Knowledge points will appear here after Sivraj stores and links memory."
      />
    );
  }

  return (
    <BrainGraphStage
      graph={viewState.graph}
      twinName={twinName}
      onRefresh={() => void refetch()}
    />
  );
}

function BrainGraphStage({
  graph,
  twinName,
  onRefresh,
}: {
  graph: BrainGraphResponse;
  twinName: string;
  onRefresh: () => void;
}) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<BrainClusterKey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const layout = buildBrainGraphLayout(graph);
  const selectedNode = layout.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const visibleMemoryCount = resolveVisibleBrainLayoutNodes(layout.nodes, {
    clusterId: selectedCategoryId,
    searchQuery,
  }).length;
  const handleSearchQueryChange = (value: string) => {
    setActiveNodeId(null);
    setSearchQuery(value);
  };
  const handleSelectedCategoryChange = (clusterId: BrainClusterKey | null) => {
    setActiveNodeId(null);
    setSelectedCategoryId(clusterId);
  };

  return (
    <section
      className="brain-space-field absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#020409] px-6 pt-[88px] pb-[104px] text-[#f6feff] max-[720px]:px-4 max-[720px]:pt-[78px] max-[720px]:pb-[98px]"
      aria-label={`${twinName} brain graph`}
    >
      <div className="relative z-10 flex shrink-0 items-end justify-between gap-4 max-[860px]:items-start max-[860px]:gap-3 max-[720px]:flex-col">
        <div className="flex min-w-0 items-end gap-3 max-[720px]:w-full">
          <div className="min-w-0 pb-0.5">
            <h1 className="text-2xl font-semibold tracking-normal text-[#f8fdff] max-[680px]:text-xl">
              Brain
            </h1>
            <p className="mt-1 text-sm font-medium text-[rgba(231,252,255,0.58)]">
              {visibleMemoryCount} {visibleMemoryCount === 1 ? "memory" : "memories"}
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label="Refresh brain graph"
            title="Refresh brain graph"
            onClick={onRefresh}
            className="mb-0.5"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <BrainGraphHeaderControls
          groups={layout.groups}
          searchQuery={searchQuery}
          selectedClusterId={selectedCategoryId}
          onSearchQueryChange={handleSearchQueryChange}
          onSelectedClusterChange={handleSelectedCategoryChange}
        />
      </div>

      <div className="relative mt-5 min-h-0 flex-1 overflow-hidden">
        <BrainGraphScene
          layout={layout}
          activeNodeId={activeNodeId}
          searchQuery={searchQuery}
          selectedClusterId={selectedCategoryId}
          onActiveNodeChange={setActiveNodeId}
          onSelectNode={setSelectedNodeId}
        />
      </div>

      <BrainNodeDialog
        node={selectedNode}
        open={Boolean(selectedNode)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedNodeId(null);
          }
        }}
      />
    </section>
  );
}

function BrainGraphHeaderControls({
  groups,
  searchQuery,
  selectedClusterId,
  onSearchQueryChange,
  onSelectedClusterChange,
}: {
  groups: ReturnType<typeof buildBrainGraphLayout>["groups"];
  searchQuery: string;
  selectedClusterId: BrainClusterKey | null;
  onSearchQueryChange: (value: string) => void;
  onSelectedClusterChange: (clusterId: BrainClusterKey | null) => void;
}) {
  return (
    <fieldset
      className="flex w-[min(620px,58vw)] items-center gap-2 max-[860px]:w-[min(560px,64vw)] max-[720px]:w-full max-[520px]:flex-col max-[520px]:items-stretch"
      aria-label="Brain memory controls"
    >
      <legend className="sr-only">Brain memory controls</legend>
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[rgba(var(--theme-color-rgb),0.84)]"
        />
        <Input
          type="search"
          value={searchQuery}
          aria-label="Search brain memories"
          placeholder="Search memories"
          className="h-11 rounded-[15px] border-white/10 bg-[linear-gradient(180deg,rgba(8,13,20,0.9),rgba(3,7,12,0.82))] py-2 pl-7 pr-2.5 text-sm font-medium text-[rgba(246,253,255,0.9)] shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_12px_34px_rgba(0,0,0,0.24)] placeholder:text-[rgba(231,252,255,0.36)] hover:border-white/16 focus-visible:border-[rgba(var(--theme-color-rgb),0.58)] focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.14)]"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </div>
      <div className="w-[208px] shrink-0 max-[520px]:w-full">
        <Select
          value={selectedClusterId ?? "all"}
          onValueChange={(value) => {
            onSelectedClusterChange(value === "all" ? null : value as BrainClusterKey);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Filter brain memories by category"
            className="h-11 w-full rounded-[15px] border-white/10 bg-[linear-gradient(180deg,rgba(8,13,20,0.9),rgba(3,7,12,0.82))] pl-3 pr-2 text-sm font-medium text-[rgba(246,253,255,0.86)] shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_12px_34px_rgba(0,0,0,0.24)] hover:border-white/16 hover:bg-black/50 focus-visible:border-[rgba(var(--theme-color-rgb),0.58)] focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.14)]"
          >
            <SelectValue placeholder="All memories" />
          </SelectTrigger>
          <SelectContent
            align="end"
            className="z-[60] max-h-[320px] min-w-[230px] rounded-[14px]"
          >
            <SelectItem value="all">All memories</SelectItem>
            {groups.map((group) => (
              <SelectItem
                key={group.id}
                value={group.id}
                textValue={`${group.label} ${group.count}`}
              >
                <BrainCategoryOptionLabel
                  color={group.color}
                  label={group.label}
                  count={group.count}
                />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  );
}

function BrainCategoryOptionLabel({
  color,
  count,
  label,
}: {
  color: string;
  count: number;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-[rgba(246,253,255,0.44)]">{count}</span>
    </span>
  );
}

function BrainNodeDialog({
  node,
  open,
  onOpenChange,
}: {
  node: BrainLayoutNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(680px,calc(100svh-80px))] max-w-[520px] grid-rows-[auto_minmax(0,1fr)] rounded-[18px] max-[620px]:h-[min(620px,calc(100svh-32px))]">
        {node ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-3 text-base">{node.title}</DialogTitle>
              <DialogDescription>
                {node.graphContextLabel
                  ? `${node.graphContextLabel} · ${node.sourceTypeLabel} · Stored ${node.storedAtLabel}`
                  : `${node.categoryLabel} · ${node.sourceTypeLabel} · Stored ${node.storedAtLabel}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain px-5 py-5">
              {node.canonicalMemories.length > 0 ? (
                <BrainCanonicalMemoryPanel memories={node.canonicalMemories} />
              ) : null}
              <BrainNodeDescription description={node.description} />
              <div className="grid grid-cols-3 gap-3 max-[620px]:grid-cols-1">
                <BrainNodeDialogMeta label="Category" value={node.categoryLabel} />
                <BrainNodeDialogMeta label="Source" value={node.sourceTypeLabel} />
                <BrainNodeDialogMeta label="Stored" value={node.storedAtLabel} />
              </div>
              {node.sourceArtifactIds.length > 0 ? (
                <BrainNodeArtifactIds sourceArtifactIds={node.sourceArtifactIds} />
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BrainNodeDescription({ description }: { description: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[rgba(231,252,255,0.46)]">
        Description
      </p>
      <p className="mt-2 text-sm leading-6 text-[rgba(246,253,255,0.82)]">
        {description}
      </p>
    </div>
  );
}

function BrainCanonicalMemoryPanel({
  memories,
}: {
  memories: BrainCanonicalMemoryContext[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-[rgba(231,252,255,0.46)]">
        What Sivraj learned
      </p>
      <div className="mt-2 grid gap-2">
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="rounded-[12px] border border-white/8 bg-white/[0.035] px-3 py-3"
          >
            {memory.subject ? (
              <p className="text-xs font-semibold text-[rgba(231,252,255,0.58)]">
                {memory.subject}
              </p>
            ) : null}
            <p className="mt-1 text-sm leading-6 text-[rgba(246,253,255,0.84)]">
              {memory.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-[rgba(231,252,255,0.48)]">
              <span>{formatMemoryType(memory.memoryType)} memory</span>
              <span>{formatCanonicalSourceLabel(memory)}</span>
              <span>{formatEvidenceCount(memory.evidenceCount)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrainNodeDialogMeta({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[12px] border border-white/8 bg-white/[0.035] px-3 py-2">
      <p className="text-[10px] font-semibold text-[rgba(231,252,255,0.42)]">
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-semibold text-[rgba(246,253,255,0.76)]">
        {value}
      </p>
    </div>
  );
}

function BrainNodeArtifactIds({
  sourceArtifactIds,
}: {
  sourceArtifactIds: string[];
}) {
  const label = sourceArtifactIds.length === 1 ? "Artifact ID" : "Artifact IDs";

  return (
    <div>
      <p className="text-xs font-semibold text-[rgba(231,252,255,0.46)]">
        {label}
      </p>
      <div className="mt-2 grid gap-2">
        {sourceArtifactIds.map((sourceArtifactId) => (
          <div
            key={sourceArtifactId}
            className="flex min-w-0 items-center gap-2 rounded-[12px] border border-white/8 bg-white/[0.035] px-3 py-2"
          >
            <code className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[rgba(246,253,255,0.76)]">
              {sourceArtifactId}
            </code>
            <ClipboardActionButton
              action="copy"
              value={sourceArtifactId}
              aria-label={`Copy artifact ID ${sourceArtifactId}`}
              feedbackLabel="Copied artifact ID"
              className="size-7 shrink-0 rounded-[8px]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMemoryType(value: string) {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\S+/gu, (word) => (
      word.length <= 2
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    ));
}

function formatCanonicalSourceLabel(memory: BrainCanonicalMemoryContext) {
  const sourceType = memory.sourceType
    ? formatSourceType(memory.sourceType)
    : "Unknown source";

  return `From ${sourceType}`;
}

function formatSourceType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "chat_export" ||
    normalized === "chat_hot_memory_intake" ||
    normalized === "chat_hot_engineering_memory_intake"
  ) {
    return "Chat Memory";
  }

  if (normalized === "identity_profile") {
    return "Identity Profile";
  }

  if (normalized === "onboarding_self_description") {
    return "Onboarding";
  }

  if (normalized === "pdf" || normalized === "docx" || normalized === "ocr_pdf") {
    return normalized.toUpperCase().replace("_", " ");
  }

  return formatMemoryType(value);
}

function formatEvidenceCount(value: number) {
  const count = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
  return `${count} evidence ${count === 1 ? "signal" : "signals"}`;
}

function BrainStatus({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="brain-space-field absolute inset-0 z-20 grid place-items-center bg-[#020409] px-4 text-[#f6feff]"
      aria-label={label}
    >
      <div className="flex w-[min(440px,calc(100vw-32px))] flex-col gap-4 rounded-[18px] border border-white/10 bg-black/34 p-5">
        <div>
          <p className="text-xs font-semibold text-[rgba(231,252,255,0.56)]">
            Brain
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-normal">{label}</h1>
          <p className="mt-2 text-sm leading-6 text-[rgba(231,252,255,0.68)]">
            {value}
          </p>
        </div>
        {children ? <div>{children}</div> : null}
      </div>
    </section>
  );
}

function BrainLoadingStatus() {
  return (
    <section
      className="brain-space-field absolute inset-0 z-20 grid place-items-center bg-[#020409] px-4 text-[#f6feff]"
      aria-label="Loading graph"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="size-8 animate-spin text-[rgba(var(--theme-color-rgb),0.96)]"
        />
        <div>
          <h1 className="text-sm font-semibold tracking-normal text-[#f8fdff]">
            Loading brain
          </h1>
          <p className="mt-1 text-xs font-medium text-[rgba(231,252,255,0.58)]">
            Reading memory graph
          </p>
        </div>
      </div>
    </section>
  );
}
