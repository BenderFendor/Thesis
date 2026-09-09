"use client";
import { hasText } from "@/lib/utils";

import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import { Minus, Plus, Scan } from "lucide-react";
import type { ReactNode, RefCallback } from "react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtlasAccessibleList } from "./atlas-accessible-list";
import type { AtlasLayoutMode } from "./lib/atlas-query-state";
import type { AtlasPosition } from "./lib/atlas-force-layout";
import styles from "./atlas.module.css";
import { useAtlasLayout } from "./hooks/use-atlas-layout";

interface AtlasKeyboardEvent {
  readonly key: string;
  readonly preventDefault: () => void;
}

interface AtlasPointerEvent {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: Readonly<
    Pick<SVGSVGElement, "releasePointerCapture" | "setPointerCapture">
  >;
  readonly pointerId: number;
  readonly target: Readonly<EventTarget> | null;
}

interface AtlasWheelEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY: number;
  readonly preventDefault: () => void;
}

interface AtlasClickEvent {
  readonly stopPropagation: () => void;
}

interface AtlasGraphProps {
  nodes: readonly AtlasNode[];
  edges: readonly AtlasEdge[];
  graphVersion: string;
  layout: AtlasLayoutMode;
  selectedId: string | null;
  focus: boolean;
  loading: boolean;
  onSelect: (nodeId: string) => void;
}

interface Transform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const EDGE_STROKE = {
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
} satisfies Record<AtlasEdge["relation_type"], string>;

const ENTITY_FILL = {
  organization: "#d7b35f",
  outlet: "#f0ede4",
  person: "#e08a5f",
  reporter: "#88a9ff",
} satisfies Record<AtlasNode["entity_type"], string>;

const NODE_BASE_RADIUS = {
  organization: 12,
  outlet: 9,
  person: 8,
  reporter: 8,
} satisfies Record<AtlasNode["entity_type"], number>;

const nodeRadius = (node: AtlasNode): number => {
  const articles = Math.min(Math.log10(1 + node.article_count) * 0.8, 3),
    base = NODE_BASE_RADIUS[node.entity_type],
    degree = Math.min(Math.log2(1 + node.connection_count) * 1.4, 8);
  return base + degree + articles;
};

const renderAtlasNodeGeometry = (node: AtlasNode, radius: number) => {
  if (node.entity_type === "outlet") {
    return (
      <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.35} />
    );
  }
  if (node.entity_type === "reporter") {
    return (
      <path
        d={`M 0 ${-radius} C ${radius} ${-radius} ${radius} ${radius * 0.55} 0 ${radius} C ${-radius} ${radius * 0.55} ${-radius} ${-radius} 0 ${-radius} Z`}
      />
    );
  }
  if (node.entity_type === "person") {
    return <path d={`M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`} />;
  }
  return <circle r={radius} />;
};

const handleAtlasNodeKeyboard = (
  event: AtlasKeyboardEvent,
  nodeId: string,
  orderedNodes: readonly AtlasNode[],
  onSelect: (nodeId: string) => void,
): string | null => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(nodeId);
    return null;
  }
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
    return null;
  }
  event.preventDefault();
  const currentIndex = orderedNodes.findIndex((node) => node.id === nodeId),
    direction = (() => {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    return 1;
  }
  return -1;
})(),
    nextIndex = (currentIndex + direction + orderedNodes.length) % orderedNodes.length,
    nextNode = orderedNodes[nextIndex];
  if (!nextNode) {
    return null;
  }
  return nextNode.id;
};

interface AtlasNodeMarkProps {
  active: boolean;
  dimmed: boolean;
  node: AtlasNode;
  onClick: (event: AtlasClickEvent) => void;
  onKeyDown: (event: AtlasKeyboardEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  position: AtlasPosition;
  priorityLabel: boolean;
  selected: boolean;
  showLabel: boolean;
}

const NeedsReviewMarker = ({ radius, visible }: Readonly<{ radius: number; visible: boolean }>) => {
  if (!visible) {
    return null;
  }
  return (
    <circle
      cx={radius * 0.7}
      cy={-radius * 0.7}
      r={3.2}
      fill="#f1635e"
      stroke="#080907"
      strokeWidth={1.5}
    />
  );
};

const AtlasNodeLabel = ({
  node,
  priority,
  radius,
  show,
}: Readonly<{
  node: AtlasNode;
  priority: boolean;
  radius: number;
  show: boolean;
}>) => {
  if (!show) {
    return null;
  }
  return (
    <>
      <text
        className={`${styles.nodeLabel} ${(() => {
  if (priority) {
    return styles.nodeLabelPriority;
  }
  return "";
})()}`}
        x={radius + 7}
        y={(() => {
  if (priority) {
    return 0;
  }
  return 1;
})()}
        fill="#f0ede4"
      >
        {(() => {
  if (node.label.length > 34) {
    return `${node.label.slice(0, 31)}…`;
  }
  return node.label;
})()}
      </text>
      {priority && <text className={styles.nodeMeta} x={radius + 7} y={14}>
          {node.entity_type} · {node.connection_count} links
        </text>}
    </>
  );
};

const AtlasNodeMark = ({
  active,
  dimmed,
  node,
  onClick,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  position,
  priorityLabel,
  selected,
  showLabel,
}: Readonly<AtlasNodeMarkProps>) => {
  const confidence = node.confidence_tier ?? "unresolved",
    radius = nodeRadius(node);
  return (
    <g
      data-node-id={node.id}
      className={styles.nodeButton}
      transform={`translate(${position.x} ${position.y})`}
      opacity={(() => {
  if (dimmed) {
    return 0.14;
  }
  return 1;
})()}
    >
      <title>{`${node.label} — ${node.entity_type}, ${node.connection_count} connections, ${node.article_count} articles`}</title>
      <AtlasNodeGlyph
        node={node}
        priorityLabel={priorityLabel}
        radius={radius}
        selected={selected}
        showLabel={showLabel}
      />
      <foreignObject
        x={-radius - 8}
        y={-radius - 8}
        width={(radius + 8) * 2}
        height={(radius + 8) * 2}
      >
        <button
          type="button"
          className={styles.nodeHitArea}
          tabIndex={(() => {
  if (active) {
    return 0;
  }
  return -1;
})()}
          aria-label={`${node.label}, ${node.entity_type}, ${node.connection_count} connections, ${confidence} confidence`}
          aria-pressed={selected}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />
      </foreignObject>
    </g>
  );
};

const AtlasNodeGlyph = ({
  node,
  priorityLabel,
  radius,
  selected,
  showLabel,
}: Readonly<{
  node: AtlasNode;
  priorityLabel: boolean;
  radius: number;
  selected: boolean;
  showLabel: boolean;
}>): ReactNode => (
  <>
    <circle
      className={styles.nodeHalo}
      r={radius + ((() => {
  if (selected) {
    return 8;
  }
  return 5;
})())}
      fill="transparent"
      stroke={(() => {
  if (selected) {
    return "#d7b35f";
  }
  return ENTITY_FILL[node.entity_type];
})()}
      strokeOpacity={(() => {
  if (selected) {
    return 0.9;
  }
  return 0;
})()}
      strokeWidth={(() => {
  if (selected) {
    return 2;
  }
  return 1;
})()}
    />
    <g
      fill={ENTITY_FILL[node.entity_type]}
      fillOpacity={(() => {
  if (selected) {
    return 1;
  }
  return 0.82;
})()}
      stroke="#080907"
      strokeWidth={2}
    >
      {renderAtlasNodeGeometry(node, radius)}
    </g>
    <NeedsReviewMarker radius={radius} visible={node.flags.includes("needs-review")} />
    <AtlasNodeLabel node={node} priority={priorityLabel} radius={radius} show={showLabel} />
  </>
);

interface AtlasEdgeLineProps {
  edge: AtlasEdge;
  focus: boolean;
  interactionNodeId: string | null;
  selectedId: string | null;
  selectedNeighbors: ReadonlySet<string>;
  source: AtlasPosition | undefined;
  target: AtlasPosition | undefined;
}

interface AtlasEdgeVisuals {
  dashed: string | undefined;
  marker: string | undefined;
  opacity: number;
  width: number;
}

const atlasEdgeTouchesInteraction = (edge: AtlasEdge, interactionNodeId: string | null): boolean =>
  hasText(interactionNodeId) &&
  (edge.source_id === interactionNodeId || edge.target_id === interactionNodeId);

const atlasEdgeIsDimmed = (
  edge: AtlasEdge,
  focus: boolean,
  interactionNodeId: string | null,
  selectedId: string | null,
  selectedNeighbors: ReadonlySet<string>,
): boolean => {
  const focusDimmed =
    focus &&
    hasText(selectedId) &&
    !selectedNeighbors.has(edge.source_id) &&
    !selectedNeighbors.has(edge.target_id);
  return (
    focusDimmed ||
    (hasText(interactionNodeId) && !atlasEdgeTouchesInteraction(edge, interactionNodeId))
  );
};

const atlasEdgeIsDashed = (edge: AtlasEdge): boolean =>
  edge.is_inferred || edge.confidence_tier === "likely" || edge.confidence_tier === "unresolved";

const atlasEdgeMarker = (edge: AtlasEdge): string | undefined => {
  if (edge.direction !== "directed") {
    return void 0;
  }
  const marker = (() => {
  if (edge.relation_type === "ownership") {
    return "atlas-arrow-gold";
  }
  return "atlas-arrow-neutral";
})();
  return `url(#${marker})`;
};

const getAtlasEdgeVisuals = (
  edge: AtlasEdge,
  focus: boolean,
  interactionNodeId: string | null,
  selectedId: string | null,
  selectedNeighbors: ReadonlySet<string>,
): AtlasEdgeVisuals => {
  const touchesInteraction = atlasEdgeTouchesInteraction(edge, interactionNodeId);
  const dimmed = atlasEdgeIsDimmed(edge, focus, interactionNodeId, selectedId, selectedNeighbors);
  const dashed = atlasEdgeIsDashed(edge);
  const baseOpacity = Math.min(0.2, 0.06 + Math.log2(edge.weight + 1) * 0.025);
  return {
    dashed: (() => {
  if (dashed) {
    return "5 5";
  }
  return void 0;
})(),
    marker: atlasEdgeMarker(edge),
    opacity: (() => {
  if (dimmed) {
    return 0.025;
  }
  return (() => {
    if (touchesInteraction) {
      return 0.78;
    }
    return baseOpacity;
  })();
})(),
    width: (() => {
  if (touchesInteraction) {
    return 1.8;
  }
  return Math.min(1.25, 0.55 + Math.log2(edge.weight + 1) * 0.14);
})(),
  };
};

const AtlasEdgeLine = ({
  edge,
  focus,
  interactionNodeId,
  selectedId,
  selectedNeighbors,
  source,
  target,
}: Readonly<AtlasEdgeLineProps>) => {
  if (!source || !target) {
    return null;
  }
  const visuals = getAtlasEdgeVisuals(
    edge,
    focus,
    interactionNodeId,
    selectedId,
    selectedNeighbors,
  );
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
};

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
    outsideInteraction = hasText(context.interactionNodeId) && !context.interactionNeighbors.has(nodeId);
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
  return {
    active: context.activeNodeId === node.id,
    dimmed,
    node,
    onClick: (event) => {
      event.stopPropagation();
      context.onSelect(node.id);
    },
    onKeyDown: (event) => {
      context.onNodeKeyboard(event, node.id);
    },
    onMouseEnter: () => {
      context.onHover(node.id);
    },
    onMouseLeave: () => {
      context.onHoverLeave(node.id);
    },
    position,
    priorityLabel: isAtlasNodePriority(node.id, selected, interacting, context),
    selected,
    showLabel,
  };
};

const renderAtlasNode = (node: AtlasNode, context: AtlasNodeLayerContext): ReactNode => {
  const props = getAtlasNodeMarkProps(node, context);
  if (props) {
  return <AtlasNodeMark key={node.id} {...props} />;
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

interface AtlasGraphDimensions {
  readonly height: number;
  readonly width: number;
}

interface PanState {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly originX: number;
  readonly originY: number;
}

const getAtlasGraphDimensions = (rect: DOMRectReadOnly): AtlasGraphDimensions => ({
  height: Math.max(360, Math.round(rect.height)),
  width: Math.max(320, Math.round(rect.width)),
});

const useAtlasGraphDimensions = (
  getContainer: () => HTMLDivElement | null,
): AtlasGraphDimensions => {
  const [dimensions, setDimensions] = useState<AtlasGraphDimensions>({ height: 760, width: 1280 });

  useEffect(() => {
    const container = getContainer();
    if (!container) {
      return () => {};
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setDimensions(getAtlasGraphDimensions(entry.contentRect));
      }
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [getContainer]);

  return dimensions;
};

interface AtlasGraphLayoutInput {
  dimensions: AtlasGraphDimensions;
  edges: readonly AtlasEdge[];
  graphVersion: string;
  layout: AtlasLayoutMode;
  nodes: readonly AtlasNode[];
  selectedId: string | null;
}

const useAtlasGraphLayout = ({
  dimensions,
  edges,
  graphVersion,
  layout,
  nodes,
  selectedId,
}: Readonly<AtlasGraphLayoutInput>) => {
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
};

const getAtlasNeighbors = (edges: readonly AtlasEdge[], nodeId: string | null): Set<string> => {
  const ids = new Set<string>();
  if (!hasText(nodeId)) {
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
};

const getAtlasActiveNodeId = (
  selectedId: string | null,
  keyboardActiveNodeId: string | null,
  nodes: readonly AtlasNode[],
  orderedNodes: readonly AtlasNode[],
): string | null => {
  if (selectedId !== null) {
    return selectedId;
  }
  if (hasText(keyboardActiveNodeId) && nodes.some((node) => node.id === keyboardActiveNodeId)) {
    return keyboardActiveNodeId;
  }
  return orderedNodes[0]?.id ?? null;
};

interface AtlasGraphSelectionState {
  readonly activeNodeId: string | null;
  readonly handleHoverLeave: (nodeId: string) => void;
  readonly handleNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  readonly handleNodeSelect: (nodeId: string) => void;
  readonly hoveredNode: AtlasNode | null;
  readonly hoveredNodeId: string | null;
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly onHover: (nodeId: string) => void;
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedNeighbors: ReadonlySet<string>;
}

type AtlasNodeIdStateSetter = (
  value: string | null | ((current: string | null) => string | null),
) => void;

interface AtlasGraphSelectionValues {
  readonly activeNodeId: string | null;
  readonly hoveredNode: AtlasNode | null;
  readonly hoveredNodeId: string | null;
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly onHover: (nodeId: string) => void;
  readonly orderedNodes: readonly AtlasNode[];
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedNeighbors: ReadonlySet<string>;
  readonly setHoveredNodeId: AtlasNodeIdStateSetter;
  readonly setKeyboardActiveNodeId: (nodeId: string) => void;
}

const useAtlasGraphSelectionValues = (
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
  selectedId: string | null,
): AtlasGraphSelectionValues => {
  const [keyboardActiveNodeId, setKeyboardActiveNodeId] = useState<string | null>(selectedId);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const selectedNeighbors = useMemo(() => getAtlasNeighbors(edges, selectedId), [edges, selectedId]);
  const interactionNodeId = hoveredNodeId ?? selectedId;
  const interactionNeighbors = useMemo(
      () => getAtlasNeighbors(edges, interactionNodeId),
      [edges, interactionNodeId],
    );
  const orderedNodes = useMemo(
      () =>
        nodes.toSorted(
          (left, right) =>
            right.connection_count - left.connection_count || left.label.localeCompare(right.label),
        ),
      [nodes],
    );
  const priorityLabelIds = useMemo(
      () => new Set(orderedNodes.slice(0, 28).map((node) => node.id)),
      [orderedNodes],
    );
  return {
    activeNodeId: getAtlasActiveNodeId(selectedId, keyboardActiveNodeId, nodes, orderedNodes),
    hoveredNode: nodes.find((node) => node.id === hoveredNodeId) ?? null,
    hoveredNodeId,
    interactionNeighbors,
    interactionNodeId,
    onHover: setHoveredNodeId,
    orderedNodes,
    priorityLabelIds,
    selectedNeighbors,
    setHoveredNodeId,
    setKeyboardActiveNodeId,
  };
};

interface AtlasGraphSelectionHandlers {
  readonly handleHoverLeave: (nodeId: string) => void;
  readonly handleNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  readonly handleNodeSelect: (nodeId: string) => void;
}

const useAtlasGraphSelectionHandlers = (
  orderedNodes: readonly AtlasNode[],
  onSelect: (nodeId: string) => void,
  focusAtlasNode: (nodeId: string) => void,
  setKeyboardActiveNodeId: (nodeId: string) => void,
  setHoveredNodeId: AtlasNodeIdStateSetter,
): AtlasGraphSelectionHandlers => {
  const handleHoverLeave = useCallback(
      (nodeId: string) => {
        setHoveredNodeId((current) => ((() => {
  if (current === nodeId) {
    return null;
  }
  return current;
})()));
      },
      [setHoveredNodeId],
    ),
    handleNodeKeyboard = useCallback(
      (event: AtlasKeyboardEvent, nodeId: string) => {
        const nextNodeId = handleAtlasNodeKeyboard(event, nodeId, orderedNodes, onSelect);
        if (nextNodeId === null) {
          return;
        }
        setKeyboardActiveNodeId(nextNodeId);
        requestAnimationFrame(() => {
          focusAtlasNode(nextNodeId);
        });
      },
      [focusAtlasNode, onSelect, orderedNodes, setKeyboardActiveNodeId],
    ),
    handleNodeSelect = useCallback(
      (nodeId: string) => {
        setKeyboardActiveNodeId(nodeId);
        onSelect(nodeId);
      },
      [onSelect, setKeyboardActiveNodeId],
    );

  return { handleHoverLeave, handleNodeKeyboard, handleNodeSelect };
};

const useAtlasGraphSelection = (
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
  selectedId: string | null,
  onSelect: (nodeId: string) => void,
  focusAtlasNode: (nodeId: string) => void,
): AtlasGraphSelectionState => {
  const values = useAtlasGraphSelectionValues(nodes, edges, selectedId);
  const handlers = useAtlasGraphSelectionHandlers(
      values.orderedNodes,
      onSelect,
      focusAtlasNode,
      values.setKeyboardActiveNodeId,
      values.setHoveredNodeId,
    );
  return {
    activeNodeId: values.activeNodeId,
    handleHoverLeave: handlers.handleHoverLeave,
    handleNodeKeyboard: handlers.handleNodeKeyboard,
    handleNodeSelect: handlers.handleNodeSelect,
    hoveredNode: values.hoveredNode,
    hoveredNodeId: values.hoveredNodeId,
    interactionNeighbors: values.interactionNeighbors,
    interactionNodeId: values.interactionNodeId,
    onHover: values.onHover,
    priorityLabelIds: values.priorityLabelIds,
    selectedNeighbors: values.selectedNeighbors,
  };
};

const getFittedAtlasTransform = (
  positions: Readonly<Record<string, AtlasPosition>>,
  dimensions: Readonly<AtlasGraphDimensions>,
): Transform => {
  const values = Object.values(positions);
  if (values.length === 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const xs = values.map((position) => position.x);
  const ys = values.map((position) => position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 90;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(
      1.45,
      Math.max(
        0.35,
        Math.min(
          (dimensions.width - padding * 2) / width,
          (dimensions.height - padding * 2) / height,
        ),
      ),
    );
  return {
    scale,
    x: dimensions.width / 2 - ((minX + maxX) / 2) * scale,
    y: dimensions.height / 2 - ((minY + maxY) / 2) * scale,
  };
};

type SetAtlasTransform = (update: (current: Readonly<Transform>) => Transform) => void;

const getZoomedAtlasTransform = (
  current: Readonly<Transform>,
  pointerX: number,
  pointerY: number,
  factor: number,
): Transform => {
  const nextScale = Math.min(3.5, Math.max(0.3, current.scale * factor)),
    worldX = (pointerX - current.x) / current.scale,
    worldY = (pointerY - current.y) / current.scale;
  return {
    scale: nextScale,
    x: pointerX - worldX * nextScale,
    y: pointerY - worldY * nextScale,
  };
};

interface AtlasGraphZoomState {
  readonly fitGraph: () => void;
  readonly handleWheel: (event: AtlasWheelEvent) => void;
  readonly setTransform: SetAtlasTransform;
  readonly transform: Transform;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly zoomAt: (clientX: number, clientY: number, factor: number) => void;
}

interface AtlasGraphZoomModel {
  readonly fitGraph: () => void;
  readonly setTransform: SetAtlasTransform;
  readonly transform: Transform;
}

const useAtlasGraphZoomModel = (
  layoutKey: string,
  fittedTransform: Readonly<Transform>,
): AtlasGraphZoomModel => {
  const [manualTransform, setManualTransform] = useState<{ key: string; value: Transform } | null>(
      null,
    );
  const transform = (() => {
  if (manualTransform?.key === layoutKey) {
    return manualTransform.value;
  }
  return fittedTransform;
})();
  const setTransform: SetAtlasTransform = useCallback(
      (update) => {
        const current =
            (() => {
  if (manualTransform?.key === layoutKey) {
    return manualTransform.value;
  }
  return fittedTransform;
})(),
          value = update(current);
        setManualTransform({ key: layoutKey, value });
      },
      [fittedTransform, layoutKey, manualTransform, setManualTransform],
    );
  const fitGraph = useCallback(() => {
      setManualTransform({ key: layoutKey, value: fittedTransform });
    }, [fittedTransform, layoutKey, setManualTransform]);

  return { fitGraph, setTransform, transform };
};

interface AtlasGraphZoomActions {
  readonly handleWheel: (event: AtlasWheelEvent) => void;
  readonly zoomAt: (clientX: number, clientY: number, factor: number) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

const useAtlasGraphZoomActions = (
  getSvgBounds: () => DOMRect | undefined,
  setTransform: SetAtlasTransform,
): AtlasGraphZoomActions => {
  const zoomAt = useCallback(
      (clientX: number, clientY: number, factor: number) => {
        const bounds = getSvgBounds();
        if (!bounds) {
          return;
        }
        setTransform((current) =>
          getZoomedAtlasTransform(current, clientX - bounds.left, clientY - bounds.top, factor),
        );
      },
      [getSvgBounds, setTransform],
    );
  const zoomAtCenter = useCallback(
      (factor: number) => {
        const bounds = getSvgBounds();
        if (bounds) {
          zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, factor);
        }
      },
      [getSvgBounds, zoomAt],
    );
  const zoomIn = useCallback(() => {
      zoomAtCenter(1.18);
    }, [zoomAtCenter]);
  const zoomOut = useCallback(() => {
      zoomAtCenter(1 / 1.18);
    }, [zoomAtCenter]);
  const handleWheel = useCallback(
      (event: AtlasWheelEvent) => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, (() => {
  if (event.deltaY < 0) {
    return 1.12;
  }
  return 1 / 1.12;
})());
      },
      [zoomAt],
    );

  return { handleWheel, zoomAt, zoomIn, zoomOut };
};

const useAtlasGraphZoom = (
  getSvgBounds: () => DOMRect | undefined,
  layoutKey: string,
  fittedTransform: Readonly<Transform>,
): AtlasGraphZoomState => {
  const model = useAtlasGraphZoomModel(layoutKey, fittedTransform);
  const actions = useAtlasGraphZoomActions(getSvgBounds, model.setTransform);
  return { ...model, ...actions };
};

interface AtlasGraphPanState {
  readonly handlePointerDown: (event: AtlasPointerEvent) => void;
  readonly handlePointerMove: (event: AtlasPointerEvent) => void;
  readonly handlePointerUp: (event: AtlasPointerEvent) => void;
  readonly panning: boolean;
}

const useAtlasGraphPan = (
  transform: Readonly<Transform>,
  setTransform: SetAtlasTransform,
): AtlasGraphPanState => {
  const [pan, setPan] = useState<PanState | null>(null),
    handlePointerDown = useCallback(
      (event: AtlasPointerEvent) => {
        const target = event.target;
        if (
          event.button !== 0 ||
          (target instanceof Element && target.closest("[data-node-id]") !== null)
        ) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setPan({
          originX: transform.x,
          originY: transform.y,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        });
      },
      [setPan, transform.x, transform.y],
    ),
    handlePointerMove = useCallback(
      (event: AtlasPointerEvent) => {
        if (!pan || pan.pointerId !== event.pointerId) {
          return;
        }
        setTransform((current) => ({
          ...current,
          x: pan.originX + event.clientX - pan.x,
          y: pan.originY + event.clientY - pan.y,
        }));
      },
      [pan, setTransform],
    ),
    handlePointerUp = useCallback(
      (event: AtlasPointerEvent) => {
        if (pan?.pointerId !== event.pointerId) {
          return;
        }
        setPan(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
      },
      [pan, setPan],
    );

  return { handlePointerDown, handlePointerMove, handlePointerUp, panning: pan !== null };
};

const AtlasGraph = ({
  nodes,
  edges,
  graphVersion,
  layout,
  selectedId,
  focus,
  loading,
  onSelect,
}: Readonly<AtlasGraphProps>): ReactNode => {
  if (nodes.length === 0 && !loading) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>No entities match this view.</div>
          <p className={styles.contextCopy}>
            Clear a filter or search for a different outlet, organization, or reporter.
          </p>
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
};

const AtlasGraphCanvas = ({
  nodes,
  edges,
  graphVersion,
  layout,
  selectedId,
  focus,
  onSelect,
}: Readonly<Omit<AtlasGraphProps, "loading">>): ReactNode => {
  const containerElementRef = useRef<HTMLDivElement>(null);
  const svgElementRef = useRef<SVGSVGElement>(null);
  const setContainerRef: RefCallback<HTMLDivElement> = useCallback((element) => {
      containerElementRef.current = element;
    }, []);
  const setSvgRef: RefCallback<SVGSVGElement> = useCallback((element) => {
      svgElementRef.current = element;
    }, []);
  const getContainer = useCallback(() => containerElementRef.current, []);
  const focusAtlasNode = useCallback((nodeId: string) => {
      svgElementRef.current
        ?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
        ?.focus();
    }, []);
  const getSvgBounds = useCallback(() => svgElementRef.current?.getBoundingClientRect(), []);
  const dimensions = useAtlasGraphDimensions(getContainer);
  const { height, width } = dimensions;
  const {
      key: layoutKey,
      positions,
      stable,
    } = useAtlasGraphLayout({
      dimensions,
      edges,
      graphVersion,
      layout,
      nodes,
      selectedId,
    });
  const selection = useAtlasGraphSelection(nodes, edges, selectedId, onSelect, focusAtlasNode);
  const fittedTransform = useMemo(
      () => getFittedAtlasTransform(positions, { height, width }),
      [height, width, positions],
    );
  const zoom = useAtlasGraphZoom(getSvgBounds, layoutKey, fittedTransform);
  const pan = useAtlasGraphPan(zoom.transform, zoom.setTransform);

  return (
    <AtlasGraphFrame
      containerRef={setContainerRef}
      edges={edges}
      focus={focus}
      nodes={nodes}
      onSelect={onSelect}
      pan={pan}
      positions={positions}
      selectedId={selectedId}
      selection={selection}
      stable={stable}
      svgRef={setSvgRef}
      zoom={zoom}
    />
  );
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
}: Readonly<AtlasGraphFrameProps>): ReactNode => (
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

const AtlasGraphLayers = ({
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
}: Readonly<
  Omit<
    AtlasGraphSvgProps,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onWheel" | "panning" | "svgRef"
  >
>): ReactNode => (
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

const AtlasGraphSvg = ({
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
}: Readonly<AtlasGraphSvgProps>): ReactNode => (
  <svg
    ref={svgRef}
    className={styles.graphCanvas}
    data-panning={panning}
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

export { AtlasGraph };
