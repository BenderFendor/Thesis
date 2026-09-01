"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode, WheelEvent } from 'react';
import { Minus, Plus, Scan } from "lucide-react";

import { useAtlasLayout } from "./hooks/use-atlas-layout";
import type { AtlasLayoutMode } from "./lib/atlas-query-state";
import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import type { AtlasPosition } from "./lib/atlas-force-layout";
import { AtlasAccessibleList } from "./atlas-accessible-list";
import styles from "./atlas.module.css";

interface AtlasGraphProps {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  graphVersion: string;
  layout: AtlasLayoutMode;
  selectedId: string | null;
  focus: boolean;
  loading: boolean;
  onSelect: (nodeId: string) => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const ENTITY_FILL: Record<AtlasNode["entity_type"], string> = {
  organization: "#d7b35f",
  outlet: "#f0ede4",
  person: "#e08a5f",
  reporter: "#88a9ff",
},

 EDGE_STROKE: Record<AtlasEdge["relation_type"], string> = {
  coauthor: "#88a9ff",
  current_outlet: "#88a9ff",
  employed_by: "#8ca0c8",
  founded_by: "#e08a5f",
  owned_by: "#b79348",
  ownership: "#d7b35f",
  parent_org: "#b79348",
  part_of: "#a88645",
  publishes: "#b8b2a7",
  shared_outlet: "#6f86bd",
  sibling_via_owner: "#7d6f5a",
};

function nodeRadius(node: AtlasNode): number {
  const base = node.entity_type === "organization" ? 12 : node.entity_type === "outlet" ? 9 : node.entity_type === "person" ? 8 : 8,
   degree = Math.min(Math.log2(1 + node.connection_count) * 1.4, 8),
   articles = Math.min(Math.log10(1 + node.article_count) * 0.8, 3);
  return base + degree + articles;
}

function nodeShape(node: AtlasNode, radius: number) {
  if (node.entity_type === "outlet") {
    return <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.35} />;
  }
  if (node.entity_type === "reporter") {
    return <path d={`M 0 ${-radius} C ${radius} ${-radius} ${radius} ${radius * 0.55} 0 ${radius} C ${-radius} ${radius * 0.55} ${-radius} ${-radius} 0 ${-radius} Z`} />;
  }
  if (node.entity_type === "person") {
    return <path d={`M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`} />;
  }
  return <circle r={radius} />;
}

function handleAtlasNodeKeyboard(
  event: KeyboardEvent<SVGGElement>,
  nodeId: string,
  orderedNodes:readonly  AtlasNode[],
  onSelect: (nodeId: string) => void,
  setKeyboardActiveNodeId: (nodeId: string) => void,
  svgRef:Readonly< { current: SVGSVGElement | null }>,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(nodeId);
    return;
  }
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {return;}
  event.preventDefault();
  const currentIndex = orderedNodes.findIndex((node) => node.id === nodeId),
   direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1,
   nextIndex = (currentIndex + direction + orderedNodes.length) % orderedNodes.length,
   nextNode = orderedNodes[nextIndex];
  if (!nextNode) {return;}
  setKeyboardActiveNodeId(nextNode.id);
  requestAnimationFrame(() => {
    svgRef.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(nextNode.id)}"]`)?.focus();
  });
}

interface AtlasNodeMarkProps {
  active: boolean;
  dimmed: boolean;
  node: AtlasNode;
  onHover: (nodeId: string) => void;
  onHoverLeave: (nodeId: string) => void;
  onNodeKeyboard: (event: KeyboardEvent<SVGGElement>, nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  position: AtlasPosition;
  priorityLabel: boolean;
  selected: boolean;
  showLabel: boolean;
}

function NeedsReviewMarker({ radius, visible }:Readonly< { radius: number; visible: boolean }>) {
  if (!visible) {
    return;
  }
  return <circle cx={radius * 0.7} cy={-radius * 0.7} r={3.2} fill="#f1635e" stroke="#080907" strokeWidth={1.5} />;
}

function AtlasNodeLabel({
  node,
  priority,
  radius,
  show,
}:Readonly< {
  node: AtlasNode;
  priority: boolean;
  radius: number;
  show: boolean;
}>) {
  if (!show) {
    return;
  }
  return (
    <>
      <text
        className={`${styles.nodeLabel} ${priority ? styles.nodeLabelPriority : ""}`}
        x={radius + 7}
        y={priority ? 0 : 1}
        fill="#f0ede4"
      >
        {node.label.length > 34 ? `${node.label.slice(0, 31)}…` : node.label}
      </text>
      {priority ? (
        <text className={styles.nodeMeta} x={radius + 7} y={14}>
          {node.entity_type} · {node.connection_count} links
        </text>
      ) : null}
    </>
  );
}

function AtlasNodeMark({
  active,
  dimmed,
  node,
  onHover,
  onHoverLeave,
  onNodeKeyboard,
  onSelect,
  position,
  priorityLabel,
  selected,
  showLabel,
}: AtlasNodeMarkProps) {
  const radius = nodeRadius(node),
   confidence = node.confidence_tier ?? "unresolved";
  return (
    <g
      data-node-id={node.id}
      className={styles.nodeButton}
      transform={`translate(${position.x} ${position.y})`}
      tabIndex={active ? 0 : -1}
      role="button"
      aria-label={`${node.label}, ${node.entity_type}, ${node.connection_count} connections, ${confidence} confidence`}
      aria-pressed={selected}
      opacity={dimmed ? 0.14 : 1}
      onMouseEnter={() =>{  onHover(node.id); }}
      onMouseLeave={() =>{  onHoverLeave(node.id); }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onKeyDown={(event) =>{  onNodeKeyboard(event, node.id); }}
    >
      <title>{`${node.label} — ${node.entity_type}, ${node.connection_count} connections, ${node.article_count} articles`}</title>
      <AtlasNodeGlyph
        node={node}
        priorityLabel={priorityLabel}
        radius={radius}
        selected={selected}
        showLabel={showLabel}
      />
    </g>
  );
}

function AtlasNodeGlyph({
  node,
  priorityLabel,
  radius,
  selected,
  showLabel,
}: {
  node: AtlasNode;
  priorityLabel: boolean;
  radius: number;
  selected: boolean;
  showLabel: boolean;
}) {
  return (
    <>
      <circle
        className={styles.nodeHalo}
        r={radius + (selected ? 8 : 5)}
        fill="transparent"
        stroke={selected ? "#d7b35f" : ENTITY_FILL[node.entity_type]}
        strokeOpacity={selected ? 0.9 : 0}
        strokeWidth={selected ? 2 : 1}
      />
      <g fill={ENTITY_FILL[node.entity_type]} fillOpacity={selected ? 1 : 0.82} stroke="#080907" strokeWidth={2}>
        {nodeShape(node, radius)}
      </g>
      <NeedsReviewMarker radius={radius} visible={node.flags.includes("needs-review")} />
      <AtlasNodeLabel node={node} priority={priorityLabel} radius={radius} show={showLabel} />
    </>
  );
}

interface AtlasEdgeLineProps {
  edge: AtlasEdge;
  focus: boolean;
  interactionNodeId: string | null;
  selectedId: string | null;
  selectedNeighbors: Set<string>;
  source: AtlasPosition | undefined;
  target: AtlasPosition | undefined;
}

interface AtlasEdgeVisuals {
  dashed: string | undefined;
  marker: string | undefined;
  opacity: number;
  width: number;
}

function atlasEdgeTouchesInteraction(edge: AtlasEdge, interactionNodeId: string | null): boolean {
  return Boolean(
    interactionNodeId && (edge.source_id === interactionNodeId || edge.target_id === interactionNodeId),
  );
}

function atlasEdgeIsDimmed(
  edge: AtlasEdge,
  focus: boolean,
  interactionNodeId: string | null,
  selectedId: string | null,
  selectedNeighbors: Set<string>,
  touchesInteraction: boolean,
): boolean {
  const focusDimmed = Boolean(
    focus && selectedId && !selectedNeighbors.has(edge.source_id) && !selectedNeighbors.has(edge.target_id),
  );
  return focusDimmed || Boolean(interactionNodeId && !touchesInteraction);
}

function atlasEdgeIsDashed(edge: AtlasEdge): boolean {
  return Boolean(
    edge.is_inferred || edge.confidence_tier === "likely" || edge.confidence_tier === "unresolved",
  );
}

function atlasEdgeMarker(edge: AtlasEdge): string | undefined {
  if (edge.direction !== "directed") {
    return undefined;
  }
  const marker = edge.relation_type === "ownership" ? "atlas-arrow-gold" : "atlas-arrow-neutral";
  return `url(#${marker})`;
}

function getAtlasEdgeVisuals(
  edge: AtlasEdge,
  focus: boolean,
  interactionNodeId: string | null,
  selectedId: string | null,
  selectedNeighbors: Set<string>,
): AtlasEdgeVisuals {
  const touchesInteraction = atlasEdgeTouchesInteraction(edge, interactionNodeId),
   dimmed = atlasEdgeIsDimmed(
    edge,
    focus,
    interactionNodeId,
    selectedId,
    selectedNeighbors,
    touchesInteraction,
  ),
   dashed = atlasEdgeIsDashed(edge),
   baseOpacity = Math.min(0.2, 0.06 + Math.log2(edge.weight + 1) * 0.025);
  return {
    dashed: dashed ? "5 5" : undefined,
    marker: atlasEdgeMarker(edge),
    opacity: dimmed ? 0.025 : (touchesInteraction ? 0.78 : baseOpacity),
    width: touchesInteraction ? 1.8 : Math.min(1.25, 0.55 + Math.log2(edge.weight + 1) * 0.14),
  };
}

function AtlasEdgeLine({
  edge,
  focus,
  interactionNodeId,
  selectedId,
  selectedNeighbors,
  source,
  target,
}: AtlasEdgeLineProps) {
  if (!source || !target) {
    return;
  }
  const visuals = getAtlasEdgeVisuals(edge, focus, interactionNodeId, selectedId, selectedNeighbors);
  return (
    <line
      className={styles.edge}
      x1={source.x}
      y1={source.y}
      x2={target.x}
      y2={target.y}
      stroke={EDGE_STROKE[edge.relation_type]}
      strokeOpacity={visuals.opacity}
      strokeWidth={visuals.width}
      strokeDasharray={visuals.dashed}
      markerEnd={visuals.marker}
    />
  );
}

interface AtlasNodeLayerProps {
  activeNodeId: string | null;
  focus: boolean;
  interactionNeighbors: Set<string>;
  interactionNodeId: string | null;
  nodes: AtlasNode[];
  onHover: (nodeId: string) => void;
  onHoverLeave: (nodeId: string) => void;
  onNodeKeyboard: (event: KeyboardEvent<SVGGElement>, nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  positions: Record<string, AtlasPosition>;
  priorityLabelIds: Set<string>;
  selectedId: string | null;
  selectedNeighbors: Set<string>;
  transformScale: number;
  hoveredNodeId: string | null;
}

type AtlasNodeLayerContext = Omit<AtlasNodeLayerProps, "nodes">;

function isAtlasNodeDimmed(nodeId: string, context: AtlasNodeLayerContext): boolean {
  const outsideFocus = context.focus && context.selectedId && !context.selectedNeighbors.has(nodeId),
   outsideInteraction = context.interactionNodeId && !context.interactionNeighbors.has(nodeId);
  return Boolean(outsideFocus || outsideInteraction);
}

function shouldShowAtlasNodeLabel(
  nodeId: string,
  selected: boolean,
  interacting: boolean,
  context: AtlasNodeLayerContext,
): boolean {
  return context.transformScale >= 1.15 || context.priorityLabelIds.has(nodeId) || selected || interacting;
}

function isAtlasNodePriority(
  nodeId: string,
  selected: boolean,
  interacting: boolean,
  context: AtlasNodeLayerContext,
): boolean {
  return selected || interacting || context.priorityLabelIds.has(nodeId);
}

function getAtlasNodeMarkProps(
  node: AtlasNode,
  context: AtlasNodeLayerContext,
): AtlasNodeMarkProps | null {
  const position = context.positions[node.id];
  if (!position) {
    return null;
  }
  const selected = context.selectedId === node.id,
   interacting = context.hoveredNodeId === node.id,
   dimmed = isAtlasNodeDimmed(node.id, context),
   showLabel = shouldShowAtlasNodeLabel(node.id, selected, interacting, context);
  return {
    active: context.activeNodeId === node.id,
    dimmed,
    node,
    onHover: context.onHover,
    onHoverLeave: context.onHoverLeave,
    onNodeKeyboard: context.onNodeKeyboard,
    onSelect: context.onSelect,
    position,
    priorityLabel: isAtlasNodePriority(node.id, selected, interacting, context),
    selected,
    showLabel,
  };
}

function renderAtlasNode(node: AtlasNode, context: AtlasNodeLayerContext): ReactNode {
  const props = getAtlasNodeMarkProps(node, context);
  return props ? <AtlasNodeMark key={node.id} {...props} /> : null;
}

function AtlasNodeLayer({
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
}: AtlasNodeLayerProps) {
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
  return (
    <>
      {nodes.map((node) => renderAtlasNode(node, context))}
    </>
  );
}

interface AtlasGraphDimensions {
  height: number;
  width: number;
}

interface AtlasElementRef<T extends Element> { current: T | null }

interface PanState {
  pointerId: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
}

function getAtlasGraphDimensions(rect: DOMRectReadOnly): AtlasGraphDimensions {
  return {
    height: Math.max(360, Math.round(rect.height)),
    width: Math.max(320, Math.round(rect.width)),
  };
}

function useAtlasGraphDimensions(
  containerRef: AtlasElementRef<HTMLDivElement>,
): AtlasGraphDimensions {
  const [dimensions, setDimensions] = useState<AtlasGraphDimensions>({ height: 760, width: 1280 });

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setDimensions(getAtlasGraphDimensions(entry.contentRect));
      }
    });
    observer.observe(containerRef.current);
    return () =>{  observer.disconnect(); };
  }, [containerRef]);

  return dimensions;
}

interface AtlasGraphLayoutInput {
  dimensions: AtlasGraphDimensions;
  edges: AtlasEdge[];
  graphVersion: string;
  layout: AtlasLayoutMode;
  nodes: AtlasNode[];
  selectedId: string | null;
}

function useAtlasGraphLayout({
  dimensions,
  edges,
  graphVersion,
  layout,
  nodes,
  selectedId,
}: AtlasGraphLayoutInput) {
  const layoutOptions = useMemo(
    () => ({
      edges,
      graphVersion,
      height: dimensions.height,
      layout,
      nodes,
      selectedId,
      width: dimensions.width,
    }),
    [dimensions.height, dimensions.width, edges, graphVersion, layout, nodes, selectedId],
  );
  return useAtlasLayout(layoutOptions);
}

function getAtlasNeighbors(edges:readonly AtlasEdge[], nodeId: string | null): Set<string> {
  const ids = new Set<string>();
  if (!nodeId) {
    return ids;
  }
  ids.add(nodeId);
  edges.forEach((edge) => {
    if (edge.source_id === nodeId) {
      ids.add(edge.target_id);
    }
    if (edge.target_id === nodeId) {
      ids.add(edge.source_id);
    }
  });
  return ids;
}

function getAtlasActiveNodeId(
  selectedId: string | null,
  keyboardActiveNodeId: string | null,
  nodes:readonly AtlasNode[],
  orderedNodes:readonly AtlasNode[],
): string | null {
  if (selectedId !== null) {
    return selectedId;
  }
  if (keyboardActiveNodeId && nodes.some((node) => node.id === keyboardActiveNodeId)) {
    return keyboardActiveNodeId;
  }
  return orderedNodes[0]?.id ?? null;
}

interface AtlasGraphSelectionState {
  activeNodeId: string | null;
  handleHoverLeave: (nodeId: string) => void;
  handleNodeKeyboard: (event: KeyboardEvent<SVGGElement>, nodeId: string) => void;
  handleNodeSelect: (nodeId: string) => void;
  hoveredNode: AtlasNode | null;
  hoveredNodeId: string | null;
  interactionNeighbors: Set<string>;
  interactionNodeId: string | null;
  keyboardActiveNodeId: string | null;
  onHover: (nodeId: string) => void;
  orderedNodes: AtlasNode[];
  priorityLabelIds: Set<string>;
  selectedNeighbors: Set<string>;
}

type AtlasNodeIdStateSetter = (
  value: string | null | ((current: string | null) => string | null),
) => void;

interface AtlasGraphSelectionValues {
  activeNodeId: string | null;
  hoveredNode: AtlasNode | null;
  hoveredNodeId: string | null;
  interactionNeighbors: Set<string>;
  interactionNodeId: string | null;
  keyboardActiveNodeId: string | null;
  onHover: (nodeId: string) => void;
  orderedNodes: AtlasNode[];
  priorityLabelIds: Set<string>;
  selectedNeighbors: Set<string>;
  setHoveredNodeId: AtlasNodeIdStateSetter;
  setKeyboardActiveNodeId: (nodeId: string) => void;
}

function useAtlasGraphSelectionValues(
  nodes:readonly AtlasNode[],
  edges:readonly AtlasEdge[],
  selectedId: string | null,
): AtlasGraphSelectionValues {
  const [keyboardActiveNodeId, setKeyboardActiveNodeId] = useState<string | null>(selectedId),
   [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null),
   selectedNeighbors = useMemo(() => getAtlasNeighbors(edges, selectedId), [edges, selectedId]),
   interactionNodeId = hoveredNodeId ?? selectedId,
   interactionNeighbors = useMemo(
    () => getAtlasNeighbors(edges, interactionNodeId),
    [edges, interactionNodeId],
  ),
   orderedNodes = useMemo(
    () => [...nodes].sort((left, right) => right.connection_count - left.connection_count || left.label.localeCompare(right.label)),
    [nodes],
  ),
   priorityLabelIds = useMemo(
    () => new Set(orderedNodes.slice(0, 28).map((node) => node.id)),
    [orderedNodes],
  );
  return {
    activeNodeId: getAtlasActiveNodeId(selectedId, keyboardActiveNodeId, nodes, orderedNodes),
    hoveredNode: nodes.find((node) => node.id === hoveredNodeId) ?? null,
    hoveredNodeId,
    interactionNeighbors,
    interactionNodeId,
    keyboardActiveNodeId,
    onHover: setHoveredNodeId,
    orderedNodes,
    priorityLabelIds,
    selectedNeighbors,
    setHoveredNodeId,
    setKeyboardActiveNodeId,
  };
}

interface AtlasGraphSelectionHandlers {
  handleHoverLeave: (nodeId: string) => void;
  handleNodeKeyboard: (event: KeyboardEvent<SVGGElement>, nodeId: string) => void;
  handleNodeSelect: (nodeId: string) => void;
}

function useAtlasGraphSelectionHandlers(
  orderedNodes:readonly AtlasNode[],
  onSelect: (nodeId: string) => void,
  svgRef: AtlasElementRef<SVGSVGElement>,
  setKeyboardActiveNodeId: (nodeId: string) => void,
  setHoveredNodeId: AtlasNodeIdStateSetter,
): AtlasGraphSelectionHandlers {
  const handleNodeKeyboard = useCallback(
    (event: KeyboardEvent<SVGGElement>, nodeId: string) => {
      handleAtlasNodeKeyboard(
        event,
        nodeId,
        orderedNodes,
        onSelect,
        setKeyboardActiveNodeId,
        svgRef,
      );
    },
    [onSelect, orderedNodes, svgRef],
  ),
   handleNodeSelect = useCallback(
    (nodeId: string) => {
      setKeyboardActiveNodeId(nodeId);
      onSelect(nodeId);
    },
    [onSelect],
  ),
   handleHoverLeave = useCallback((nodeId: string) => {
    setHoveredNodeId((current) => (current === nodeId ? null : current));
  }, [setHoveredNodeId]);

  return { handleHoverLeave, handleNodeKeyboard, handleNodeSelect };
}

function useAtlasGraphSelection(
  nodes:readonly AtlasNode[],
  edges:readonly AtlasEdge[],
  selectedId: string | null,
  onSelect: (nodeId: string) => void,
  svgRef: AtlasElementRef<SVGSVGElement>,
): AtlasGraphSelectionState {
  const values = useAtlasGraphSelectionValues(nodes, edges, selectedId),
   handlers = useAtlasGraphSelectionHandlers(
    values.orderedNodes,
    onSelect,
    svgRef,
    values.setKeyboardActiveNodeId,
    values.setHoveredNodeId,
  );
  return {
    ...values,
    ...handlers,
  };
}

function getFittedAtlasTransform(
  positions: Record<string, AtlasPosition>,
  dimensions: AtlasGraphDimensions,
): Transform {
  const values = Object.values(positions);
  if (values.length === 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const xs = values.map((position) => position.x),
   ys = values.map((position) => position.y),
   minX = Math.min(...xs),
   maxX = Math.max(...xs),
   minY = Math.min(...ys),
   maxY = Math.max(...ys),
   padding = 90,
   width = Math.max(1, maxX - minX),
   height = Math.max(1, maxY - minY),
   scale = Math.min(
    1.45,
    Math.max(0.35, Math.min((dimensions.width - padding * 2) / width, (dimensions.height - padding * 2) / height)),
  );
  return {
    scale,
    x: dimensions.width / 2 - ((minX + maxX) / 2) * scale,
    y: dimensions.height / 2 - ((minY + maxY) / 2) * scale,
  };
}

type TransformUpdate = Transform | ((current: Transform) => Transform);
type SetAtlasTransform = (update: TransformUpdate) => void;

function getZoomedAtlasTransform(
  current: Transform,
  pointerX: number,
  pointerY: number,
  factor: number,
): Transform {
  const nextScale = Math.min(3.5, Math.max(0.3, current.scale * factor)),
   worldX = (pointerX - current.x) / current.scale,
   worldY = (pointerY - current.y) / current.scale;
  return {
    scale: nextScale,
    x: pointerX - worldX * nextScale,
    y: pointerY - worldY * nextScale,
  };
}

interface AtlasGraphZoomState {
  fitGraph: () => void;
  handleWheel: (event: WheelEvent<SVGSVGElement>) => void;
  setTransform: SetAtlasTransform;
  transform: Transform;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
}

interface AtlasGraphZoomModel {
  fitGraph: () => void;
  setTransform: SetAtlasTransform;
  transform: Transform;
}

function useAtlasGraphZoomModel(
  layoutKey: string,
  fittedTransform: Transform,
): AtlasGraphZoomModel {
  const [manualTransform, setManualTransform] = useState<{ key: string; value: Transform } | null>(null),
   transform = manualTransform?.key === layoutKey ? manualTransform.value : fittedTransform,
   setTransform: SetAtlasTransform = useCallback(
    (update) => {
      const current = manualTransform?.key === layoutKey ? manualTransform.value : fittedTransform,
       value = typeof update === "function" ? update(current) : update;
      setManualTransform({ key: layoutKey, value });
    },
    [fittedTransform, layoutKey, manualTransform, setManualTransform],
  ),
   fitGraph = useCallback(() => {
    setManualTransform({ key: layoutKey, value: fittedTransform });
  }, [fittedTransform, layoutKey, setManualTransform]);

  return { fitGraph, setTransform, transform };
}

interface AtlasGraphZoomActions {
  handleWheel: (event: WheelEvent<SVGSVGElement>) => void;
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

function useAtlasGraphZoomActions(
  svgRef: AtlasElementRef<SVGSVGElement>,
  setTransform: SetAtlasTransform,
): AtlasGraphZoomActions {
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    setTransform((current) => getZoomedAtlasTransform(
      current,
      clientX - bounds.left,
      clientY - bounds.top,
      factor,
    ));
  }, [setTransform, svgRef]),
   zoomAtCenter = useCallback((factor: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (bounds) {
      zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, factor);
    }
  }, [svgRef, zoomAt]),
   zoomIn = useCallback(() =>{  zoomAtCenter(1.18); }, [zoomAtCenter]),
   zoomOut = useCallback(() =>{  zoomAtCenter(1 / 1.18); }, [zoomAtCenter]),
   handleWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, [zoomAt]);

  return { handleWheel, zoomAt, zoomIn, zoomOut };
}

function useAtlasGraphZoom(
  svgRef: AtlasElementRef<SVGSVGElement>,
  layoutKey: string,
  fittedTransform: Transform,
): AtlasGraphZoomState {
  const model = useAtlasGraphZoomModel(layoutKey, fittedTransform),
   actions = useAtlasGraphZoomActions(svgRef, model.setTransform);
  return { ...model, ...actions };
}

interface AtlasGraphPanState {
  handlePointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  handlePointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  handlePointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  panning: boolean;
}

function useAtlasGraphPan(
  transform: Transform,
  setTransform: SetAtlasTransform,
): AtlasGraphPanState {
  const [panning, setPanning] = useState(false),
   panRef = useRef<PanState | null>(null),
   handlePointerDown = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("[data-node-id]")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      originX: transform.x,
      originY: transform.y,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setPanning(true);
  }, [setPanning, transform.x, transform.y]),
   handlePointerMove = useCallback((event: PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    setTransform((current) => ({
      ...current,
      x: pan.originX + event.clientX - pan.x,
      y: pan.originY + event.clientY - pan.y,
    }));
  }, [setTransform]),
   handlePointerUp = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) {
      return;
    }
    panRef.current = null;
    setPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [setPanning]);

  return { handlePointerDown, handlePointerMove, handlePointerUp, panning };
}

export function AtlasGraph({
  nodes,
  edges,
  graphVersion,
  layout,
  selectedId,
  focus,
  loading,
  onSelect,
}: AtlasGraphProps) {
  if (nodes.length === 0 && !loading) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>No entities match this view.</div>
          <p className={styles.contextCopy}>Clear a filter or search for a different outlet, organization, or reporter.</p>
        </div>
      </div>
    );
  }

  return (
    <AtlasGraphCanvas
      nodes={nodes}
      edges={edges}
      graphVersion={graphVersion}
      layout={layout}
      selectedId={selectedId}
      focus={focus}
      onSelect={onSelect}
    />
  );
}

function AtlasGraphCanvas({
  nodes,
  edges,
  graphVersion,
  layout,
  selectedId,
  focus,
  onSelect,
}: Omit<AtlasGraphProps, "loading">): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null),
   svgRef = useRef<SVGSVGElement>(null),
   dimensions = useAtlasGraphDimensions(containerRef),
   { key: layoutKey, positions, stable } = useAtlasGraphLayout({
    dimensions,
    edges,
    graphVersion,
    layout,
    nodes,
    selectedId,
  }),
   selection = useAtlasGraphSelection(nodes, edges, selectedId, onSelect, svgRef),
   fittedTransform = useMemo(
    () => getFittedAtlasTransform(positions, dimensions),
    [dimensions.height, dimensions.width, positions],
  ),
   zoom = useAtlasGraphZoom(svgRef, layoutKey, fittedTransform),
   pan = useAtlasGraphPan(zoom.transform, zoom.setTransform);

  return (
    <AtlasGraphFrame
      containerRef={containerRef}
      edges={edges}
      focus={focus}
      nodes={nodes}
      onSelect={onSelect}
      pan={pan}
      positions={positions}
      selectedId={selectedId}
      selection={selection}
      stable={stable}
      svgRef={svgRef}
      zoom={zoom}
    />
  );
}

interface AtlasGraphFrameProps {
  containerRef: AtlasElementRef<HTMLDivElement>;
  edges: AtlasEdge[];
  focus: boolean;
  nodes: AtlasNode[];
  onSelect: (nodeId: string) => void;
  pan: AtlasGraphPanState;
  positions: Record<string, AtlasPosition>;
  selectedId: string | null;
  selection: AtlasGraphSelectionState;
  stable: boolean;
  svgRef: AtlasElementRef<SVGSVGElement>;
  zoom: AtlasGraphZoomState;
}

function AtlasGraphFrame({
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
}: AtlasGraphFrameProps): ReactNode {
  return (
    <div ref={containerRef} className="relative h-full w-full">
      <AtlasGraphSvg
        activeNodeId={selection.activeNodeId}
        edges={edges}
        focus={focus}
        hoveredNodeId={selection.hoveredNodeId}
        interactionNeighbors={selection.interactionNeighbors}
        interactionNodeId={selection.interactionNodeId}
        nodes={nodes}
        onHover={selection.onHover}
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
      <AtlasGraphControls onFit={zoom.fitGraph} onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} />
      <AtlasGraphLegend />
      <AtlasGraphHoverCard node={selection.hoveredNode} />
      <AtlasGraphStatus stable={stable} />
      <AtlasAccessibleList nodes={nodes} edges={edges} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

interface AtlasGraphSvgProps {
  activeNodeId: string | null;
  edges: AtlasEdge[];
  focus: boolean;
  hoveredNodeId: string | null;
  interactionNeighbors: Set<string>;
  interactionNodeId: string | null;
  nodes: AtlasNode[];
  onHover: (nodeId: string) => void;
  onHoverLeave: (nodeId: string) => void;
  onNodeKeyboard: (event: KeyboardEvent<SVGGElement>, nodeId: string) => void;
  onNodeSelect: (nodeId: string) => void;
  onPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  onWheel: (event: WheelEvent<SVGSVGElement>) => void;
  panning: boolean;
  positions: Record<string, AtlasPosition>;
  priorityLabelIds: Set<string>;
  selectedId: string | null;
  selectedNeighbors: Set<string>;
  svgRef: AtlasElementRef<SVGSVGElement>;
  transform: Transform;
}

function AtlasGraphMarkers(): ReactNode {
  return (
    <defs>
      <marker id="atlas-arrow-gold" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" fill="#d7b35f" />
      </marker>
      <marker id="atlas-arrow-neutral" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" fill="#b8b2a7" />
      </marker>
    </defs>
  );
}

function AtlasGraphLayers({
  activeNodeId,
  edges,
  focus,
  hoveredNodeId,
  interactionNeighbors,
  interactionNodeId,
  nodes,
  onHover,
  onHoverLeave,
  onNodeKeyboard,
  onNodeSelect,
  positions,
  priorityLabelIds,
  selectedId,
  selectedNeighbors,
  transform,
}: Omit<AtlasGraphSvgProps, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onWheel" | "panning" | "svgRef">): ReactNode {
  return (
    <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
      {edges.map((edge) => (
        <AtlasEdgeLine
          key={edge.id}
          edge={edge}
          focus={focus}
          interactionNodeId={interactionNodeId}
          selectedId={selectedId}
          selectedNeighbors={selectedNeighbors}
          source={positions[edge.source_id]}
          target={positions[edge.target_id]}
        />
      ))}
      <AtlasNodeLayer
        activeNodeId={activeNodeId}
        focus={focus}
        interactionNeighbors={interactionNeighbors}
        interactionNodeId={interactionNodeId}
        nodes={nodes}
        onHover={onHover}
        onHoverLeave={onHoverLeave}
        onNodeKeyboard={onNodeKeyboard}
        onSelect={onNodeSelect}
        positions={positions}
        priorityLabelIds={priorityLabelIds}
        selectedId={selectedId}
        selectedNeighbors={selectedNeighbors}
        transformScale={transform.scale}
        hoveredNodeId={hoveredNodeId}
      />
    </g>
  );
}

function AtlasGraphSvg({
  activeNodeId,
  edges,
  focus,
  hoveredNodeId,
  interactionNeighbors,
  interactionNodeId,
  nodes,
  onHover,
  onHoverLeave,
  onNodeKeyboard,
  onNodeSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  panning,
  positions,
  priorityLabelIds,
  selectedId,
  selectedNeighbors,
  svgRef,
  transform,
}: AtlasGraphSvgProps): ReactNode {
  return (
    <svg
      ref={svgRef}
      className={styles.graphCanvas}
      data-panning={panning}
      role="group"
      aria-label={`Intelligence Atlas graph with ${nodes.length} entities and ${edges.length} relationships`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <AtlasGraphMarkers />
      <AtlasGraphLayers
        activeNodeId={activeNodeId}
        edges={edges}
        focus={focus}
        hoveredNodeId={hoveredNodeId}
        interactionNeighbors={interactionNeighbors}
        interactionNodeId={interactionNodeId}
        nodes={nodes}
        onHover={onHover}
        onHoverLeave={onHoverLeave}
        onNodeKeyboard={onNodeKeyboard}
        onNodeSelect={onNodeSelect}
        positions={positions}
        priorityLabelIds={priorityLabelIds}
        selectedId={selectedId}
        selectedNeighbors={selectedNeighbors}
        transform={transform}
      />
    </svg>
  );
}

interface AtlasGraphControlsProps {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function AtlasGraphControls({ onFit, onZoomIn, onZoomOut }: AtlasGraphControlsProps): ReactNode {
  return (
    <div className="absolute bottom-24 left-5 z-10 flex gap-2">
      <button type="button" className={styles.iconButton} aria-label="Zoom in" onClick={onZoomIn}>
        <Plus className="h-4 w-4" />
      </button>
      <button type="button" className={styles.iconButton} aria-label="Zoom out" onClick={onZoomOut}>
        <Minus className="h-4 w-4" />
      </button>
      <button type="button" className={styles.iconButton} aria-label="Fit visible graph" onClick={onFit}>
        <Scan className="h-4 w-4" />
      </button>
    </div>
  );
}

function AtlasGraphLegend(): ReactNode {
  return (
    <div className={styles.graphLegend} aria-hidden="true">
      <span><span className="text-[#f0ede4]">■</span> outlet</span>
      <span><span className="text-[#d7b35f]">●</span> organization</span>
      <span><span className="text-[#e08a5f]">◆</span> person</span>
      <span><span className="text-[#88a9ff]">◆</span> reporter</span>
      <span>Zoom for all labels</span>
    </div>
  );
}

function AtlasGraphHoverCard({ node }: { node: AtlasNode | null }): ReactNode {
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
        {node.bias_rating ? <span>{node.bias_rating}</span> : null}
        {node.funding_type ? <span>{node.funding_type}</span> : null}
      </div>
    </div>
  );
}

function AtlasGraphStatus({ stable }: { stable: boolean }): ReactNode {
  return (
    <div className={styles.graphStatus} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${stable ? "bg-emerald-300" : "animate-pulse bg-amber-300"}`} />
      {stable ? "Layout stable" : "Calculating layout"}
    </div>
  );
}
