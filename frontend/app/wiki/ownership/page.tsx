"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { fetchWikiOwnershipGraph, type WikiOwnershipGraph } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

interface SimNode {
  id: string;
  label: string;
  type: string;
  bias?: string;
  funding?: string;
  country?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface SimEdge {
  source: string;
  target: string;
  type: string;
  percentage?: number;
}

// ── Color Scales ─────────────────────────────────────────────────────

function nodeColor(node: SimNode): string {
  if (node.type === "source") {
    switch (node.bias?.toLowerCase()) {
      case "left": return "#3b82f6";
      case "left-center": return "#60a5fa";
      case "center": return "#a1a1aa";
      case "center-right":
      case "right-center": return "#f87171";
      case "right": return "#ef4444";
      default: return "#71717a";
    }
  }
  // Organization nodes
  return "#a78bfa";
}

function edgeColor(type: string): string {
  switch (type) {
    case "ownership": return "rgba(167,139,250,0.4)";
    case "publishes": return "rgba(161,161,170,0.25)";
    default: return "rgba(161,161,170,0.15)";
  }
}

// ── Force Simulation (simplified, no d3-force dependency) ────────────

function runSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  iterations: number = 300
): SimNode[] {
  // Initialize positions
  const nodeMap = new Map<string, SimNode>();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.35;
    n.x = width / 2 + r * Math.cos(angle);
    n.y = height / 2 + r * Math.sin(angle);
    n.vx = 0;
    n.vy = 0;
    n.radius = n.type === "source" ? 6 : 10;
    nodeMap.set(n.id, n);
  });

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const strength = alpha * 0.3;

    // Repulsion (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = 40;
        if (dist < minDist) dist = minDist;
        const force = (strength * 800) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction (edges)
    edges.forEach((e) => {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 80;
      const force = (dist - targetDist) * strength * 0.05;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    // Center gravity
    nodes.forEach((n) => {
      n.vx += (width / 2 - n.x) * strength * 0.01;
      n.vy += (height / 2 - n.y) * strength * 0.01;
    });

    // Apply velocity with damping
    nodes.forEach((n) => {
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      // Boundary
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    });
  }

  return nodes;
}

// ── Main Page ────────────────────────────────────────────────────────

export default function OwnershipGraphPage() {
  const [graphData, setGraphData] = useState<WikiOwnershipGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [simulatedNodes, setSimulatedNodes] = useState<SimNode[]>([]);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 700 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await fetchWikiOwnershipGraph();
        if (!cancelled) setGraphData(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load graph");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Measure container
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // Run simulation when data or dimensions change
  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0) return;

    const simNodes: SimNode[] = graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type || "source",
      bias: n.bias as string | undefined,
      funding: n.funding as string | undefined,
      country: n.country as string | undefined,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 6,
    }));

    const simEdges: SimEdge[] = graphData.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type || "ownership",
      percentage: e.percentage as number | undefined,
    }));

    const result = runSimulation(simNodes, simEdges, dimensions.width, dimensions.height);
    setSimulatedNodes(result);
  }, [graphData, dimensions]);

  const getNodeById = useCallback(
    (id: string) => simulatedNodes.find((n) => n.id === id),
    [simulatedNodes]
  );

  return (
    <div className={`bg-[var(--news-bg-primary)] ${fullscreen ? "fixed inset-0 z-50" : "min-h-screen"}`}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/wiki" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold">Ownership Graph</h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-[0.2em]">
                Media Ownership Network
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            {graphData && (
              <span className="text-xs font-mono text-muted-foreground">
                {graphData.nodes.length} nodes / {graphData.edges.length} edges
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Graph container */}
      <div
        ref={containerRef}
        className="relative"
        style={{ height: fullscreen ? "calc(100vh - 52px)" : "calc(100vh - 120px)" }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>
          </div>
        )}

        {!loading && !error && simulatedNodes.length > 0 && (
          <svg
            width={dimensions.width}
            height={dimensions.height}
            className="cursor-grab"
          >
            {/* Edges */}
            {graphData?.edges.map((e, i) => {
              const source = getNodeById(e.source);
              const target = getNodeById(e.target);
              if (!source || !target) return null;
              return (
                <line
                  key={`edge-${i}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={edgeColor(e.type || "ownership")}
                  strokeWidth={e.type === "ownership" ? 1.5 : 0.8}
                />
              );
            })}

            {/* Nodes */}
            {simulatedNodes.map((node) => (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={hoveredNode?.id === node.id ? node.radius + 3 : node.radius}
                  fill={nodeColor(node)}
                  stroke={hoveredNode?.id === node.id ? "white" : "rgba(255,255,255,0.2)"}
                  strokeWidth={hoveredNode?.id === node.id ? 2 : 0.5}
                  opacity={hoveredNode && hoveredNode.id !== node.id ? 0.4 : 1}
                />
                {/* Label (only show on hover or for org nodes) */}
                {(hoveredNode?.id === node.id || node.type !== "source") && (
                  <text
                    x={node.x}
                    y={node.y - node.radius - 4}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.8)"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    {node.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div
            className="absolute z-10 bg-zinc-900 border border-white/10 p-3 pointer-events-none max-w-xs"
            style={{
              left: Math.min(hoveredNode.x + 15, dimensions.width - 200),
              top: Math.max(hoveredNode.y - 60, 10),
            }}
          >
            <div className="font-serif text-sm font-medium">{hoveredNode.label}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1 space-y-0.5">
              <div>Type: {hoveredNode.type}</div>
              {hoveredNode.bias && <div>Bias: {hoveredNode.bias}</div>}
              {hoveredNode.funding && <div>Funding: {hoveredNode.funding}</div>}
              {hoveredNode.country && <div>Country: {hoveredNode.country}</div>}
            </div>
            {hoveredNode.type === "source" && (
              <Link
                href={`/wiki/source/${encodeURIComponent(hoveredNode.label)}`}
                className="text-[10px] text-blue-400 mt-1 block pointer-events-auto"
              >
                View wiki page
              </Link>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-zinc-950/80 border border-white/10 p-3 text-[10px] font-mono space-y-1.5">
          <div className="uppercase tracking-wider text-muted-foreground mb-1">Legend</div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#3b82f6]" /> Left
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#a1a1aa]" /> Center
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ef4444]" /> Right
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#a78bfa]" /> Organization
          </div>
          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-white/5">
            <div className="w-4 h-0 border-t border-[rgba(167,139,250,0.6)]" /> Ownership
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0 border-t border-dashed border-[rgba(161,161,170,0.4)]" /> Publishes
          </div>
        </div>

        {/* Empty state */}
        {!loading && !error && simulatedNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="font-serif text-lg">No ownership data yet</p>
              <p className="text-sm mt-1">Run the wiki indexer to populate organization data.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
