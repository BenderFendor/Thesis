"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchWikiReporterGraph } from "@/lib/api";

interface GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  id: string;
  label: string;
  politicalLeaning: string;
  articleCount: number;
  radius: number;
}

interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
  weight: number;
  type: string;
}

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

const LEANING_COLORS: Record<string, string> = {
  left: "#3b82f6",
  "center-left": "#60a5fa",
  center: "#6b7280",
  "center-right": "#f59e0b",
  right: "#ef4444",
};

const LEANING_LABELS: Record<string, string> = {
  left: "Left",
  "center-left": "Center-Left",
  center: "Center",
  "center-right": "Center-Right",
  right: "Right",
};

function getLeaningColor(leaning: string | undefined | null): string {
  return LEANING_COLORS[leaning || ""] || "#9ca3af";
}

export default function ReporterGraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const draggedNodeRef = useRef<GraphNode | null>(null);

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({
    width: 1,
    height: 1,
    dpr: 1,
  });
  const graphQuery = useQuery({
    queryKey: ["wiki-reporter-graph", 200],
    queryFn: () => fetchWikiReporterGraph(200),
    retry: 1,
  });
  const stats = {
    nodes: graphQuery.data?.nodes.length ?? 0,
    edges: graphQuery.data?.edges.length ?? 0,
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const observedContainer = container;
    const targetCanvas = canvas;

    function syncCanvasSize() {
      const rect = observedContainer.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      targetCanvas.width = Math.floor(width * dpr);
      targetCanvas.height = Math.floor(height * dpr);
      setCanvasSize((previous) => {
        if (
          previous.width === width &&
          previous.height === height &&
          previous.dpr === dpr
        ) {
          return previous;
        }
        return { width, height, dpr };
      });
    }

    syncCanvasSize();
    const observer = new ResizeObserver(syncCanvasSize);
    observer.observe(observedContainer);
    window.addEventListener("resize", syncCanvasSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
    };
  }, []);

  useEffect(() => {
    const data = graphQuery.data;
    if (!data) return;

    const maxCount = Math.max(1, ...data.nodes.map((n) => n.article_count || 0));
    const graphNodes: GraphNode[] = data.nodes.map((n) => ({
      x: Math.random() * 800 + 100,
      y: Math.random() * 600 + 100,
      vx: 0,
      vy: 0,
      id: n.id,
      label: n.label,
      politicalLeaning: (n.political_leaning as string) || "",
      articleCount: (n.article_count as number) || 0,
      radius: 8 + ((n.article_count as number) || 0) / (maxCount / 16),
    }));

    const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));
    const graphEdges: GraphEdge[] = [];
    for (const e of data.edges) {
      const source = nodeMap.get(e.source as string);
      const target = nodeMap.get(e.target as string);
      if (source && target) {
        graphEdges.push({
          source,
          target,
          weight: (e.weight as number) || 1,
          type: (e.type as string) || "shared_outlet",
        });
      }
    }

    nodesRef.current = graphNodes;
    edgesRef.current = graphEdges;
  }, [graphQuery.data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function simulationStep() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const width = canvasSize.width || 1000;
      const height = canvasSize.height || 800;
      const dragged = draggedNodeRef.current;

      for (const node of nodes) {
        if (node === dragged) continue;

        const fx = (node.x - width / 2) * -0.003;
        const fy = (node.y - height / 2) * -0.003;
        node.vx = (node.vx + fx) * 0.85;
        node.vy = (node.vy + fy) * 0.85;

        node.x = Math.max(node.radius, Math.min(width - node.radius, node.x + node.vx));
        node.y = Math.max(node.radius, Math.min(height - node.radius, node.y + node.vy));
      }

      for (const edge of edges) {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLen = 60 + edge.weight * 5;
        const force = ((dist - targetLen) / dist) * 0.01 * edge.weight;

        const fx = dx * force;
        const fy = dy * force;

        if (edge.source !== dragged) {
          edge.source.vx += fx;
          edge.source.vy += fy;
        }
        if (edge.target !== dragged) {
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.radius + b.radius + 4;
          if (dist < minDist) {
            const repel = ((minDist - dist) / dist) * 0.5;
            const rx = dx * repel;
            const ry = dy * repel;
            if (a !== dragged) { a.vx -= rx; a.vy -= ry; }
            if (b !== dragged) { b.vx += rx; b.vy += ry; }
          }
        }
      }
    }

    function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height, dpr } = canvasSize;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      for (let i = 0; i < 3; i++) {
        simulationStep();
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);

      for (const edge of edgesRef.current) {
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        const alpha = 0.08 + Math.min(edge.weight, 10) * 0.012;
        ctx.strokeStyle =
          edge.type === "coauthor"
            ? `rgba(96, 165, 250, ${alpha + 0.08})`
            : `rgba(148, 163, 184, ${alpha})`;
        ctx.lineWidth = Math.max(0.5, edge.weight * 0.3);
        ctx.stroke();
      }

      const searchLower = search.toLowerCase();
      for (const node of nodesRef.current) {
        const isHovered = hoveredNode === node;
        const matchesSearch = searchLower && node.label.toLowerCase().includes(searchLower);
        const isHighlighted = !searchLower || matchesSearch;

        const color = getLeaningColor(node.politicalLeaning);
        const r = isHovered ? node.radius * 1.4 : node.radius;
        const alpha = isHighlighted ? 1 : 0.15;

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        if (isHighlighted && (r > 12 || isHovered)) {
          const fontSize = Math.max(8, Math.min(10, r * 0.7));
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = isHovered ? "#f1f5f9" : "#cbd5e1";
          ctx.textAlign = "center";
          const maxLabelLen = Math.max(3, (r * 2) / 5);
          const shortLabel =
            node.label.length > maxLabelLen
              ? node.label.slice(0, maxLabelLen - 1) + "..."
              : node.label;
          ctx.fillText(shortLabel, node.x, node.y + r + fontSize + 2);
        }
      }

      animationRef.current = requestAnimationFrame(render);
    }

    animationRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationRef.current);
  }, [canvasSize, hoveredNode, search]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let found: GraphNode | null = null;
      for (const node of nodesRef.current) {
        const dx = node.x - mx;
        const dy = node.y - my;
        if (dx * dx + dy * dy < (node.radius + 4) ** 2) {
          found = node;
          break;
        }
      }
      setHoveredNode(found);

      const dragged = draggedNodeRef.current;
      if (dragged) {
        dragged.x = mx;
        dragged.y = my;
        dragged.vx = 0;
        dragged.vy = 0;
      }
    },
    [],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of nodesRef.current) {
      const dx = node.x - mx;
      const dy = node.y - my;
      if (dx * dx + dy * dy < (node.radius + 4) ** 2) {
        draggedNodeRef.current = node;
        return;
      }
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    draggedNodeRef.current = null;
  }, []);

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      {graphQuery.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
          <div className="text-slate-400">Loading reporter network...</div>
        </div>
      )}
      {graphQuery.isError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
          <div className="text-red-400">Failed to load reporter graph</div>
        </div>
      )}

      <div className="absolute top-2 left-2 z-10 flex gap-2 items-center">
        <input
          type="text"
          placeholder="Search reporters..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-sm w-48 placeholder:text-slate-500"
        />
        <div className="bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded text-xs text-slate-400">
          {stats.nodes} reporters, {stats.edges} connections
        </div>
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex gap-2 flex-wrap">
        {Object.entries(LEANING_LABELS).map(([key, label]) => (
          <div
            key={key}
            className="flex items-center gap-1.5 text-[10px] text-slate-400"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: LEANING_COLORS[key] }}
            />
            {label}
          </div>
        ))}
      </div>

      {hoveredNode && (
        <div className="absolute top-10 left-2 z-20 bg-slate-800 border border-slate-700 rounded p-2 text-xs text-slate-300 max-w-[200px]">
          <div className="font-medium text-slate-100">{hoveredNode.label}</div>
          <div>Articles: {hoveredNode.articleCount}</div>
          {hoveredNode.politicalLeaning && (
            <div>
              Leaning:{" "}
              {LEANING_LABELS[hoveredNode.politicalLeaning] ||
                hoveredNode.politicalLeaning}
            </div>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{ minHeight: "100vh" }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
