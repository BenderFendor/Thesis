import { useRef, type ReactNode, type RefObject } from "react";
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { LayoutEdge, LayoutNode } from "./graph-utils";
import { edgeColor, edgeDash, isSource, nodeColor } from "./graph-utils";

interface OwnershipGraphCanvasProps {
  dimensions: { width: number; height: number };
  loading: boolean;
  errorMessage: string | null;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  nodesById: Map<string, LayoutNode>;
  matchingNodeIds: Set<string>;
  selectedNode: LayoutNode | null;
  selectedNeighborhood: Set<string>;
  hoveredNodeId: string | null;
  transform: { x: number; y: number; scale: number };
  containerRef: RefObject<HTMLDivElement | null>;
  onHoveredNodeChange: (value: string | null) => void;
  onSelectedNodeChange: (value: string) => void;
  onTransformChange: (value: { x: number; y: number; scale: number }) => void;
  onZoom: (direction: "in" | "out") => void;
  onResetView: () => void;
}

export function OwnershipGraphCanvas({
  dimensions,
  loading,
  errorMessage,
  nodes,
  edges,
  nodesById,
  matchingNodeIds,
  selectedNode,
  selectedNeighborhood,
  hoveredNodeId,
  transform,
  containerRef,
  onHoveredNodeChange,
  onSelectedNodeChange,
  onTransformChange,
  onZoom,
  onResetView,
}: OwnershipGraphCanvasProps) {
  const dragStateRef = useRef<null | { startX: number; startY: number; x: number; y: number }>(null);
  const ownershipTint = "rgba(201,166,107,0.16)";
  const sourceTint = "rgba(91,140,255,0.12)";
  const labelPriorityThreshold = Math.max(6, Math.floor(nodes.length / 55));
  const gridPatternId = `source-map-grid-${dimensions.width}-${dimensions.height}`;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-[1.4rem] border border-white/[0.08] bg-black/20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(208,175,115,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(109,119,132,0.12),transparent_28%)]" />

      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        <CanvasButton onClick={() => onZoom("in")}>
          <ZoomIn className="h-4 w-4" />
        </CanvasButton>
        <CanvasButton onClick={() => onZoom("out")}>
          <ZoomOut className="h-4 w-4" />
        </CanvasButton>
        <CanvasButton onClick={onResetView}>
          <RotateCcw className="h-4 w-4" />
        </CanvasButton>
      </div>

      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-background/70 p-3 text-[11px] text-muted-foreground backdrop-blur-sm">
        <div className="mb-2 font-mono uppercase tracking-[0.18em] text-muted-foreground">Legend</div>
        <div className="mb-1.5 flex items-center gap-2"><span className="text-[#8d6c34]">----</span> <span className="text-foreground">Ownership</span></div>
        <div className="mb-1.5 flex items-center gap-2"><span className="text-white/40">----</span> <span className="text-foreground">Publishes</span></div>
        <div className="mb-1.5 flex items-center gap-2"><div className="h-2.5 w-2.5 rounded-full border border-[#f4dfb6]/30 bg-[#f4dfb6]" /> <span className="text-foreground">Organization</span></div>
        <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-white/40" /> <span className="text-foreground">Media source</span></div>
      </div>

      <div ref={containerRef} className="relative h-full w-full">
        {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {errorMessage && !loading && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="rounded-2xl border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">{errorMessage}</div>
          </div>
        )}

        {!loading && !errorMessage && nodes.length > 0 && (
          <svg
            width={dimensions.width}
            height={dimensions.height}
            className="cursor-grab select-none"
            onMouseDown={(event) => {
              dragStateRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                x: transform.x,
                y: transform.y,
              };
            }}
            onMouseMove={(event) => {
              const dragState = dragStateRef.current;
              if (!dragState) return;
              onTransformChange({
                ...transform,
                x: dragState.x + event.clientX - dragState.startX,
                y: dragState.y + event.clientY - dragState.startY,
              });
            }}
            onMouseUp={() => {
              dragStateRef.current = null;
            }}
            onMouseLeave={() => {
              dragStateRef.current = null;
              onHoveredNodeChange(null);
            }}
            onWheel={(event) => {
              event.preventDefault();
              onTransformChange({
                ...transform,
                scale: event.deltaY < 0 ? Math.min(transform.scale * 1.08, 3.2) : Math.max(transform.scale / 1.08, 0.45),
              });
            }}
          >
            <defs>
              <pattern id={gridPatternId} width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={dimensions.width} height={dimensions.height} fill={`url(#${gridPatternId})`} />
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {edges.map((edge) => {
                const source = nodesById.get(edge.source);
                const target = nodesById.get(edge.target);
                if (!source || !target) return null;
                const isSelectedEdge = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);
                const dimmed = selectedNode ? !isSelectedEdge : false;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${edge.type}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edgeColor(edge.type)}
                    strokeWidth={isSelectedEdge ? 2.2 : edge.type === "ownership" ? 1.5 : 1}
                    strokeDasharray={edgeDash(edge.type)}
                    opacity={dimmed ? 0.18 : edge.type === "ownership" ? 0.88 : 0.65}
                    style={isSelectedEdge ? { filter: `drop-shadow(0 0 8px ${edge.type === "ownership" ? ownershipTint : sourceTint})` } : undefined}
                  />
                );
              })}

              {nodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                const isNeighbor = selectedNeighborhood.has(node.id);
                const isHovered = hoveredNodeId === node.id;
                const emphasize = isSelected || isHovered || isNeighbor;
                const alwaysLabel = node.degree >= labelPriorityThreshold && (!isSource(node) || node.degree >= labelPriorityThreshold + 2);
                const glow = isSelected
                  ? "drop-shadow(0 0 16px rgba(244,223,182,0.35))"
                  : isHovered
                    ? "drop-shadow(0 0 10px rgba(244,223,182,0.18))"
                    : undefined;
                return (
                  <g
                    key={node.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedNodeChange(node.id);
                    }}
                    onMouseEnter={() => onHoveredNodeChange(node.id)}
                    onMouseLeave={() => onHoveredNodeChange(null)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={isSelected ? node.radius + 3.5 : isHovered ? node.radius + 2 : node.radius}
                      fill={nodeColor(node)}
                      stroke={isSelected ? "#f4dfb6" : "rgba(255,248,230,0.24)"}
                      strokeWidth={isSelected ? 2.4 : 0.8}
                      opacity={selectedNode && !emphasize ? 0.28 : 0.97}
                      style={glow ? { filter: glow } : undefined}
                    />
                    {(alwaysLabel || isSelected || isHovered || matchingNodeIds.has(node.id)) && (
                      <g opacity={selectedNode && !emphasize && !alwaysLabel ? 0.35 : 1}>
                        <rect
                          x={node.x - Math.max(26, node.label.length * 3.15)}
                          y={node.y - node.radius - 21}
                          rx="7"
                          ry="7"
                          width={Math.max(52, node.label.length * 6.3)}
                          height="18"
                          fill="rgba(5,6,8,0.72)"
                          stroke={isSelected ? "rgba(208,175,115,0.35)" : "rgba(255,255,255,0.08)"}
                        />
                        <text
                          x={node.x}
                          y={node.y - node.radius - 8}
                          textAnchor="middle"
                          fill={isSelected ? "#f6e7c7" : "rgba(241,235,222,0.84)"}
                          fontSize={isSource(node) ? 10.5 : 11.5}
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                        >
                          {node.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {!loading && !errorMessage && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground">
            <div>
              <p className="font-serif text-lg text-foreground">No nodes match the current view</p>
              <p className="mt-2 text-sm">Clear the search or relax the filters to restore the network.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CanvasButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-background/70 p-2 text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
    >
      {children}
    </button>
  );
}
