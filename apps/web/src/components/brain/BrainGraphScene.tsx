import {
  resolveBrainLayoutLinks,
  resolveVisibleBrainLayoutNodes,
  type BrainClusterKey,
  type BrainGraphLayout,
  type BrainLayoutNode,
  type BrainPoint,
} from "@/lib/brain/graph";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

type BrainGraphSceneProps = {
  layout: BrainGraphLayout;
  activeNodeId: string | null;
  searchQuery: string;
  selectedClusterId: BrainClusterKey | null;
  onActiveNodeChange: (nodeId: string | null) => void;
  onSelectNode: (nodeId: string) => void;
};

export function BrainGraphScene({
  layout,
  activeNodeId,
  searchQuery,
  selectedClusterId,
  onActiveNodeChange,
  onSelectNode,
}: BrainGraphSceneProps) {
  const visibleNodes = resolveVisibleBrainLayoutNodes(layout.nodes, {
    clusterId: selectedClusterId,
    searchQuery,
  });
  const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
  const visibleLinks = resolveBrainLayoutLinks(visibleNodes);
  const activeNode = activeNodeId ? nodesById.get(activeNodeId) ?? null : null;

  return (
    <div
      className="relative h-full min-h-[420px] w-full overflow-hidden max-[720px]:min-h-[520px]"
      aria-label="Memory neural map"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {visibleLinks.map((link) => {
          const fromNode = nodesById.get(link.fromNodeId);
          const toNode = nodesById.get(link.toNodeId);
          if (!fromNode || !toNode) {
            return null;
          }

          const isActiveLink = Boolean(activeNodeId) && (
            link.fromNodeId === activeNodeId ||
            link.toNodeId === activeNodeId
          );

          return (
            <path
              key={link.id}
              d={formatLinePath(fromNode.position, toNode.position)}
              fill="none"
              stroke={link.color}
              strokeLinecap="round"
              strokeWidth={isActiveLink ? 1.35 : 0.82}
              vectorEffect="non-scaling-stroke"
              className={cn(
                "transition-opacity duration-150",
                activeNodeId
                  ? isActiveLink ? "opacity-70" : "opacity-[0.08]"
                  : "opacity-[0.28]",
              )}
            />
          );
        })}
      </svg>

      {visibleNodes.map((node) => (
        <BrainNodeButton
          key={node.id}
          node={node}
          active={activeNodeId === node.id}
          dimmed={Boolean(activeNodeId) && activeNodeId !== node.id}
          onActiveNodeChange={onActiveNodeChange}
          onSelectNode={onSelectNode}
        />
      ))}

      {visibleNodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-4">
          <div className="rounded-[14px] border border-white/8 bg-black/38 px-4 py-3 text-center text-sm font-medium text-[rgba(231,252,255,0.66)]">
            No matching memories
          </div>
        </div>
      ) : null}

      {activeNode ? <BrainScenePopover node={activeNode} /> : null}
    </div>
  );
}

function BrainNodeButton({
  active,
  dimmed,
  node,
  onActiveNodeChange,
  onSelectNode,
}: {
  active: boolean;
  dimmed: boolean;
  node: BrainLayoutNode;
  onActiveNodeChange: (nodeId: string | null) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${node.title}. ${node.clusterLabel} cluster. ${node.graphContextLabel ? `${node.graphContextLabel}. ` : ""}${node.categoryLabel}. ${node.sourceTypeLabel}. ${node.description}. Stored ${node.storedAtLabel}.`}
      className={cn(
        "group absolute z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full opacity-100 outline-none transition-[opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-white/45",
        active && "z-30",
        dimmed && "opacity-[0.18]",
      )}
      style={{
        left: `${node.position.x}%`,
        top: `${node.position.y}%`,
      }}
      onMouseEnter={() => onActiveNodeChange(node.id)}
      onMouseLeave={() => onActiveNodeChange(null)}
      onFocus={() => onActiveNodeChange(node.id)}
      onBlur={() => onActiveNodeChange(null)}
      onClick={() => onSelectNode(node.id)}
    >
      <span
        className={cn(
          "block rounded-full border border-white/35 opacity-95 transition-transform duration-150 group-hover:scale-125 group-focus-visible:scale-125",
          active && "scale-125 border-white/75 opacity-100",
        )}
        style={{
          backgroundColor: node.clusterColor,
          height: `${node.radius}px`,
          width: `${node.radius}px`,
        }}
      />
    </button>
  );
}

function BrainScenePopover({ node }: { node: BrainLayoutNode }) {
  const placement = resolvePopoverPlacement(node.position);

  return (
    <aside
      data-testid="brain-node-popover"
      className={cn(
        liquidGlass,
        "pointer-events-none absolute z-40 w-[min(340px,calc(100%-24px))] rounded-[14px] p-3 text-left shadow-[0_18px_60px_rgba(0,0,0,0.38)]",
      )}
      style={placement.style}
    >
      <p className="truncate text-sm font-semibold text-[#f8fdff]">{node.title}</p>
      {node.graphContextLabel ? (
        <p className="mt-1 truncate text-[10px] font-semibold text-[rgba(231,252,255,0.52)]">
          {node.graphContextLabel}
        </p>
      ) : null}
      <p className="mt-2 line-clamp-4 text-xs leading-5 text-[rgba(231,252,255,0.72)]">
        {node.description}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-semibold text-[rgba(231,252,255,0.54)]">
        <span className="min-w-0 truncate">{node.categoryLabel}</span>
        <span className="min-w-0 max-w-[62%] truncate text-right">
          {node.sourceTypeLabel} · {node.storedAtLabel}
        </span>
      </div>
    </aside>
  );
}

function resolvePopoverPlacement(position: BrainPoint) {
  const top = clampNumber(position.y, 18, 82);
  if (position.x > 62) {
    return {
      style: {
        right: `${formatPathCoordinate(100 - position.x)}%`,
        top: `${formatPathCoordinate(top)}%`,
        transform: "translate(-18px, -50%)",
      },
    };
  }

  return {
    style: {
      left: `${formatPathCoordinate(position.x)}%`,
      top: `${formatPathCoordinate(top)}%`,
      transform: "translate(18px, -50%)",
    },
  };
}

function formatLinePath(from: BrainPoint, to: BrainPoint) {
  return `M ${formatPathCoordinate(from.x)} ${formatPathCoordinate(from.y)} L ${formatPathCoordinate(to.x)} ${formatPathCoordinate(to.y)}`;
}

function formatPathCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
