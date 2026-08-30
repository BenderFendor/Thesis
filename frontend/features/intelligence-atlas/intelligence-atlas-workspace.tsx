"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Network } from "lucide-react";

import type workspaceSupport from "@/app/wiki/ownership/source-intelligence-support";
import { GlobalNavigation } from "@/components/global-navigation";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AtlasEntityList } from "./atlas-entity-list";
import { AtlasInspector } from "./atlas-inspector";
import { AtlasOperationsSheet } from "./atlas-operations-sheet";
import { AtlasStageShell } from "./atlas-stage-shell";
import { AtlasTopbar } from "./atlas-topbar";
import {
  exportAtlas,
  fetchAtlasEntity,
  fetchAtlasGraph,
  fetchAtlasIngestStatus,
  fetchMediaMeasurements,
  fetchAtlasStats,
  searchAtlas,
} from "./lib/atlas-api";
import { parseAtlasQueryState, serializeAtlasQueryState } from './lib/atlas-query-state';
import type { AtlasPanel, AtlasQueryState, AtlasView } from './lib/atlas-query-state';
import { metricPercentage } from './lib/atlas-schema';
import type { AtlasEntityType, AtlasGraphFilters, AtlasNode, AtlasSearchItem } from './lib/atlas-schema';
import styles from "./atlas.module.css";

function isWorkspaceTab(value: string): value is WorkspaceTab {
  return ["ingestion", "storage", "parser", "llm", "errors", "performance", "media"].includes(value);
}

const VIEW_TABS: { value: AtlasView; label: string; icon: typeof Compass }[] = [
  { icon: Compass, label: "Directory", value: "directory" },
  { icon: Network, label: "Explore graph", value: "graph" },
];

export function IntelligenceAtlasWorkspace() {
  const currentPathname = usePathname(),
   { push, replace } = useRouter(),
   searchParams = useSearchParams(),
   searchParamsString = searchParams.toString(),
   queryClient = useQueryClient(),
   pathnameRef = useRef(currentPathname);
  pathnameRef.current = currentPathname;
  const parsedState = useMemo(
    () => parseAtlasQueryState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  ),
   [searchText, setSearchText] = useState(parsedState.q),
   [searchOpen, setSearchOpen] = useState(false),
   [activeSearchIndex, setActiveSearchIndex] = useState(0),
   [recentIds, setRecentIds] = useState<string[]>([]),
   [exporting, setExporting] = useState(false),
   searchInputRef = useRef<HTMLInputElement>(undefined),
   isGraphView = parsedState.view === "graph",

   writeState = useCallback(
    (patch: Partial<AtlasQueryState>, mode: "push" | "replace" = "push") => {
      const query = serializeAtlasQueryState({ ...parsedState, ...patch }).toString(),
       href = `${pathnameRef.current || "/wiki/ownership"}${query ? `?${query}` : ""}`;
      if (mode === "replace") {replace(href, { scroll: false });}
      else {push(href, { scroll: false });}
    },
    [parsedState, push, replace],
  );

  useEffect(() =>{  setSearchText(parsedState.q); }, [parsedState.q]);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      if (searchText !== parsedState.q) {
        writeState({ q: searchText, selected: searchText ? parsedState.selected : null }, "replace");
      }
    }, 220);
    return () =>{  globalThis.clearTimeout(timer); };
  }, [parsedState.q, parsedState.selected, searchText, writeState]);

  const graphFilters = useMemo<AtlasGraphFilters>(
    () => ({
      bias: parsedState.bias,
      country: parsedState.country,
      entity_types: parsedState.entities,
      funding: parsedState.funding,
      include_evidence_preview: true,
      layout: parsedState.layout,
      limit_edges: 1500,
      limit_nodes: 350,
      min_confidence: parsedState.minConfidence,
      neighbors: parsedState.focus ? Math.max(parsedState.neighbors, 1) : parsedState.neighbors,
      q: parsedState.q || null,
      relation_types: parsedState.relations,
      selected: parsedState.selected,
    }),
    [parsedState],
  ),

  // The graph canvas is demoted to a secondary "Explore graph" view, so its
  // (comparatively expensive) query only runs while that view is visible.
   graphQuery = useQuery({
    enabled: isGraphView,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => fetchAtlasGraph(graphFilters, signal),
    queryKey: ["atlas", "graph", graphFilters],
    retry: 1,
    staleTime: 60_000,
  }),
   statsQuery = useQuery({
    queryFn: ({ signal }) => fetchAtlasStats(signal),
    queryKey: ["atlas", "stats"],
    retry: 1,
    staleTime: 30_000,
  }),
   ingestStatusQuery = useQuery({
    queryFn: ({ signal }) => fetchAtlasIngestStatus(signal),
    queryKey: ["atlas", "ingestion-status"],
    retry: 1,
    staleTime: 30_000,
  }),
   entityQuery = useQuery({
    enabled: Boolean(parsedState.selected),
    queryFn: ({ signal }) => fetchAtlasEntity(parsedState.selected ?? "", signal),
    queryKey: ["atlas", "entity", parsedState.selected],
    retry: 1,
    staleTime: 300_000,
  }),
   searchQuery = useQuery({
    enabled: searchText.trim().length > 0 && searchOpen,
    queryFn: ({ signal }) => searchAtlas(searchText.trim(), signal),
    queryKey: ["atlas", "search", searchText.trim()],
    retry: 1,
    staleTime: 120_000,
  }),

   searchItems = useMemo(
    () => [
      ...(searchQuery.data?.outlets ?? []),
      ...(searchQuery.data?.organizations ?? []),
      ...(searchQuery.data?.people ?? []),
      ...(searchQuery.data?.reporters ?? []),
    ],
    [searchQuery.data],
  );
  useEffect(() =>{  setActiveSearchIndex(0); }, [searchText]);
  useEffect(() => {
    function handleGlobalKeyboard(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        if (searchOpen) {setSearchOpen(false);}
        else if (parsedState.panel !== "none") {writeState({ panel: "none" }, "replace");}
        else if (parsedState.focus) {writeState({ focus: false, neighbors: 0 }, "replace");}
      }
    }
    globalThis.addEventListener("keydown", handleGlobalKeyboard);
    return () =>{  globalThis.removeEventListener("keydown", handleGlobalKeyboard); };
  }, [parsedState.focus, parsedState.panel, searchOpen, writeState]);

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data?.nodes]),
   nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]),
   selectedNode = parsedState.selected ? nodesById.get(parsedState.selected) ?? null : null;
  useEffect(() => {
    if (parsedState.selected) {
      setRecentIds((current) => [parsedState.selected!, ...current.filter((id) => id !== parsedState.selected)].slice(0, 8));
    }
  }, [parsedState.selected]);
  const dockNodes = useMemo(() => {
    const result: AtlasNode[] = [],
     seen = new Set<string>(),
     recent = recentIds.map((id) => nodesById.get(id)).filter((node): node is AtlasNode => Boolean(node)),
     popular = [...nodes].sort((left, right) => right.connection_count - left.connection_count).slice(0, 8);
    for (const node of [...(selectedNode ? [selectedNode] : []), ...recent, ...popular]) {
      if (!seen.has(node.id) && result.length < 7) {
        seen.add(node.id);
        result.push(node);
      }
    }
    return result;
  }, [nodes, nodesById, recentIds, selectedNode]);

  function selectEntity(entityId: string, entityType?: AtlasEntityType) {
    const entities = entityType && !parsedState.entities.includes(entityType)
      ? [...parsedState.entities, entityType]
      : parsedState.entities;
    writeState({ entities, neighbors: 1, panel: "inspector", selected: entityId });
    setSearchOpen(false);
  }
  function chooseSearchResult(item: AtlasSearchItem) {
    setSearchText(item.label);
    const entities = parsedState.entities.includes(item.entity_type)
      ? parsedState.entities
      : [...parsedState.entities, item.entity_type];
    writeState({ entities, neighbors: 1, panel: "inspector", q: item.label, selected: item.id });
    setSearchOpen(false);
  }
  function handleSearchKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (searchItems.length > 0) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveSearchIndex((current) => (current + direction + searchItems.length) % searchItems.length);
      }
    } else if (event.key === "Enter") {
      const item = searchItems[activeSearchIndex];
      if (item) {
        event.preventDefault();
        chooseSearchResult(item);
      }
    }
  }

  /**
   * A directory row navigates straight to the entity's own profile page
   * (outlet/organization/person/reporter) rather than opening the inspector
   * dialog -- the directory is now the primary landing surface, and profile
   * pages are the destination. Entities without a `profile_path` (shouldn't
   * happen for catalog entity types, but defensively handled) fall back to
   * selecting the entity in the graph view instead of a dead click.
   */
  function openDirectoryRow(node: AtlasNode) {
    if (node.profile_path) {
      push(node.profile_path);
      return;
    }
    writeState({ entities: [node.entity_type], neighbors: 1, panel: "inspector", selected: node.id, view: "graph" });
  }

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["atlas", "graph"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "ingestion-status"] }),
      parsedState.selected
        ? queryClient.invalidateQueries({ queryKey: ["atlas", "entity", parsedState.selected] })
        : Promise.resolve(),
    ]);
  }
  async function handleExport() {
    setExporting(true);
    try {
      await exportAtlas(graphFilters);
    } finally {
      setExporting(false);
    }
  }
  function setPanel(panel: AtlasPanel) {
    writeState({ panel }, "replace");
  }

  const operationsTab: WorkspaceTab = isWorkspaceTab(parsedState.tab) ? parsedState.tab : "ingestion",
   totalStats = statsQuery.data?.stats ?? graphQuery.data?.stats,
   coverage = totalStats ? metricPercentage(totalStats.ownership_coverage) : 0,
   selectedSourceName = entityQuery.data?.entity_type === "outlet"
    ? entityQuery.data.label
    : (selectedNode?.entity_type === "outlet" ? selectedNode.label : null),
   measurementsQuery = useQuery({
    enabled: Boolean(selectedSourceName),
    queryFn: ({ signal }) => fetchMediaMeasurements(selectedSourceName ?? "", signal),
    queryKey: ["atlas", "media-measurements", selectedSourceName],
    retry: 1,
    staleTime: 300_000,
  });

  return (
    <main className={styles.atlas}>
      <div className={styles.shell}>
        <GlobalNavigation />
        <section className={styles.workspace} aria-label="SCOOP Intelligence Atlas workspace">
          <AtlasTopbar
            inputRef={searchInputRef}
            searchText={searchText}
            searchOpen={searchOpen}
            searchItems={searchItems}
            activeSearchIndex={activeSearchIndex}
            searching={searchQuery.isFetching}
            focus={parsedState.focus}
            exporting={exporting}
            refreshing={graphQuery.isFetching}
            indexing={Boolean(statsQuery.data?.indexing_active)}
            lastIndexed={statsQuery.data?.last_indexed_at}
            onSearchChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSearchText(event.target.value);
              setSearchOpen(true);
            }}
            onSearchFocus={() =>{  setSearchOpen(true); }}
            onSearchKeyDown={handleSearchKeyboard}
            onSearchHover={setActiveSearchIndex}
            onChooseSearchResult={chooseSearchResult}
            onToggleFocus={() =>{  writeState({ focus: !parsedState.focus, neighbors: parsedState.focus ? 0 : 1 }); }}
            onCopy={() => void navigator.clipboard?.writeText(globalThis.location.href)}
            onExport={() => void handleExport()}
            onRefresh={() => void refreshData()}
          />

          <nav className="flex items-center gap-2 border-b border-white/10 px-5 py-2" aria-label="Atlas view">
            {VIEW_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.value}
                  type="button"
                  className={styles.pillButton}
                  data-active={parsedState.view === tab.value}
                  aria-current={parsedState.view === tab.value ? "page" : undefined}
                  onClick={() =>{  writeState({ view: tab.value }); }}
                >
                  <Icon className="h-3.5 w-3.5" /> {tab.label}
                </button>
              );
            })}
          </nav>

          {ingestStatusQuery.data ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-2 text-xs text-[#c9c3b6]" role="status">
              <span>Evidence ingestion: {ingestStatusQuery.data.freshness}</span>
              <span>Last success: {ingestStatusQuery.data.last_success_at ? new Date(ingestStatusQuery.data.last_success_at).toLocaleString() : "never"}</span>
              {statsQuery.data ? (
                <span>
                  Researched {statsQuery.data.research_coverage.numerator.toLocaleString()} of{" "}
                  {statsQuery.data.research_coverage.denominator.toLocaleString()} entities
                </span>
              ) : null}
              {ingestStatusQuery.data.has_retryable_failures ? <span className="text-amber-300">Retryable failures need attention</span> : null}
              {ingestStatusQuery.data.missing_credentials.length > 0 ? <span className="text-amber-300">Missing credentials: {ingestStatusQuery.data.missing_credentials.join(", ")}</span> : null}
            </div>
          ) : null}

          {isGraphView ? (
            <AtlasStageShell
              state={parsedState}
              graph={graphQuery.data}
              graphVersion={graphQuery.data?.graph_version ?? "loading"}
              loading={graphQuery.isLoading}
              fetching={graphQuery.isFetching}
              error={graphQuery.error instanceof Error ? graphQuery.error : null}
              selectedNode={selectedNode}
              dockNodes={dockNodes}
              totalStats={totalStats}
              ownershipCoverage={coverage}
              onStateChange={(patch) =>{  writeState(patch); }}
              onSelect={selectEntity}
              onOpenIndex={() =>{  writeState({ view: "directory" }); }}
              onOpenOperations={() =>{  setPanel("operations"); }}
              onRetry={() => void graphQuery.refetch()}
            />
          ) : (
            <AtlasEntityList
              entityTypes={parsedState.entities}
              country={parsedState.country}
              funding={parsedState.funding}
              bias={parsedState.bias}
              onFiltersChange={(filters) =>{  writeState(filters, "replace"); }}
              onSelect={openDirectoryRow}
              variant="page"
              active={!isGraphView}
            />
          )}
        </section>
      </div>

      <Dialog open={parsedState.panel === "inspector" && Boolean(parsedState.selected)} onOpenChange={(open) =>{  setPanel(open ? "inspector" : "none"); }}>
        <DialogContent className="left-auto right-0 top-0 h-dvh w-[min(460px,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 border-white/10 bg-[#0d0f0c]/[0.98] p-0 text-[#f0ede4] shadow-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Atlas entity inspector</DialogTitle>
            <DialogDescription>Evidence and relationships for the selected Atlas entity.</DialogDescription>
          </DialogHeader>
          <AtlasInspector
            record={entityQuery.data}
            loading={entityQuery.isLoading}
            error={entityQuery.error instanceof Error ? entityQuery.error : null}
            measurements={measurementsQuery.data}
            measurementsLoading={measurementsQuery.isLoading}
            onSelectConnection={(entityId) =>{  selectEntity(entityId, nodesById.get(entityId)?.entity_type); }}
          />
        </DialogContent>
      </Dialog>
      <AtlasOperationsSheet
        open={parsedState.panel === "operations"}
        onOpenChange={(open) =>{  setPanel(open ? "operations" : "none"); }}
        activeTab={operationsTab}
        onTabChange={(tab) =>{  writeState({ panel: "operations", tab }, "replace"); }}
        selectedSourceName={selectedSourceName}
      />
    </main>
  );
}
