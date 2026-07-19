"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { Minus, Plus, Scan } from "lucide-react";

import { useAtlasLayout } from "./hooks/use-atlas-layout";
import type { AtlasLayoutMode } from "./lib/atlas-query-state";
import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
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
  source: "#f0ede4",
  reporter: "#88a9ff",
};

const EDGE_STROKE: Record<AtlasEdge["relation_type"], string> = {
  ownership: "#d7b35f",
  owned_by: "#b79348",
  parent_org: "#b79348",
  part_of: "#a88645",
  publishes: "#b8b2a7",
  employed_by: "#8ca0c8",
  current_outlet: "#88a9ff",
  coauthor: "#88a9ff",
  shared_outlet: "#6f86bd",
};

function nodeRadius(node: AtlasNode): number {
  const base = node.entity_type === "organization" ? 12 : node.entity_type === "source" ? 9 : 8;
  const degree = Math.min(Math.log2(1 + node.connection_count) * 1.4, 8);
  const articles = Math.min(Math.log10(1 + node.article_count) * 0.8, 3);
  return base + degree + articles;
}

function nodeShape(node: AtlasNode, radius: number) {
  if (node.entity_type === "source") {
    return <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.35} />;
  }
  if (node.entity_type === "reporter") {
    return <path d={`M 0 ${-radius} C ${radius} ${-radius} ${radius} ${radius * 0.55} 0 ${radius} C ${-radius} ${radius * 0.55} ${-radius} ${-radius} 0 ${-radius} Z`} />;
  }
  return <circle r={radius} />;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 760 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(selectedId);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setDimensions({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(360, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const layoutOptions = useMemo(
    () => ({
      nodes,
      edges,
      width: dimensions.width,
      height: dimensions.height,
      layout,
      selectedId,
      graphVersion,
    }),
    [dimensions.height, dimensions.width, edges, graphVersion, layout, nodes, selectedId],
  );
  const { positions, stable } = useAtlasLayout(layoutOptions);
  const selectedNeighbors = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    edges.forEach((edge) => {
      if (edge.source_id === selectedId) ids.add(edge.target_id);
      if (edge.target_id === selectedId) ids.add(edge.source_id);
    });
    return ids;
  }, [edges, selectedId]);
  const orderedNodes = useMemo(
    () => [...nodes].sort((left, right) => right.connection_count - left.connection_count || left.label.localeCompare(right.label)),
    [nodes],
  );

  useEffect(() => {
    if (selectedId) setActiveNodeId(selectedId);
    else if (orderedNodes.length > 0 && !activeNodeId) setActiveNodeId(orderedNodes[0]!.id);
  }, [activeNodeId, orderedNodes, selectedId]);

  const fitGraph = useCallback(() => {
    const values = Object.values(positions);
    if (values.length === 0) return;
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
      Math.max(0.35, Math.min((dimensions.width - padding * 2) / width, (dimensions.height - padding * 2) / height)),
    );
    setTransform({
      scale,
      x: dimensions.width / 2 - ((minX + maxX) / 2) * scale,
      y: dimensions.height / 2 - ((minY + maxY) / 2) * scale,
    });
  }, [dimensions.height, dimensions.width, positions]);

  useEffect(() => {
    if (stable) fitGraph();
  }, [fitGraph, graphVersion, layout, stable]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointerX = clientX - bounds.left;
    const pointerY = clientY - bounds.top;
    setTransform((current) => {
      const nextScale = Math.min(3.5, Math.max(0.3, current.scale * factor));
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      };
    });
  }, []);

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest("[data-node-id]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    setPanning(true);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: pan.originX + event.clientX - pan.x,
      y: pan.originY + event.clientY - pan.y,
    }));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleNodeKeyboard(event: KeyboardEvent<SVGGElement>, nodeId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(nodeId);
      return;
    }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = orderedNodes.findIndex((node) => node.id === nodeId);
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + orderedNodes.length) % orderedNodes.length;
    const nextNode = orderedNodes[nextIndex];
    if (!nextNode) return;
    setActiveNodeId(nextNode.id);
    requestAnimationFrame(() => {
      svgRef.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(nextNode.id)}"]`)?.focus();
    });
  }

  if (nodes.length === 0 && !loading) {
    return (
      <div ref={containerRef} className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>No entities match this view.</div>
          <p className={styles.contextCopy}>Clear a filter or search for a different source, organization, or reporter.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg
        ref={svgRef}
        className={styles.graphCanvas}
        data-panning={panning}
        role="group"
        aria-label={`Intelligence Atlas graph with ${nodes.length} entities and ${edges.length} relationships`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          <marker id="atlas-arrow-gold" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#d7b35f" />
          </marker>
          <marker id="atlas-arrow-neutral" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#b8b2a7" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {edges.map((edge) => {
            const source = positions[edge.source_id];
            const target = positions[edge.target_id];
            if (!source || !target) return null;
            const dimmed = focus && selectedId && !selectedNeighbors.has(edge.source_id) && !selectedNeighbors.has(edge.target_id);
            const dashed = edge.is_inferred || edge.confidence_tier === "likely" || edge.confidence_tier === "unresolved";
            return (
              <line
                key={edge.id}
                className={styles.edge}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={EDGE_STROKE[edge.relation_type]}
                strokeOpacity={dimmed ? 0.08 : Math.max(0.22, edge.confidence ?? 0.55)}
                strokeDasharray={dashed ? "5 5" : undefined}
                markerEnd={edge.direction === "directed" ? `url(#${edge.relation_type === "ownership" ? "atlas-arrow-gold" : "atlas-arrow-neutral"})` : undefined}
              />
            );
          })}
          {nodes.map((node) => {
            const position = positions[node.id];
            if (!position) return null;
            const radius = nodeRadius(node);
            const selected = selectedId === node.id;
            const active = activeNodeId === node.id;
            const dimmed = focus && selectedId && !selectedNeighbors.has(node.id);
            const confidence = node.confidence_tier ?? "unresolved";
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                className={styles.nodeButton}
                transform={`translate(${position.x} ${position.y})`}
                tabIndex={active ? 0 : -1}
                role="button"
                aria-label={`${node.label}, ${node.entity_type}, ${node.connection_count} connections, ${confidence} confidence`}
                aria-pressed={selected}
                opacity={dimmed ? 0.16 : 1}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveNodeId(node.id);
                  onSelect(node.id);
                }}
                onKeyDown={(event) => handleNodeKeyboard(event, node.id)}
              >
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
                {node.flags.includes("needs-review") ? (
                  <circle cx={radius * 0.7} cy={-radius * 0.7} r={3.2} fill="#f1635e" stroke="#080907" strokeWidth={1.5} />
                ) : null}
                <text className={styles.nodeLabel} x={radius + 7} y={1} fill="#f0ede4">
                  {node.label.length > 34 ? `${node.label.slice(0, 31)}…` : node.label}
                </text>
                <text className={styles.nodeMeta} x={radius + 7} y={13}>
                  {node.entity_type} · {node.connection_count}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-24 left-5 z-10 flex gap-2">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom in"
          onClick={() => zoomAt(dimensions.width / 2, dimensions.height / 2, 1.18)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom out"
          onClick={() => zoomAt(dimensions.width / 2, dimensions.height / 2, 1 / 1.18)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className={styles.iconButton} aria-label="Fit visible graph" onClick={fitGraph}>
          <Scan className="h-4 w-4" />
        </button>
      </div>
      <div className={styles.graphStatus} aria-live="polite">
        <span className={`h-1.5 w-1.5 rounded-full ${stable ? "bg-emerald-300" : "animate-pulse bg-amber-300"}`} />
        {stable ? "Layout stable" : "Calculating layout"}
      </div>
      <AtlasAccessibleList nodes={nodes} edges={edges} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}
