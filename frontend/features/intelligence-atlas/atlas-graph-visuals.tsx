"use client";

import { hasText } from "@/lib/utils";
import type { ReactNode } from "react";
import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import type { AtlasPosition } from "./lib/atlas-force-layout";
import type { AtlasClickEvent, AtlasKeyboardEvent } from "./atlas-graph-types";
import styles from "./atlas.module.css";

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
      {priority && (
        <text className={styles.nodeMeta} x={radius + 7} y={14}>
          {node.entity_type} · {node.connection_count} links
        </text>
      )}
    </>
  );
};

interface AtlasNodeInteractionAreaProps {
  readonly active: boolean;
  readonly onClick: (event: AtlasClickEvent) => void;
  readonly onKeyDown: (event: AtlasKeyboardEvent) => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly node: AtlasNode;
  readonly radius: number;
  readonly selected: boolean;
}

const getAtlasNodeOpacity = (dimmed: boolean): number => {
  if (dimmed) {
    return 0.14;
  }
  return 1;
};

const getAtlasNodeTabIndex = (active: boolean): number => {
  if (active) {
    return 0;
  }
  return -1;
};

const AtlasNodeInteractionArea = (props: Readonly<AtlasNodeInteractionAreaProps>) => {
  const confidence = props.node.confidence_tier ?? "unresolved";
  return (
    <foreignObject
      x={-props.radius - 8}
      y={-props.radius - 8}
      width={(props.radius + 8) * 2}
      height={(props.radius + 8) * 2}
    >
      <button
        type="button"
        className={styles.nodeHitArea}
        tabIndex={getAtlasNodeTabIndex(props.active)}
        aria-label={`${props.node.label}, ${props.node.entity_type}, ${props.node.connection_count} connections, ${confidence} confidence`}
        aria-pressed={props.selected}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
      />
    </foreignObject>
  );
};

const renderAtlasNodeMarkContent = (
  props: Readonly<AtlasNodeMarkProps>,
  radius: number,
): ReactNode => (
  <>
    <title>{`${props.node.label} — ${props.node.entity_type}, ${props.node.connection_count} connections, ${props.node.article_count} articles`}</title>
    <AtlasNodeGlyph
      node={props.node}
      priorityLabel={props.priorityLabel}
      radius={radius}
      selected={props.selected}
      showLabel={props.showLabel}
    />
    <AtlasNodeInteractionArea
      active={props.active}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      node={props.node}
      radius={radius}
      selected={props.selected}
    />
  </>
);

const AtlasNodeMark = (props: Readonly<AtlasNodeMarkProps>) => {
  const radius = nodeRadius(props.node);
  return (
    <g
      data-node-id={props.node.id}
      className={styles.nodeButton}
      transform={`translate(${props.position.x} ${props.position.y})`}
      opacity={getAtlasNodeOpacity(props.dimmed)}
    >
      {renderAtlasNodeMarkContent(props, radius)}
    </g>
  );
};

interface AtlasNodeHaloProps {
  readonly node: AtlasNode;
  readonly radius: number;
  readonly selected: boolean;
}

interface AtlasNodeHaloVisuals {
  readonly radius: number;
  readonly stroke: string;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
}

const getAtlasNodeHaloVisuals = ({
  node,
  radius,
  selected,
}: AtlasNodeHaloProps): AtlasNodeHaloVisuals => {
  if (selected) {
    return { radius: radius + 8, stroke: "#d7b35f", strokeOpacity: 0.9, strokeWidth: 2 };
  }
  return {
    radius: radius + 5,
    stroke: ENTITY_FILL[node.entity_type],
    strokeOpacity: 0,
    strokeWidth: 1,
  };
};

const AtlasNodeHalo = (props: Readonly<AtlasNodeHaloProps>) => {
  const visuals = getAtlasNodeHaloVisuals(props);
  return (
    <circle
      className={styles.nodeHalo}
      r={visuals.radius}
      fill="transparent"
      stroke={visuals.stroke}
      strokeOpacity={visuals.strokeOpacity}
      strokeWidth={visuals.strokeWidth}
    />
  );
};

const getAtlasNodeFillOpacity = (selected: boolean): number => {
  if (selected) {
    return 1;
  }
  return 0.82;
};

const AtlasNodeBody = ({
  node,
  radius,
  selected,
}: Readonly<{
  node: AtlasNode;
  radius: number;
  selected: boolean;
}>) => (
  <g
    fill={ENTITY_FILL[node.entity_type]}
    fillOpacity={getAtlasNodeFillOpacity(selected)}
    stroke="#080907"
    strokeWidth={2}
  >
    {renderAtlasNodeGeometry(node, radius)}
  </g>
);

const AtlasNodeGlyph = (
  props: Readonly<{
    node: AtlasNode;
    priorityLabel: boolean;
    radius: number;
    selected: boolean;
    showLabel: boolean;
  }>,
): ReactNode => (
  <>
    <AtlasNodeHalo node={props.node} radius={props.radius} selected={props.selected} />
    <AtlasNodeBody node={props.node} radius={props.radius} selected={props.selected} />
    <NeedsReviewMarker radius={props.radius} visible={props.node.flags.includes("needs-review")} />
    <AtlasNodeLabel
      node={props.node}
      priority={props.priorityLabel}
      radius={props.radius}
      show={props.showLabel}
    />
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

export { AtlasEdgeLine, AtlasNodeMark };
export type { AtlasNodeMarkProps };
