"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { GlobalNavigation } from "@/components/global-navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchCacheStatus,
  fetchSourceStats,
  fetchWikiIndexStatus,
  fetchWikiOwnershipGraph,
  fetchWikiSource,
  fetchWikiSources,
  type CacheStatus,
  type SourceStats,
  type WikiIndexStatus,
  type WikiOwnershipGraph,
  type WikiSourceCard,
  type WikiSourceProfile,
} from "@/lib/api";
import { OwnershipGraphCanvas } from "./ownership-graph-canvas";
import {
  isSource,
  matchesSearch,
  normalizeType,
  type EdgeFilter,
  type LayoutEdge,
  type LayoutNode,
  type NodeFilter,
} from "./graph-utils";
import {
  buildProcessedGraph,
  Field,
  FilterButton,
  MetricCard,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from "./source-intelligence-support";
import { SourceIntelligenceOperations } from "./source-intelligence-operations";

const PANEL_CLASS =
  "rounded-[1.6rem] border border-white/[0.08] bg-background/70 p-4 backdrop-blur-xl";
const SURFACE_CLASS =
  "rounded-[1.25rem] border border-white/[0.08] bg-black/20 backdrop-blur-sm";

export function SourceIntelligenceWorkspace() {
  const [search, setSearch] = useState("");
  const [biasFilter, setBiasFilter] = useState<string>("all");
  const [fundingFilter, setFundingFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSourceName, setSelectedSourceName] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("ownership");
  const [focusNeighborhood, setFocusNeighborhood] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("ingestion");
  const [visibleSources, setVisibleSources] = useState(8);
  const [dimensions, setDimensions] = useState({ width: 1320, height: 720 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoFitRef = useRef(false);

  const graphQuery = useQuery<WikiOwnershipGraph>({
    queryKey: ["wiki-ownership-graph"],
    queryFn: fetchWikiOwnershipGraph,
    retry: 1,
  });
  const sourcesQuery = useQuery<WikiSourceCard[]>({
    queryKey: ["wiki-sources-workspace"],
    queryFn: () => fetchWikiSources({ limit: 500 }),
    retry: 1,
  });
  const sourceStatsQuery = useQuery<SourceStats[]>({
    queryKey: ["debug-source-stats-summary"],
    queryFn: fetchSourceStats,
    retry: 1,
  });
  const cacheStatusQuery = useQuery<CacheStatus | null>({
    queryKey: ["debug-cache-status-summary"],
    queryFn: fetchCacheStatus,
    retry: 1,
  });
  const wikiIndexStatusQuery = useQuery<WikiIndexStatus>({
    queryKey: ["wiki-index-status"],
    queryFn: fetchWikiIndexStatus,
    retry: 1,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDimensions({
        width: Math.max(Math.floor(entry.contentRect.width), 720),
        height: Math.max(Math.floor(entry.contentRect.height), 520),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const processedGraph = useMemo(
    () => buildProcessedGraph(graphQuery.data, dimensions.width, dimensions.height),
    [dimensions.height, dimensions.width, graphQuery.data],
  );
  const nodesById = useMemo(
    () => new Map((processedGraph?.nodes ?? []).map((node) => [node.id, node])),
    [processedGraph?.nodes],
  );
  const topHubs = useMemo(
    () =>
      [...(processedGraph?.nodes ?? [])]
        .sort((a, b) => {
          const typePriority = Number(isSource(a)) - Number(isSource(b));
          if (typePriority !== 0) return typePriority;
          return b.degree - a.degree;
        })
        .slice(0, 8),
    [processedGraph?.nodes],
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

  const filterOptions = useMemo(() => {
    const sources = sourcesQuery.data ?? [];
    const biases = new Set<string>();
    const fundings = new Set<string>();
    const countries = new Set<string>();
    const types = new Set<string>();

    sources.forEach((source) => {
      if (source.bias_rating) biases.add(source.bias_rating);
      if (source.funding_type) fundings.add(source.funding_type);
      if (source.country) countries.add(source.country);
      if (source.category) types.add(source.category);
    });

    return {
      biases: [...biases].sort(),
      fundings: [...fundings].sort(),
      countries: [...countries].sort(),
      types: [...types].sort(),
    };
  }, [sourcesQuery.data]);

  const filteredSources = useMemo(() => {
    let result = sourcesQuery.data ?? [];

    if (biasFilter !== "all") {
      result = result.filter((source) => source.bias_rating?.toLowerCase() === biasFilter.toLowerCase());
    }
    if (fundingFilter !== "all") {
      result = result.filter((source) => source.funding_type?.toLowerCase() === fundingFilter.toLowerCase());
    }
    if (countryFilter !== "all") {
      result = result.filter((source) => source.country?.toLowerCase() === countryFilter.toLowerCase());
    }
    if (typeFilter !== "all") {
      result = result.filter((source) => source.category?.toLowerCase() === typeFilter.toLowerCase());
    }

    if (search.trim()) {
      const query = search.trim().toLowerCase();
      result = result.filter(
        (source) =>
          source.name.toLowerCase().includes(query) ||
          source.country?.toLowerCase().includes(query) ||
          source.bias_rating?.toLowerCase().includes(query) ||
          source.funding_type?.toLowerCase().includes(query),
      );
    }

    return result;
  }, [biasFilter, countryFilter, fundingFilter, search, sourcesQuery.data, typeFilter]);

  const sourceList = filteredSources.slice(0, visibleSources);
  const sourceStats = useMemo(() => sourceStatsQuery.data ?? [], [sourceStatsQuery.data]);
  const cacheStatus = cacheStatusQuery.data;
  const indexStatus = wikiIndexStatusQuery.data;
  const healthySources = sourceStats.filter((source) => source.status === "success").length;
  const warningSources = sourceStats.filter((source) => source.status === "warning").length;
  const failedSources = sourceStats.filter((source) => source.status === "error").length;

  const defaultSourceName = useMemo(
    () =>
      filteredSources.find((source) => source.name === "RT")?.name ??
      filteredSources.find((source) => source.name === "BBC News")?.name ??
      filteredSources[0]?.name ??
      null,
    [filteredSources],
  );

  const defaultSelectedNodeId = useMemo(() => {
    if (!processedGraph) return null;
    const preferredSourceName =
      selectedSourceName ??
      defaultSourceName ??
      topHubs.find((node) => isSource(node))?.label ??
      topHubs[0]?.label ??
      null;
    return processedGraph.nodes.find((node) => node.label === preferredSourceName)?.id ?? topHubs[0]?.id ?? null;
  }, [defaultSourceName, processedGraph, selectedSourceName, topHubs]);

  const effectiveSelectedNodeId =
    selectedNodeId ??
    defaultSelectedNodeId ??
    (search.trim() && matchingNodes.length > 0
      ? matchingNodes[0].id
      : focusNeighborhood && topHubs.length > 0
        ? topHubs[0].id
        : null);

  const selectedNode = effectiveSelectedNodeId ? nodesById.get(effectiveSelectedNodeId) ?? null : null;
  const selectedNeighborhood = useMemo(
    () => new Set(selectedNode ? [selectedNode.id, ...selectedNode.neighbors] : []),
    [selectedNode],
  );

  const visibleGraph = useMemo(() => {
    if (!processedGraph) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[] };

    const nodes = processedGraph.nodes.filter((node) => {
      const typeMatches =
        nodeFilter === "all" ||
        (nodeFilter === "organizations" && !isSource(node)) ||
        (nodeFilter === "sources" && isSource(node));
      const searchMatches = matchesSearch(node, search.trim().toLowerCase());
      const neighborhoodMatches = focusNeighborhood && selectedNode ? selectedNeighborhood.has(node.id) : true;
      return typeMatches && searchMatches && neighborhoodMatches;
    });

    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = processedGraph.edges.filter((edge) => {
      const edgeMatches = edgeFilter === "all" || edge.type === edgeFilter;
      return edgeMatches && visibleIds.has(edge.source) && visibleIds.has(edge.target);
    });

    return { nodes, edges };
  }, [edgeFilter, focusNeighborhood, nodeFilter, processedGraph, search, selectedNeighborhood, selectedNode]);

  const matchingNodeIds = useMemo(() => new Set(matchingNodes.map((node) => node.id)), [matchingNodes]);
  const inspectorSourceName =
    selectedSourceName ?? (selectedNode && isSource(selectedNode) ? selectedNode.label : null) ?? defaultSourceName;

  const sourceProfileQuery = useQuery<WikiSourceProfile>({
    queryKey: ["wiki-source-profile", inspectorSourceName],
    queryFn: () => fetchWikiSource(inspectorSourceName ?? ""),
    enabled: Boolean(inspectorSourceName),
    retry: 1,
  });

  const selectedSourceProfile = sourceProfileQuery.data ?? null;
  const selectedSourceStats = useMemo(
    () => sourceStats.find((source) => source.name === inspectorSourceName) ?? null,
    [inspectorSourceName, sourceStats],
  );
  const selectedCardTone =
    selectedSourceStats?.status === "warning"
      ? "Review"
      : selectedSourceStats?.status === "error"
        ? "Issue"
        : "Ready";
  const indexedSources = indexStatus?.by_status.indexed ?? 0;
  const pendingSources = Object.entries(indexStatus?.by_status ?? {}).reduce((count, [key, value]) => {
    return key === "indexed" ? count : count + value;
  }, 0);
  const matchConfidence =
    selectedSourceProfile?.organization?.research_confidence ??
    selectedSourceProfile?.match_status ??
    "Not recorded";
  const ownershipSummary =
    selectedSourceProfile?.ownership_chain[0]?.name ??
    selectedSourceProfile?.parent_company ??
    selectedSourceProfile?.organization?.name ??
    "Not recorded";
  const selectedDossierFields = useMemo(() => {
    return (selectedSourceProfile?.dossier_sections ?? [])
      .flatMap((section) => section.items)
      .filter((item) => item.label && item.value)
      .slice(0, 3)
      .map((item) => ({ label: item.label ?? "", value: item.value ?? "" }));
  }, [selectedSourceProfile?.dossier_sections]);

  useEffect(() => {
    if (visibleGraph.nodes.length === 0) return;
    if (selectedNodeId || hasAutoFitRef.current) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of visibleGraph.nodes) {
      minX = Math.min(minX, node.x - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }

    const graphWidth = Math.max(maxX - minX, 1);
    const graphHeight = Math.max(maxY - minY, 1);
    const padding = 72;
    const scale = Math.min(
      1,
      (dimensions.width - padding * 2) / graphWidth,
      (dimensions.height - padding * 2) / graphHeight,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setTransform({
      scale,
      x: dimensions.width / 2 - centerX * scale,
      y: dimensions.height / 2 - centerY * scale,
    });
    hasAutoFitRef.current = true;
  }, [dimensions.height, dimensions.width, selectedNodeId, visibleGraph.nodes]);

  function centerOnNode(node: LayoutNode) {
    setSelectedNodeId(node.id);
    setTransform({
      scale: 1.28,
      x: dimensions.width / 2 - node.x * 1.28,
      y: dimensions.height / 2 - node.y * 1.28,
    });
  }

  function selectSource(sourceName: string) {
    setSelectedSourceName(sourceName);
    const graphNode = (processedGraph?.nodes ?? []).find((node) => isSource(node) && node.label === sourceName);
    if (graphNode) {
      centerOnNode(graphNode);
      return;
    }
    setSelectedNodeId(null);
  }

  async function refreshWorkspace() {
    await Promise.allSettled([
      graphQuery.refetch(),
      sourcesQuery.refetch(),
      cacheStatusQuery.refetch(),
      sourceStatsQuery.refetch(),
      wikiIndexStatusQuery.refetch(),
      selectedSourceName ? sourceProfileQuery.refetch() : Promise.resolve(null),
    ]);
  }

  async function exportWorkspaceSnapshot() {
    setExporting(true);
    try {
      const payload = {
        source: inspectorSourceName,
        generated_at: new Date().toISOString(),
        graph: {
          node_filter: nodeFilter,
          edge_filter: edgeFilter,
          visible_nodes: visibleGraph.nodes.length,
          visible_edges: visibleGraph.edges.length,
        },
        cache_status: cacheStatus,
        wiki_index_status: indexStatus,
        source_profile: selectedSourceProfile,
        source_stats: selectedSourceStats,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(inspectorSourceName ?? "source-intelligence").toLowerCase().replace(/\s+/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex min-h-screen overflow-hidden bg-background text-foreground">
      <GlobalNavigation />
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(208,175,115,0.14),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(109,119,132,0.16),transparent_28%)]" />
        <div className="relative flex h-screen flex-col gap-4 p-4">
          <header className="flex items-start justify-between gap-6 border-b border-white/[0.08] pb-4">
            <div>
              <h1 className="font-serif text-[2.35rem] leading-none text-foreground">Source Intelligence</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Track ownership links, source records, and pipeline health in one place.
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                Updated{" "}
                {cacheStatus?.cache_age_seconds != null
                  ? `${Math.max(1, Math.round(cacheStatus.cache_age_seconds / 60))}m ago`
                  : "just now"}
              </span>
              <HeaderButton
                onClick={() => setFocusNeighborhood((current) => !current)}
                active={focusNeighborhood}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                Focus graph
              </HeaderButton>
              <HeaderButton
                onClick={() => {
                  void exportWorkspaceSnapshot();
                }}
                icon={<Download className="h-3.5 w-3.5" />}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Export data"}
              </HeaderButton>
              <button
                onClick={() => {
                  void refreshWorkspace();
                }}
                className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                Refresh workspace
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)_340px] gap-4">
            <section className={`${PANEL_CLASS} flex min-h-0 flex-col`}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-serif text-[1.05rem] uppercase tracking-[0.08em] text-foreground">
                    Source Explorer
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </div>
                <button className="rounded-lg border border-white/10 p-2 text-muted-foreground hover:border-white/20">
                  <SlidersHorizontal className={`h-4 w-4 ${sourcesQuery.isFetching ? "animate-pulse text-primary" : ""}`} />
                </button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search sources, countries, or funding"
                  className="border-white/10 bg-black/20 pl-9 text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <FilterSelect label="Bias" value={biasFilter} onValueChange={setBiasFilter} options={filterOptions.biases} />
                <FilterSelect
                  label="Funding"
                  value={fundingFilter}
                  onValueChange={setFundingFilter}
                  options={filterOptions.fundings}
                />
                <FilterSelect
                  label="Country"
                  value={countryFilter}
                  onValueChange={setCountryFilter}
                  options={filterOptions.countries}
                />
                <FilterSelect label="Type" value={typeFilter} onValueChange={setTypeFilter} options={filterOptions.types} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <MetricCard label="Shown" value={filteredSources.length} compact />
                <MetricCard label="Indexed" value={indexedSources} compact />
                <MetricCard label="Need Review" value={pendingSources} compact />
                <MetricCard
                  label="Coverage"
                  value={
                    cacheStatus?.total_sources
                      ? `${Math.round((cacheStatus.sources_working / cacheStatus.total_sources) * 100)}%`
                      : "—"
                  }
                  compact
                />
              </div>

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-2">
                  {sourceList.map((source) => {
                    const isSelected = inspectorSourceName === source.name;
                    return (
                      <button
                        key={source.name}
                        onClick={() => selectSource(source.name)}
                        className={`w-full rounded-[1.15rem] border px-3 py-3 text-left transition-all ${
                          isSelected
                            ? "border-primary/45 bg-white/[0.05] shadow-[0_0_0_1px_rgba(208,175,115,0.08)]"
                            : "border-white/[0.06] bg-black/[0.15] hover:border-white/15 hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/25 font-mono text-xs text-foreground">
                            {(source.country || source.name).slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="truncate font-serif text-[1.15rem] text-foreground">{source.name}</div>
                              <div className="text-xs text-muted-foreground">{source.country || "—"}</div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em]">
                              {source.bias_rating ? <BadgeTone>{source.bias_rating}</BadgeTone> : null}
                              {source.funding_type ? <BadgeTone tone="warm">{source.funding_type}</BadgeTone> : null}
                              {source.category ? <BadgeTone tone="cool">{source.category}</BadgeTone> : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {filteredSources.length > visibleSources ? (
                    <button
                      onClick={() => setVisibleSources((current) => current + 8)}
                      className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-muted-foreground hover:border-white/20 hover:text-foreground"
                    >
                      Show more sources
                    </button>
                  ) : null}

                  {sourcesQuery.isLoading ? (
                    <div className="flex items-center justify-center rounded-2xl px-3 py-6 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_330px] gap-4 overflow-hidden">
              <div className={`${PANEL_CLASS} relative flex min-h-0 flex-col source-section-surface`}>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      Source Map
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Follow owner groups, publishing links, and the current source neighborhood.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                    <span className="mr-1 text-muted-foreground">Nodes</span>
                    <FilterButton active={nodeFilter === "all"} onClick={() => setNodeFilter("all")}>
                      All
                    </FilterButton>
                    <FilterButton active={nodeFilter === "organizations"} onClick={() => setNodeFilter("organizations")}>
                      Orgs
                    </FilterButton>
                    <FilterButton active={nodeFilter === "sources"} onClick={() => setNodeFilter("sources")}>
                      Sources
                    </FilterButton>
                    <span className="ml-2 mr-1 text-muted-foreground">Links</span>
                    <FilterButton active={edgeFilter === "all"} onClick={() => setEdgeFilter("all")}>
                      All
                    </FilterButton>
                    <FilterButton active={edgeFilter === "ownership"} onClick={() => setEdgeFilter("ownership")}>
                      Ownership
                    </FilterButton>
                    <FilterButton active={edgeFilter === "publishes"} onClick={() => setEdgeFilter("publishes")}>
                      Publishes
                    </FilterButton>
                    <span className="ml-2 inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-muted-foreground">
                      Layout
                      <ChevronDown className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-4 gap-2">
                  <MetricCard label="Sources" value={processedGraph?.stats.sources ?? 0} compact />
                  <MetricCard label="Groups" value={processedGraph?.stats.organizations ?? 0} compact />
                  <MetricCard label="Countries" value={processedGraph?.stats.countries ?? 0} compact />
                  <MetricCard label="Links" value={visibleGraph.edges.length} compact />
                </div>

                <div className="min-h-0 flex-1">
                  <OwnershipGraphCanvas
                    dimensions={dimensions}
                    loading={graphQuery.isLoading}
                    errorMessage={graphQuery.error instanceof Error ? graphQuery.error.message : null}
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
                    onSelectedNodeChange={(value) => {
                      setSelectedNodeId(value);
                      const node = nodesById.get(value);
                      if (node && isSource(node)) {
                        setSelectedSourceName(node.label);
                      }
                    }}
                    onTransformChange={setTransform}
                    onZoom={(direction) =>
                      setTransform((current) => ({
                        ...current,
                        scale: direction === "in" ? Math.min(current.scale * 1.18, 3.2) : Math.max(current.scale / 1.18, 0.45),
                      }))
                    }
                    onResetView={() => setTransform({ x: 0, y: 0, scale: 1 })}
                  />
                </div>
              </div>

              <SourceIntelligenceOperations
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabs={WORKSPACE_TABS}
                sourceStats={sourceStats}
                cacheStatus={cacheStatus ?? null}
                wikiIndexStatus={indexStatus}
                selectedSourceName={inspectorSourceName}
                selectedSourceProfile={selectedSourceProfile}
                onRefreshAll={() => void refreshWorkspace()}
                onSourceProfileRefresh={() => {
                  if (!inspectorSourceName) return Promise.resolve();
                  return sourceProfileQuery.refetch().then(() => undefined);
                }}
              />
            </section>

            <aside className="relative z-10 flex min-h-0 min-w-0 flex-col gap-4">
              <section className={PANEL_CLASS}>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Inspector</div>
                <div className={`mt-3 ${SURFACE_CLASS} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/[0.15] font-mono text-[11px] text-foreground">
                        {(inspectorSourceName || "NA").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="font-serif text-[1.7rem] leading-none text-foreground">
                          {inspectorSourceName || "No source selected"}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{selectedSourceProfile?.country || selectedNode?.country || "No country"}</span>
                          <span>•</span>
                          <span>{selectedSourceProfile?.funding_type || selectedNode?.funding || "No funding label"}</span>
                          <span>•</span>
                          <span>{selectedSourceProfile?.bias_rating || selectedNode?.bias || "No bias label"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          selectedCardTone === "Review"
                            ? "bg-amber-400"
                            : selectedCardTone === "Issue"
                              ? "bg-red-400"
                              : "bg-emerald-400"
                        }`}
                      />
                      {selectedCardTone}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-black/[0.15]">
                    <StatCell
                      label="Owner"
                      value={selectedSourceProfile?.ownership_chain[0]?.name || "—"}
                      subvalue={selectedSourceProfile?.organization?.org_type || "No org type"}
                    />
                    <StatCell
                      label="Links"
                      value={selectedNode ? String(selectedNode.degree) : "—"}
                      subvalue={`${selectedNode?.ownershipDegree ?? 0} ownership`}
                    />
                    <StatCell
                      label="Articles"
                      value={selectedSourceStats?.article_count ?? "—"}
                      subvalue={selectedSourceStats?.status || "No run yet"}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
                    <InfoRow label="Bias" value={selectedSourceProfile?.bias_rating || selectedNode?.bias || "Not recorded"} />
                    <InfoRow
                      label="Type"
                      value={selectedSourceProfile?.source_type || normalizeType(selectedNode || ({ type: "source" } as LayoutNode))}
                    />
                    <InfoRow label="Funding" value={selectedSourceProfile?.funding_type || selectedNode?.funding || "Not recorded"} />
                    <InfoRow label="Country" value={selectedSourceProfile?.country || selectedNode?.country || "Not recorded"} />
                  </div>
                </div>
              </section>

              <section className={PANEL_CLASS}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Media Record</div>
                  {inspectorSourceName ? (
                    <a
                      href={`/wiki/source/${encodeURIComponent(inspectorSourceName)}`}
                      className="text-sm text-primary hover:text-foreground"
                    >
                      Open source page
                    </a>
                  ) : null}
                </div>

                <div className={`mt-3 ${SURFACE_CLASS} space-y-4 p-4`}>
                  <Field label="Ownership" value={ownershipSummary} />
                  <Field label="Match Confidence" value={matchConfidence} />
                  <Field
                    label="Overview"
                    value={selectedSourceProfile?.overview || "This source does not have a summary yet."}
                    multiline
                  />
                  {selectedDossierFields.map((item) => (
                    <Field key={item.label} label={item.label} value={item.value} multiline />
                  ))}
                </div>
              </section>

              <section className={PANEL_CLASS}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">System Status</div>
                  <button
                    onClick={() => {
                      void refreshWorkspace();
                    }}
                    className="rounded border border-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:border-white/20 hover:text-foreground"
                  >
                    Refresh data
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MetricCard label="Sources" value={cacheStatus?.total_sources ?? filteredSources.length} compact />
                  <MetricCard label="Healthy" value={healthySources} tone="text-emerald-400" compact />
                  <MetricCard label="Review" value={warningSources} tone="text-amber-400" compact />
                  <MetricCard label="Issues" value={failedSources} tone="text-red-400" compact />
                </div>
              </section>

              <section className={PANEL_CLASS}>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Cache Snapshot</div>
                <div className={`mt-3 ${SURFACE_CLASS} space-y-2 p-3 text-sm text-muted-foreground`}>
                  <CacheRow
                    label="Last update"
                    value={cacheStatus?.last_updated ? new Date(cacheStatus.last_updated).toLocaleTimeString() : "—"}
                  />
                  <CacheRow label="Cached articles" value={cacheStatus?.total_articles?.toLocaleString() ?? "—"} />
                  <CacheRow label="Refresh state" value={cacheStatus?.update_in_progress ? "Running" : "Idle"} />
                  <CacheRow
                    label="Cache age"
                    value={cacheStatus?.cache_age_seconds != null ? `${cacheStatus.cache_age_seconds.toFixed(1)}s` : "—"}
                  />
                  <CacheRow
                    label="Wiki entries"
                    value={indexStatus?.total_entries != null ? String(indexStatus.total_entries) : "—"}
                  />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  icon,
  active,
  disabled,
}: {
  children: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
        active
          ? "border-primary/35 bg-primary/10 text-foreground"
          : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
      } ${disabled ? "opacity-60" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

function BadgeTone({
  children,
  tone = "default",
}: {
  children: string;
  tone?: "default" | "warm" | "cool";
}) {
  const toneClass =
    tone === "warm"
      ? "border-primary/25 bg-primary/10 text-[#e7d8bc]"
      : tone === "cool"
        ? "border-white/[0.12] bg-white/[0.06] text-muted-foreground"
        : "border-white/12 bg-black/20 text-foreground/85";

  return <span className={`rounded-md border px-2 py-1 ${toneClass}`}>{children}</span>;
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (val: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-black/[0.15] px-3 py-2 text-sm text-muted-foreground hover:border-white/20 data-[state=open]:border-white/20">
        <span className="truncate">
          <SelectValue placeholder={`All ${label}`} />
        </span>
      </SelectTrigger>
      <SelectContent className="border-white/10 bg-background/95 text-foreground backdrop-blur-xl">
        <SelectItem value="all">{`All ${label}`}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatCell({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string | number;
  subvalue: string;
}) {
  return (
    <div className="p-3 text-center">
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{subvalue}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function CacheRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}
