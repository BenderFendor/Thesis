"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { WorkspaceTab } from "@/app/wiki/ownership/source-intelligence-support";
import { GlobalNavigation } from "@/components/global-navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AtlasIndexSheet } from "./atlas-index-sheet";
import { AtlasInspector } from "./atlas-inspector";
import { AtlasOperationsSheet } from "./atlas-operations-sheet";
import { AtlasStageShell } from "./atlas-stage-shell";
import { AtlasTopbar } from "./atlas-topbar";
import {
  exportAtlas,
  fetchAtlasEntity,
  fetchAtlasGraph,
  fetchAtlasStats,
  searchAtlas,
} from "./lib/atlas-api";
import {
  parseAtlasQueryState,
  serializeAtlasQueryState,
  type AtlasPanel,
  type AtlasQueryState,
} from "./lib/atlas-query-state";
import {
  metricPercentage,
  type AtlasEntityType,
  type AtlasGraphFilters,
  type AtlasNode,
  type AtlasSearchItem,
} from "./lib/atlas-schema";
import styles from "./atlas.module.css";

function isWorkspaceTab(value: string): value is WorkspaceTab {
  return ["ingestion", "storage", "parser", "llm", "errors", "performance", "media"].includes(value);
}

export function IntelligenceAtlasWorkspace() {
  const currentPathname = usePathname();
  const { push, replace } = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const queryClient = useQueryClient();
  const pathnameRef = useRef(currentPathname);
  pathnameRef.current = currentPathname;
  const parsedState = useMemo(
    () => parseAtlasQueryState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
  const [searchText, setSearchText] = useState(parsedState.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const writeState = useCallback(
    (patch: Partial<AtlasQueryState>, mode: "push" | "replace" = "push") => {
      const query = serializeAtlasQueryState({ ...parsedState, ...patch }).toString();
      const href = `${pathnameRef.current || "/wiki/ownership"}${query ? `?${query}` : ""}`;
      if (mode === "replace") replace(href, { scroll: false });
      else push(href, { scroll: false });
    },
    [parsedState, push, replace],
  );

  useEffect(() => setSearchText(parsedState.q), [parsedState.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchText !== parsedState.q) {
        writeState({ q: searchText, selected: searchText ? parsedState.selected : null }, "replace");
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [parsedState.q, parsedState.selected, searchText, writeState]);

  const graphFilters = useMemo<AtlasGraphFilters>(
    () => ({
      q: parsedState.q || null,
      entity_types: parsedState.entities,
      relation_types: parsedState.relations,
      country: parsedState.country,
      funding: parsedState.funding,
      bias: parsedState.bias,
      min_confidence: parsedState.minConfidence,
      selected: parsedState.selected,
      neighbors: parsedState.focus ? Math.max(parsedState.neighbors, 1) : parsedState.neighbors,
      layout: parsedState.layout,
      limit_nodes: 350,
      limit_edges: 1500,
      include_evidence_preview: true,
    }),
    [parsedState],
  );

  const graphQuery = useQuery({
    queryKey: ["atlas", "graph", graphFilters],
    queryFn: ({ signal }) => fetchAtlasGraph(graphFilters, signal),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    retry: 1,
  });
  const statsQuery = useQuery({
    queryKey: ["atlas", "stats"],
    queryFn: ({ signal }) => fetchAtlasStats(signal),
    staleTime: 30_000,
    retry: 1,
  });
  const entityQuery = useQuery({
    queryKey: ["atlas", "entity", parsedState.selected],
    queryFn: ({ signal }) => fetchAtlasEntity(parsedState.selected ?? "", signal),
    enabled: Boolean(parsedState.selected),
    staleTime: 300_000,
    retry: 1,
  });
  const searchQuery = useQuery({
    queryKey: ["atlas", "search", searchText.trim()],
    queryFn: ({ signal }) => searchAtlas(searchText.trim(), signal),
    enabled: searchText.trim().length > 0 && searchOpen,
    staleTime: 120_000,
    retry: 1,
  });

  const searchItems = useMemo(
    () => [
      ...(searchQuery.data?.sources ?? []),
      ...(searchQuery.data?.organizations ?? []),
      ...(searchQuery.data?.reporters ?? []),
    ],
    [searchQuery.data],
  );
  useEffect(() => setActiveSearchIndex(0), [searchText]);
  useEffect(() => {
    function handleGlobalKeyboard(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        else if (parsedState.panel !== "none") writeState({ panel: "none" }, "replace");
        else if (parsedState.focus) writeState({ focus: false, neighbors: 0 }, "replace");
      }
    }
    window.addEventListener("keydown", handleGlobalKeyboard);
    return () => window.removeEventListener("keydown", handleGlobalKeyboard);
  }, [parsedState.focus, parsedState.panel, searchOpen, writeState]);

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data?.nodes]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = parsedState.selected ? nodesById.get(parsedState.selected) ?? null : null;
  useEffect(() => {
    if (parsedState.selected) {
      setRecentIds((current) => [parsedState.selected!, ...current.filter((id) => id !== parsedState.selected)].slice(0, 8));
    }
  }, [parsedState.selected]);
  const dockNodes = useMemo(() => {
    const result: AtlasNode[] = [];
    const seen = new Set<string>();
    const recent = recentIds.map((id) => nodesById.get(id)).filter((node): node is AtlasNode => Boolean(node));
    const popular = [...nodes].sort((left, right) => right.connection_count - left.connection_count).slice(0, 8);
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
    writeState({ selected: entityId, entities, neighbors: 1, panel: "inspector" });
    setSearchOpen(false);
  }
  function chooseSearchResult(item: AtlasSearchItem) {
    setSearchText(item.label);
    const entities = parsedState.entities.includes(item.entity_type)
      ? parsedState.entities
      : [...parsedState.entities, item.entity_type];
    writeState({ q: item.label, selected: item.id, entities, neighbors: 1, panel: "inspector" });
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

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["atlas", "graph"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "stats"] }),
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

  const operationsTab: WorkspaceTab = isWorkspaceTab(parsedState.tab) ? parsedState.tab : "ingestion";
  const totalStats = statsQuery.data?.stats ?? graphQuery.data?.stats;
  const coverage = totalStats ? metricPercentage(totalStats.ownership_coverage) : 0;
  const selectedSourceName = entityQuery.data?.entity_type === "source"
    ? entityQuery.data.label
    : selectedNode?.entity_type === "source" ? selectedNode.label : null;

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
            onSearchFocus={() => setSearchOpen(true)}
            onSearchKeyDown={handleSearchKeyboard}
            onSearchHover={setActiveSearchIndex}
            onChooseSearchResult={chooseSearchResult}
            onToggleFocus={() => writeState({ focus: !parsedState.focus, neighbors: parsedState.focus ? 0 : 1 })}
            onCopy={() => void navigator.clipboard?.writeText(window.location.href)}
            onExport={() => void handleExport()}
            onRefresh={() => void refreshData()}
          />
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
            onStateChange={(patch) => writeState(patch)}
            onSelect={selectEntity}
            onOpenIndex={() => setPanel("index")}
            onOpenOperations={() => setPanel("operations")}
            onRetry={() => void graphQuery.refetch()}
          />
        </section>
      </div>

      <Dialog open={parsedState.panel === "inspector" && Boolean(parsedState.selected)} onOpenChange={(open) => setPanel(open ? "inspector" : "none")}>
        <DialogContent className="left-auto right-0 top-0 h-dvh w-[min(460px,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 border-white/10 bg-[#0d0f0c]/[0.98] p-0 text-[#f0ede4] shadow-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Atlas entity inspector</DialogTitle>
            <DialogDescription>Evidence and relationships for the selected Atlas entity.</DialogDescription>
          </DialogHeader>
          <AtlasInspector
            record={entityQuery.data}
            loading={entityQuery.isLoading}
            error={entityQuery.error instanceof Error ? entityQuery.error : null}
            onSelectConnection={(entityId) => selectEntity(entityId, nodesById.get(entityId)?.entity_type)}
          />
        </DialogContent>
      </Dialog>
      <AtlasIndexSheet
        open={parsedState.panel === "index"}
        onOpenChange={(open) => setPanel(open ? "index" : "none")}
        entityTypes={parsedState.entities}
        country={parsedState.country}
        funding={parsedState.funding}
        bias={parsedState.bias}
        onSelect={(entityId) => selectEntity(entityId, nodesById.get(entityId)?.entity_type)}
      />
      <AtlasOperationsSheet
        open={parsedState.panel === "operations"}
        onOpenChange={(open) => setPanel(open ? "operations" : "none")}
        activeTab={operationsTab}
        onTabChange={(tab) => writeState({ panel: "operations", tab }, "replace")}
        selectedSourceName={selectedSourceName}
      />
    </main>
  );
}
