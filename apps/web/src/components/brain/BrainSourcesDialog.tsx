import {
  Archive,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBrainArtifactContent, useBrainSources } from "@/hooks/brain/use-brain-sources";
import type { Session } from "@/lib/session";
import { cn } from "@/lib/ui/utils";
import type {
  BrainArtifactContentResponse,
  BrainSourceArtifactSummary,
  BrainSourceKindFilter,
} from "@/types/brain.types";

type BrainSourcesDialogProps = {
  open: boolean;
  session: Session;
  onOpenChange: (open: boolean) => void;
  onSessionRefreshed: (session: Session) => void;
};

const SOURCE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function BrainSourcesDialog({
  open,
  session,
  onOpenChange,
  onSessionRefreshed,
}: BrainSourcesDialogProps) {
  const [kind, setKind] = useState<BrainSourceKindFilter>("agent_instructions");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const sourcesQuery = useBrainSources({ session, kind, onSessionRefreshed });
  const sources = sourcesQuery.data?.sources ?? [];
  const selectedSource = sources.find((source) => source.artifactId === selectedArtifactId) ??
    sources[0] ??
    null;
  const contentQuery = useBrainArtifactContent({
    session,
    artifactId: selectedSource?.artifactId ?? null,
    onSessionRefreshed,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(760px,calc(100svh-56px))] max-w-[980px] grid-rows-[auto_minmax(0,1fr)] rounded-[18px] max-[760px]:h-[calc(100svh-28px)]">
        <DialogHeader>
          <DialogTitle className="pr-3 text-base">Brain sources</DialogTitle>
          <DialogDescription>
            Exact encrypted source artifacts, opened only with memory read access.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-0 max-[760px]:grid-cols-1">
          <aside className="min-h-0 border-r border-white/[0.06] p-4 max-[760px]:max-h-[260px] max-[760px]:border-r-0 max-[760px]:border-b">
            <div className="flex items-center gap-2">
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value === "all" ? "all" : "agent_instructions");
                  setSelectedArtifactId(null);
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Filter brain sources"
                  className="h-9 rounded-[12px] border-white/10 bg-white/[0.045]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="agent_instructions">Agent skills</SelectItem>
                  <SelectItem value="all">All sources</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BrainSourcesList
              isLoading={sourcesQuery.isLoading || sourcesQuery.isFetching}
              error={sourcesQuery.error}
              sources={sources}
              selectedArtifactId={selectedSource?.artifactId ?? null}
              onSelectSource={setSelectedArtifactId}
            />
          </aside>
          <BrainSourceContentPanel
            source={selectedSource}
            content={contentQuery.data ?? null}
            isLoading={contentQuery.isLoading || contentQuery.isFetching}
            error={contentQuery.error}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BrainSourcesList({
  error,
  isLoading,
  onSelectSource,
  selectedArtifactId,
  sources,
}: {
  error: unknown;
  isLoading: boolean;
  onSelectSource: (artifactId: string) => void;
  selectedArtifactId: string | null;
  sources: BrainSourceArtifactSummary[];
}) {
  if (isLoading) {
    return <BrainSourceListStatus label="Loading sources" loading />;
  }

  if (error) {
    return <BrainSourceListStatus label="Sources unavailable" />;
  }

  if (sources.length === 0) {
    return <BrainSourceListStatus label="No agent skill sources yet" />;
  }

  return (
    <div className="mt-3 grid max-h-[calc(100%-44px)] gap-2 overflow-y-auto pr-1">
      {sources.map((source) => {
        const active = source.artifactId === selectedArtifactId;

        return (
          <button
            type="button"
            key={source.artifactId}
            aria-pressed={active}
            onClick={() => onSelectSource(source.artifactId)}
            className={cn(
              "flex min-w-0 items-start gap-3 rounded-[12px] border px-3 py-2.5 text-left transition",
              active
                ? "border-[rgba(var(--theme-color-rgb),0.46)] bg-[rgba(var(--theme-color-rgb),0.12)]"
                : "border-white/8 bg-white/[0.035] hover:border-white/16 hover:bg-white/[0.055]",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-white/62">
              {source.sourceKind === "agent_instruction_file"
                ? <FileCode2 className="size-4" />
                : <FileText className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white/84">
                {source.displayName}
              </span>
              <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-medium text-white/42">
                <SourceStatusIcon status={source.ingestionStatus} />
                <span>{formatSourceType(source.sourceType)}</span>
                <span>{formatDate(source.createdAt)}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BrainSourceListStatus({
  label,
  loading = false,
}: {
  label: string;
  loading?: boolean;
}) {
  return (
    <div className="mt-3 grid min-h-[160px] place-items-center rounded-[14px] border border-white/8 bg-white/[0.025] text-center">
      <div className="grid justify-items-center gap-2">
        {loading ? (
          <LoaderCircle className="size-5 animate-spin text-[rgba(var(--theme-color-rgb),0.9)]" />
        ) : (
          <Archive className="size-5 text-white/38" />
        )}
        <p className="text-sm font-medium text-white/56">{label}</p>
      </div>
    </div>
  );
}

function BrainSourceContentPanel({
  content,
  error,
  isLoading,
  source,
}: {
  content: BrainArtifactContentResponse | null;
  error: unknown;
  isLoading: boolean;
  source: BrainSourceArtifactSummary | null;
}) {
  if (!source) {
    return (
      <section className="grid min-h-0 place-items-center p-5 text-center">
        <p className="text-sm font-medium text-white/48">Select a source to inspect.</p>
      </section>
    );
  }

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-white/90">{source.displayName}</h2>
          <p className="mt-1 text-xs font-medium text-white/42">
            {source.engineeringMemoryCount} engineering memories · {source.candidateMemoryCount} candidates
          </p>
        </div>
        {content ? (
          <div className="flex shrink-0 items-center gap-1">
            <ClipboardActionButton
              action="copy"
              value={content.content}
              aria-label={`Copy ${content.artifact.fileName}`}
              feedbackLabel="Copied source"
              className="size-8 rounded-[10px]"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label={`Download ${content.artifact.fileName}`}
              title={`Download ${content.artifact.fileName}`}
              onClick={() => downloadSourceContent(content)}
              className="rounded-[10px]"
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto p-5">
        {isLoading ? (
          <BrainSourceContentStatus label="Decrypting source" loading />
        ) : error ? (
          <BrainSourceContentStatus label="Source content unavailable" />
        ) : content ? (
          <pre className="min-h-full whitespace-pre-wrap break-words rounded-[14px] border border-white/8 bg-black/24 p-4 font-mono text-[12px] leading-5 text-white/78">
            {content.content}
          </pre>
        ) : (
          <BrainSourceContentStatus label="Select a source" />
        )}
      </div>
    </section>
  );
}

function BrainSourceContentStatus({
  label,
  loading = false,
}: {
  label: string;
  loading?: boolean;
}) {
  return (
    <div className="grid min-h-[220px] place-items-center rounded-[14px] border border-white/8 bg-white/[0.025] text-sm font-medium text-white/48">
      <span className="flex items-center gap-2">
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {label}
      </span>
    </div>
  );
}

function SourceStatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 text-emerald-200/70" />;
  }

  if (status === "failed" || status === "cancelled") {
    return <XCircle className="size-3.5 text-red-200/70" />;
  }

  return <LoaderCircle className="size-3.5 animate-spin text-white/45" />;
}

function downloadSourceContent(content: BrainArtifactContentResponse) {
  if (content.artifact.encoding === "data_url") {
    const link = document.createElement("a");
    link.href = content.content;
    link.download = content.artifact.fileName;
    link.rel = "noopener noreferrer";
    link.click();
    return;
  }

  const blob = new Blob([content.content], { type: content.artifact.contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = content.artifact.fileName;
  link.rel = "noopener noreferrer";
  link.click();
  URL.revokeObjectURL(url);
}

function formatSourceType(value: string) {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\S+/gu, (word) =>
      word.length <= 2
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`,
    );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : SOURCE_DATE_FORMATTER.format(date);
}
