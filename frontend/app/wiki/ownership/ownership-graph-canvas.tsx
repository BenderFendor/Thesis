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

  return (
    <section className="relative min-h-[680px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0f15]/88 backdrop-blur-md shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(201,166,107,0.18),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(91,140,255,0.14),transparent_34%)]" />
      <div
        className="absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,248,230,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,248,230,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.82)]" />

      <div className="absolute left-4 top-4 z-10 flex gap-2">
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

      <div className="absolute bottom-4 left-4 z-10 rounded-2xl border border-white/10 bg-[#090c11]/80 p-3 text-[11px] text-[#b4ab9b] backdrop-blur">
        <div className="mb-2 font-mono uppercase tracking-[0.18em] text-[#f0debc]">How to read</div>
        <div>Large brass nodes are owner groups.</div>
        <div>Small blue-to-red nodes are news sources by bias.</div>
        <div>Solid lines are ownership. Dashed lines are publishing links.</div>
      </div>

      <div ref={containerRef} className="relative h-full min-h-[680px]">
        {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#c9a66b]" />
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
                const alwaysLabel = !isSource(node) && node.degree >= 3;
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
                    />
                    {(alwaysLabel || isSelected || isHovered || matchingNodeIds.has(node.id)) && (
                      <text
                        x={node.x}
                        y={node.y - node.radius - 8}
                        textAnchor="middle"
                        fill={isSelected ? "#f6e7c7" : "rgba(241,235,222,0.82)"}
                        fontSize={isSource(node) ? 11 : 12}
                        fontFamily="ui-monospace, SFMono-Regular, monospace"
                        opacity={selectedNode && !emphasize && !alwaysLabel ? 0.35 : 1}
                      >
                        {node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {!loading && !errorMessage && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[#b4ab9b]">
            <div>
              <p className="font-serif text-lg text-[#f6f1e8]">No nodes match the current view</p>
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
      className="rounded-lg border border-white/10 bg-black/40 p-2 text-[#b4ab9b] transition-colors hover:border-[#c9a66b]/35 hover:text-[#f5ecd7]"
    >
      {children}
    </button>
  );
}
