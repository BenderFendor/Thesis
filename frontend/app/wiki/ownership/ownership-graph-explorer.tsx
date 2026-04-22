"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Maximize2, Minimize2 } from "lucide-react";
import { GlobalNavigation } from "@/components/global-navigation";
import { fetchWikiOwnershipGraph, type WikiOwnershipGraph } from "@/lib/api";
import type { LayoutNode } from "./graph-utils";
import { ControlsPanel, InspectorPanel } from "./ownership-graph-panels";
import { OwnershipGraphCanvas } from "./ownership-graph-canvas";
import {
  isSource,
  matchesSearch,
  runSimulation,
  type LayoutEdge,
  type LayoutNode as GraphNode,
  type ProcessedGraph,
  type EdgeFilter,
  type NodeFilter,
} from "./graph-utils";

export function OwnershipGraphExplorer() {
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("all");
  const [focusNeighborhood, setFocusNeighborhood] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 1320, height: 900 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    data: graphData,
    isLoading: loading,
    error,
  } = useQuery<WikiOwnershipGraph>({
    queryKey: ["wiki-ownership-graph"],
    queryFn: fetchWikiOwnershipGraph,
    retry: 1,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDimensions({
        width: Math.max(Math.floor(entry.contentRect.width), 640),
        height: Math.max(Math.floor(entry.contentRect.height), 640),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fullscreen]);

  const processedGraph = useMemo(() => buildProcessedGraph(graphData, dimensions.width, dimensions.height), [graphData, dimensions.height, dimensions.width]);
  const nodesById = useMemo(() => new Map((processedGraph?.nodes ?? []).map((node) => [node.id, node])), [processedGraph?.nodes]);
  const topHubs = useMemo(
    () =>
      [...(processedGraph?.nodes ?? [])]
        .sort((a, b) => {
          const typePriority = Number(isSource(a)) - Number(isSource(b));
          if (typePriority !== 0) return typePriority;
          return b.degree - a.degree;
        })
        .slice(0, 8),
    [processedGraph?.nodes]
  );

  const matchingNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (processedGraph?.nodes ?? [])
      .filter((node) => {
        const typeMatches =
          nodeFilter === "all" ||
          (nodeFilter === "organizations" && !isSource(node)) ||
          (nodeFilter === "sources" && isSource(node));
        return typeMatches && matchesSearch(node, query);
      })
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 12);
  }, [nodeFilter, processedGraph?.nodes, search]);

  const effectiveSelectedNodeId =
    selectedNodeId ??
    (search.trim() && matchingNodes.length > 0
      ? matchingNodes[0].id
      : focusNeighborhood && topHubs.length > 0
        ? topHubs[0].id
        : null);
  const selectedNode = effectiveSelectedNodeId ? nodesById.get(effectiveSelectedNodeId) ?? null : null;
  const selectedNeighborhood = useMemo(() => new Set(selectedNode ? [selectedNode.id, ...selectedNode.neighbors] : []), [selectedNode]);
  const query = search.trim().toLowerCase();

  const visibleGraph = useMemo(() => {
    if (!processedGraph) return { nodes: [] as GraphNode[], edges: [] as LayoutEdge[] };

    const nodes = processedGraph.nodes.filter((node) => {
      const typeMatches =
        nodeFilter === "all" ||
        (nodeFilter === "organizations" && !isSource(node)) ||
        (nodeFilter === "sources" && isSource(node));
      const searchMatches = matchesSearch(node, query);
      const neighborhoodMatches = focusNeighborhood && selectedNode ? selectedNeighborhood.has(node.id) : true;
      return typeMatches && searchMatches && neighborhoodMatches;
    });

    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = processedGraph.edges.filter((edge) => {
      const edgeMatches = edgeFilter === "all" || edge.type === edgeFilter;
      return edgeMatches && visibleIds.has(edge.source) && visibleIds.has(edge.target);
    });

    return { nodes, edges };
  }, [edgeFilter, focusNeighborhood, nodeFilter, processedGraph, query, selectedNeighborhood, selectedNode]);

  const relatedNodes = useMemo(
    () =>
      selectedNode
        ? selectedNode.neighbors
            .map((neighborId) => nodesById.get(neighborId))
            .filter((node): node is GraphNode => Boolean(node))
            .sort((a, b) => b.degree - a.degree)
        : [],
    [nodesById, selectedNode]
  );

  const relatedOrganizations = relatedNodes.filter((node) => !isSource(node)).slice(0, 12);
  const relatedSources = relatedNodes.filter((node) => isSource(node)).slice(0, 12);
  const matchingNodeIds = useMemo(() => new Set(matchingNodes.map((node) => node.id)), [matchingNodes]);
  const errorMessage = error instanceof Error ? error.message : error ? "Failed to load graph" : null;

  function resetView() {
    setTransform({ x: 0, y: 0, scale: 1 });
  }

  function zoom(direction: "in" | "out") {
    setTransform((current) => ({
      ...current,
      scale: direction === "in" ? Math.min(current.scale * 1.18, 3.2) : Math.max(current.scale / 1.18, 0.45),
    }));
  }

  function centerOnNode(node: LayoutNode) {
    setSelectedNodeId(node.id);
    setTransform({
      scale: 1.35,
      x: dimensions.width / 2 - node.x * 1.35,
      y: dimensions.height / 2 - node.y * 1.35,
    });
  }

  return (
    <div className={`flex overflow-hidden bg-background text-foreground ${fullscreen ? "fixed inset-0 z-50 h-screen w-screen" : "relative z-0 h-screen w-full"}`}>
      <div className="fixed inset-0 z-[-1] pointer-events-none bg-[radial-gradient(circle_at_top,rgba(201,166,107,0.12),transparent_26%),radial-gradient(circle_at_18%_22%,rgba(91,140,255,0.1),transparent_24%),linear-gradient(180deg,#0a0d12_0%,#0e1218_48%,#12161d_100%)]" />
      
      {!fullscreen && <GlobalNavigation />}

      <div className="relative flex-1 min-w-0 overflow-hidden h-screen flex flex-col">
        <header className="absolute left-0 right-0 top-0 z-40 border-b border-white/10 bg-[#090c11]/78 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/wiki" className="text-muted-foreground transition-colors hover:text-[#f5ecd7]">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold text-[#f6f1e8]">Ownership Graph</h1>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#b4ab9b]">
                Guided network explorer
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#b4ab9b]">
            {processedGraph && (
              <span>
                {processedGraph.stats.organizations} orgs / {processedGraph.stats.sources} sources / {processedGraph.edges.length} links
              </span>
            )}
            <button
              onClick={() => setFullscreen((current) => !current)}
              className="rounded-md border border-white/10 bg-black/20 p-1.5 transition-colors hover:border-[#c9a66b]/40 hover:text-[#f5ecd7]"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <div className="absolute inset-0 z-0">
        <OwnershipGraphCanvas
          dimensions={dimensions}
          loading={loading}
          errorMessage={errorMessage}
          nodes={visibleGraph.nodes}
          edges={visibleGraph.edges}
          nodesById={nodesById}
          matchingNodeIds={matchingNodeIds}
          selectedNode={selectedNode}
          selectedNeighborhood={selectedNeighborhood}
          hoveredNodeId={hoveredNodeId}
          transform={transform}
          containerRef={containerRef}
          onHoveredNodeChange={setHoveredNodeId}
          onSelectedNodeChange={setSelectedNodeId}
          onTransformChange={setTransform}
          onZoom={zoom}
          onResetView={resetView}
        />
      </div>

      <div className="absolute top-20 bottom-4 left-4 z-10 w-[320px] pointer-events-auto overflow-y-auto custom-scrollbar">
        <ControlsPanel
          search={search}
          selectedNodeId={effectiveSelectedNodeId}
          nodeFilter={nodeFilter}
          edgeFilter={edgeFilter}
          focusNeighborhood={focusNeighborhood}
          matchingNodes={matchingNodes}
          topHubs={topHubs}
          onSearchChange={setSearch}
          onNodeFilterChange={setNodeFilter}
          onEdgeFilterChange={setEdgeFilter}
          onFocusNeighborhoodChange={setFocusNeighborhood}
          onSelectNode={centerOnNode}
        />
      </div>

      <div className="absolute top-20 bottom-4 right-4 z-10 w-[340px] pointer-events-auto overflow-y-auto custom-scrollbar">
        <InspectorPanel
          processedGraph={processedGraph}
          selectedNode={selectedNode}
          topHubs={topHubs}
          relatedOrganizations={relatedOrganizations}
          relatedSources={relatedSources}
          onSelectNode={centerOnNode}
        />
      </div>
      </div>
    </div>
  );
}

function buildProcessedGraph(
  graphData: WikiOwnershipGraph | undefined,
  width: number,
  height: number
): ProcessedGraph | null {
  if (!graphData) return null;

  const neighborMap = new Map<string, Set<string>>();
  const degreeMap = new Map<string, number>();
  const ownershipDegreeMap = new Map<string, number>();
  const publishesDegreeMap = new Map<string, number>();

  for (const edge of graphData.edges) {
    const sourceNeighbors = neighborMap.get(edge.source) ?? new Set<string>();
    const targetNeighbors = neighborMap.get(edge.target) ?? new Set<string>();
    sourceNeighbors.add(edge.target);
    targetNeighbors.add(edge.source);
    neighborMap.set(edge.source, sourceNeighbors);
    neighborMap.set(edge.target, targetNeighbors);
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    const bucket = edge.type === "ownership" ? ownershipDegreeMap : publishesDegreeMap;
    bucket.set(edge.source, (bucket.get(edge.source) ?? 0) + 1);
    bucket.set(edge.target, (bucket.get(edge.target) ?? 0) + 1);
  }

  const nodes = graphData.nodes.map((node) => {
    const degree = degreeMap.get(node.id) ?? 0;
    return {
      id: node.id,
      label: node.label,
      type: node.type || "source",
      bias: node.bias as string | undefined,
      funding: node.funding as string | undefined,
      country: node.country as string | undefined,
      x: 0,
      y: 0,
      radius: isSource({ type: node.type || "source" }) ? 5 + Math.min(degree, 3) : 10 + Math.min(degree, 8) * 0.65,
      degree,
      ownershipDegree: ownershipDegreeMap.get(node.id) ?? 0,
      publishesDegree: publishesDegreeMap.get(node.id) ?? 0,
      neighbors: [...(neighborMap.get(node.id) ?? new Set<string>())],
    };
  });

  const edges: LayoutEdge[] = graphData.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: edge.type || "ownership",
    percentage: edge.percentage as number | undefined,
  }));

  return {
    nodes: runSimulation(nodes, edges, width, height),
    edges,
    stats: {
      sources: nodes.filter((node) => isSource(node)).length,
      organizations: nodes.filter((node) => !isSource(node)).length,
      countries: new Set(nodes.map((node) => node.country).filter(Boolean)).size,
      ownershipEdges: edges.filter((edge) => edge.type === "ownership").length,
      publishesEdges: edges.filter((edge) => edge.type === "publishes").length,
    },
  };
}
