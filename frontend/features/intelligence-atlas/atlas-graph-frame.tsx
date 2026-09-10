"use client";

import { hasText } from "@/lib/utils";
import { Minus, Plus, Scan } from "lucide-react";
import type { ReactNode, RefCallback } from "react";
import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import { AtlasAccessibleList } from "./atlas-accessible-list";
import type { AtlasPosition } from "./lib/atlas-force-layout";
import type {
  AtlasGraphPanState,
  AtlasGraphSelectionState,
  AtlasGraphZoomState,
  AtlasKeyboardEvent,
  AtlasPointerEvent,
  AtlasWheelEvent,
  Transform,
} from "./atlas-graph-types";
import { AtlasEdgeLine, AtlasNodeMark } from "./atlas-graph-visuals";
import type { AtlasNodeMarkProps } from "./atlas-graph-visuals";
import styles from "./atlas.module.css";

interface AtlasNodeLayerProps {
  activeNodeId: string | null;
  focus: boolean;
  interactionNeighbors: ReadonlySet<string>;
  interactionNodeId: string | null;
  nodes: readonly AtlasNode[];
  onHover: (nodeId: string) => void;
  onHoverLeave: (nodeId: string) => void;
  onNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  positions: Readonly<Record<string, AtlasPosition>>;
  priorityLabelIds: ReadonlySet<string>;
  selectedId: string | null;
  selectedNeighbors: ReadonlySet<string>;
  transformScale: number;
  hoveredNodeId: string | null;
}

type AtlasNodeLayerContext = Omit<AtlasNodeLayerProps, "nodes">;

const isAtlasNodeDimmed = (nodeId: string, context: AtlasNodeLayerContext): boolean => {
  const outsideFocus =
      context.focus && hasText(context.selectedId) && !context.selectedNeighbors.has(nodeId),
    outsideInteraction =
      hasText(context.interactionNodeId) && !context.interactionNeighbors.has(nodeId);
  return outsideFocus || outsideInteraction;
};

const shouldShowAtlasNodeLabel = (
  nodeId: string,
  selected: boolean,
  interacting: boolean,
  context: AtlasNodeLayerContext,
): boolean =>
  context.transformScale >= 1.15 || context.priorityLabelIds.has(nodeId) || selected || interacting;

const isAtlasNodePriority = (
  nodeId: string,
  selected: boolean,
  interacting: boolean,
  context: AtlasNodeLayerContext,
): boolean => selected || interacting || context.priorityLabelIds.has(nodeId);

const getAtlasNodeMarkHandlers = (
  nodeId: string,
  context: AtlasNodeLayerContext,
): Pick<AtlasNodeMarkProps, "onClick" | "onKeyDown" | "onMouseEnter" | "onMouseLeave"> => ({
  onClick: (event) => {
    event.stopPropagation();
    context.onSelect(nodeId);
  },
  onKeyDown: (event) => {
    context.onNodeKeyboard(event, nodeId);
  },
  onMouseEnter: () => {
    context.onHover(nodeId);
  },
  onMouseLeave: () => {
    context.onHoverLeave(nodeId);
  },
});

const getAtlasNodeMarkProps = (
  node: AtlasNode,
  context: AtlasNodeLayerContext,
): AtlasNodeMarkProps | null => {
  const position = context.positions[node.id];
  if (!position) {
    return null;
  }
  const dimmed = isAtlasNodeDimmed(node.id, context),
    interacting = context.hoveredNodeId === node.id,
    selected = context.selectedId === node.id,
    showLabel = shouldShowAtlasNodeLabel(node.id, selected, interacting, context);
  const handlers = getAtlasNodeMarkHandlers(node.id, context);
  return {
    ...handlers,
    active: context.activeNodeId === node.id,
    dimmed,
    node,
    position,
    priorityLabel: isAtlasNodePriority(node.id, selected, interacting, context),
    selected,
    showLabel,
  };
};

const renderAtlasNode = (node: AtlasNode, context: AtlasNodeLayerContext): ReactNode => {
  const props = getAtlasNodeMarkProps(node, context);
  if (props) {
    return (
      <AtlasNodeMark
        key={node.id}
        active={props.active}
        dimmed={props.dimmed}
        node={props.node}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
        position={props.position}
        priorityLabel={props.priorityLabel}
        selected={props.selected}
        showLabel={props.showLabel}
      />
    );
  }
  return null;
};

const AtlasNodeLayer = ({
  activeNodeId,
  focus,
  interactionNeighbors,
  interactionNodeId,
  nodes,
  onHover,
  onHoverLeave,
  onNodeKeyboard,
  onSelect,
  positions,
  priorityLabelIds,
  selectedId,
  selectedNeighbors,
  transformScale,
  hoveredNodeId,
}: Readonly<AtlasNodeLayerProps>) => {
  const context: AtlasNodeLayerContext = {
    activeNodeId,
    focus,
    hoveredNodeId,
    interactionNeighbors,
    interactionNodeId,
    onHover,
    onHoverLeave,
    onNodeKeyboard,
    onSelect,
    positions,
    priorityLabelIds,
    selectedId,
    selectedNeighbors,
    transformScale,
  };
  return <>{nodes.map((node) => renderAtlasNode(node, context))}</>;
};

interface AtlasGraphFrameProps {
  readonly containerRef: RefCallback<HTMLDivElement>;
  readonly edges: readonly AtlasEdge[];
  readonly focus: boolean;
  readonly nodes: readonly AtlasNode[];
  readonly onSelect: (nodeId: string) => void;
  readonly pan: AtlasGraphPanState;
  readonly positions: Readonly<Record<string, AtlasPosition>>;
  readonly selectedId: string | null;
  readonly selection: AtlasGraphSelectionState;
  readonly stable: boolean;
  readonly svgRef: RefCallback<SVGSVGElement>;
  readonly zoom: AtlasGraphZoomState;
}

interface AtlasGraphSurfaceProps {
  readonly edges: readonly AtlasEdge[];
  readonly focus: boolean;
  readonly nodes: readonly AtlasNode[];
  readonly pan: AtlasGraphPanState;
  readonly positions: Readonly<Record<string, AtlasPosition>>;
  readonly selection: AtlasGraphSelectionState;
  readonly selectedId: string | null;
  readonly svgRef: RefCallback<SVGSVGElement>;
  readonly zoom: AtlasGraphZoomState;
}

const AtlasGraphSurface = ({
  edges,
  focus,
  nodes,
  pan,
  positions,
  selection,
  selectedId,
  svgRef,
  zoom,
}: Readonly<AtlasGraphSurfaceProps>): ReactNode => {
  const handleHover = selection.onHover;
  return (
    <AtlasGraphSvg
      activeNodeId={selection.activeNodeId}
      edges={edges}
      focus={focus}
      hoveredNodeId={selection.hoveredNodeId}
      interactionNeighbors={selection.interactionNeighbors}
      interactionNodeId={selection.interactionNodeId}
      nodes={nodes}
      onHover={handleHover}
      onHoverLeave={selection.handleHoverLeave}
      onNodeKeyboard={selection.handleNodeKeyboard}
      onNodeSelect={selection.handleNodeSelect}
      onPointerDown={pan.handlePointerDown}
      onPointerMove={pan.handlePointerMove}
      onPointerUp={pan.handlePointerUp}
      onWheel={zoom.handleWheel}
      panning={pan.panning}
      positions={positions}
      priorityLabelIds={selection.priorityLabelIds}
      selectedId={selectedId}
      selectedNeighbors={selection.selectedNeighbors}
      svgRef={svgRef}
      transform={zoom.transform}
    />
  );
};

const AtlasGraphFrame = ({
  containerRef,
  edges,
  focus,
  nodes,
  onSelect,
  pan,
  positions,
  selectedId,
  selection,
  stable,
  svgRef,
  zoom,
}: Readonly<AtlasGraphFrameProps>): ReactNode => {
  const handleFit = zoom.fitGraph;
  const handleZoomIn = zoom.zoomIn;
  const handleZoomOut = zoom.zoomOut;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <AtlasGraphSurface
        edges={edges}
        focus={focus}
        nodes={nodes}
        pan={pan}
        positions={positions}
        selection={selection}
        selectedId={selectedId}
        svgRef={svgRef}
        zoom={zoom}
      />
      <AtlasGraphControls onFit={handleFit} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
      <AtlasGraphLegend />
      <AtlasGraphHoverCard node={selection.hoveredNode} />
      <AtlasGraphStatus stable={stable} />
      <AtlasAccessibleList
        nodes={nodes}
        edges={edges}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  );
};

interface AtlasGraphSvgProps {
  readonly activeNodeId: string | null;
  readonly edges: readonly AtlasEdge[];
  readonly focus: boolean;
  readonly hoveredNodeId: string | null;
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly nodes: readonly AtlasNode[];
  readonly onHover: (nodeId: string) => void;
  readonly onHoverLeave: (nodeId: string) => void;
  readonly onNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  readonly onNodeSelect: (nodeId: string) => void;
  readonly onPointerDown: (event: AtlasPointerEvent) => void;
  readonly onPointerMove: (event: AtlasPointerEvent) => void;
  readonly onPointerUp: (event: AtlasPointerEvent) => void;
  readonly onWheel: (event: AtlasWheelEvent) => void;
  readonly panning: boolean;
  readonly positions: Readonly<Record<string, AtlasPosition>>;
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedId: string | null;
  readonly selectedNeighbors: ReadonlySet<string>;
  readonly svgRef: RefCallback<SVGSVGElement>;
  readonly transform: Transform;
}

const AtlasGraphMarkers = (): ReactNode => (
  <defs>
    <marker
      id="atlas-arrow-gold"
      markerWidth="7"
      markerHeight="7"
      refX="6"
      refY="3.5"
      orient="auto"
    >
      <path d="M0,0 L7,3.5 L0,7 Z" fill="#d7b35f" />
    </marker>
    <marker
      id="atlas-arrow-neutral"
      markerWidth="7"
      markerHeight="7"
      refX="6"
      refY="3.5"
      orient="auto"
    >
      <path d="M0,0 L7,3.5 L0,7 Z" fill="#b8b2a7" />
    </marker>
  </defs>
);

type AtlasGraphLayerProps = Omit<
  AtlasGraphSvgProps,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onWheel" | "panning" | "svgRef"
>;

interface AtlasGraphLayersProps {
  readonly graph: Readonly<AtlasGraphLayerProps>;
}

const renderAtlasEdges = (graph: Readonly<AtlasGraphLayerProps>): ReactNode => (
  <>
    {graph.edges.map((edge) => (
      <AtlasEdgeLine
        key={edge.id}
        edge={edge}
        focus={graph.focus}
        interactionNodeId={graph.interactionNodeId}
        selectedId={graph.selectedId}
        selectedNeighbors={graph.selectedNeighbors}
        source={graph.positions[edge.source_id]}
        target={graph.positions[edge.target_id]}
      />
    ))}
  </>
);

const AtlasGraphNodeLayer = ({ graph }: Readonly<AtlasGraphLayersProps>): ReactNode => {
  const handleHover = graph.onHover;
  const handleHoverLeave = graph.onHoverLeave;
  const handleNodeKeyboard = graph.onNodeKeyboard;
  const handleNodeSelect = graph.onNodeSelect;
  return (
    <AtlasNodeLayer
      activeNodeId={graph.activeNodeId}
      focus={graph.focus}
      interactionNeighbors={graph.interactionNeighbors}
      interactionNodeId={graph.interactionNodeId}
      nodes={graph.nodes}
      onHover={handleHover}
      onHoverLeave={handleHoverLeave}
      onNodeKeyboard={handleNodeKeyboard}
      onSelect={handleNodeSelect}
      positions={graph.positions}
      priorityLabelIds={graph.priorityLabelIds}
      selectedId={graph.selectedId}
      selectedNeighbors={graph.selectedNeighbors}
      transformScale={graph.transform.scale}
      hoveredNodeId={graph.hoveredNodeId}
    />
  );
};

const AtlasGraphLayers = ({ graph }: Readonly<AtlasGraphLayersProps>): ReactNode => (
  <g
    transform={`translate(${graph.transform.offsetX} ${graph.transform.offsetY}) scale(${graph.transform.scale})`}
  >
    {renderAtlasEdges(graph)}
    <AtlasGraphNodeLayer graph={graph} />
  </g>
);

const AtlasGraphSvg = ({
  onPointerDown: handlePointerDown,
  onPointerMove: handlePointerMove,
  onPointerUp: handlePointerUp,
  onWheel: handleWheel,
  panning,
  svgRef,
  ...layerProps
}: Readonly<AtlasGraphSvgProps>): ReactNode => (
  <svg
    ref={svgRef}
    className={styles.graphCanvas}
    data-panning={panning}
    aria-label={`Intelligence Atlas graph with ${layerProps.nodes.length} entities and ${layerProps.edges.length} relationships`}
    onWheel={handleWheel}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerCancel={handlePointerUp}
  >
    <AtlasGraphMarkers />
    <AtlasGraphLayers graph={layerProps} />
  </svg>
);

interface AtlasGraphControlsProps {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const AtlasGraphControls = ({
  onFit,
  onZoomIn,
  onZoomOut,
}: Readonly<AtlasGraphControlsProps>): ReactNode => (
  <div className="absolute bottom-24 left-5 z-10 flex gap-2">
    <button type="button" className={styles.iconButton} aria-label="Zoom in" onClick={onZoomIn}>
      <Plus className="h-4 w-4" />
    </button>
    <button type="button" className={styles.iconButton} aria-label="Zoom out" onClick={onZoomOut}>
      <Minus className="h-4 w-4" />
    </button>
    <button
      type="button"
      className={styles.iconButton}
      aria-label="Fit visible graph"
      onClick={onFit}
    >
      <Scan className="h-4 w-4" />
    </button>
  </div>
);

const AtlasGraphLegend = (): ReactNode => (
  <div className={styles.graphLegend} aria-hidden="true">
    <span>
      <span className="text-[#f0ede4]">■</span> outlet
    </span>
    <span>
      <span className="text-[#d7b35f]">●</span> organization
    </span>
    <span>
      <span className="text-[#e08a5f]">◆</span> person
    </span>
    <span>
      <span className="text-[#88a9ff]">◆</span> reporter
    </span>
    <span>Zoom for all labels</span>
  </div>
);

const AtlasGraphHoverCard = ({ node }: Readonly<{ node: AtlasNode | null }>): ReactNode => {
  if (!node) {
    return null;
  }
  return (
    <div className={styles.graphHoverCard} aria-hidden="true">
      <div className={styles.brandEyebrow}>{node.entity_type}</div>
      <div className="mt-1 font-serif text-xl text-[#f0ede4]">{node.label}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#77736a]">
        <span>{node.connection_count} links</span>
        <span>{node.article_count} articles</span>
        {Boolean(node.bias_rating) && <span>{node.bias_rating}</span>}
        {Boolean(node.funding_type) && <span>{node.funding_type}</span>}
      </div>
    </div>
  );
};

const AtlasGraphStatus = ({ stable }: Readonly<{ stable: boolean }>): ReactNode => (
  <div className={styles.graphStatus} aria-live="polite">
    <span
      className={`h-1.5 w-1.5 rounded-full ${(() => {
        if (stable) {
          return "bg-emerald-300";
        }
        return "animate-pulse bg-amber-300";
      })()}`}
    />
    {(() => {
      if (stable) {
        return "Layout stable";
      }
      return "Calculating layout";
    })()}
  </div>
);

export { AtlasGraphFrame };
