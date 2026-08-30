"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, KeyboardEvent, RefObject } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Compass, Network } from "lucide-react"

import type workspaceSupport from "@/app/wiki/ownership/source-intelligence-support"
import { GlobalNavigation } from "@/components/global-navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { AtlasEntityList } from "./atlas-entity-list"
import { AtlasInspector } from "./atlas-inspector"
import { AtlasOperationsSheet } from "./atlas-operations-sheet"
import { AtlasStageShell } from "./atlas-stage-shell"
import { AtlasTopbar } from "./atlas-topbar"
import {
  exportAtlas,
  fetchAtlasEntity,
  fetchAtlasGraph,
  fetchAtlasIngestStatus,
  fetchMediaMeasurements,
  fetchAtlasStats,
  searchAtlas,
} from "./lib/atlas-api"
import { parseAtlasQueryState, serializeAtlasQueryState } from "./lib/atlas-query-state"
import type { AtlasPanel, AtlasQueryState, AtlasView } from "./lib/atlas-query-state"
import { metricPercentage } from "./lib/atlas-schema"
import type {
  AtlasEntityType,
  AtlasGraphFilters,
  AtlasGraphResponse,
  AtlasNode,
  AtlasSearchItem,
} from "./lib/atlas-schema"
import styles from "./atlas.module.css"

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"]
type NavigationMode = "push" | "replace"
type WriteState = (patch: Partial<AtlasQueryState>, mode?: NavigationMode) => void
type AtlasStatsResponse = Awaited<ReturnType<typeof fetchAtlasStats>>
type AtlasIngestStatus = Awaited<ReturnType<typeof fetchAtlasIngestStatus>>
type AtlasEntityRecord = Awaited<ReturnType<typeof fetchAtlasEntity>>
type AtlasSearchResponse = Awaited<ReturnType<typeof searchAtlas>>
type AtlasMediaMeasurements = Awaited<ReturnType<typeof fetchMediaMeasurements>>

type ViewTab = Readonly<{
  icon: typeof Compass
  label: string
  value: AtlasView
}>

const SEARCH_DEBOUNCE_MS = 220
const GRAPH_STALE_MS = 60_000
const STATUS_STALE_MS = 30_000
const ENTITY_STALE_MS = 300_000
const SEARCH_STALE_MS = 120_000
const GRAPH_NODE_LIMIT = 350
const GRAPH_EDGE_LIMIT = 1500
const DOCK_LIMIT = 7
const POPULAR_NODE_LIMIT = 8
const RECENT_NODE_LIMIT = 8

const VIEW_TABS: readonly ViewTab[] = [
  { icon: Compass, label: "Directory", value: "directory" },
  { icon: Network, label: "Explore graph", value: "graph" },
]

const WORKSPACE_TABS: readonly WorkspaceTab[] = [
  "ingestion",
  "storage",
  "parser",
  "llm",
  "errors",
  "performance",
  "media",
]

const isWorkspaceTab = (value: string): value is WorkspaceTab => WORKSPACE_TABS.some((tab) => tab === value)

const resolveOperationsTab = (value: string): WorkspaceTab => (
  isWorkspaceTab(value) ? value : "ingestion"
)

const buildGraphFilters = (state: AtlasQueryState): AtlasGraphFilters => ({
  bias: state.bias,
  country: state.country,
  entity_types: state.entities,
  funding: state.funding,
  include_evidence_preview: true,
  layout: state.layout,
  limit_edges: GRAPH_EDGE_LIMIT,
  limit_nodes: GRAPH_NODE_LIMIT,
  min_confidence: state.minConfidence,
  neighbors: state.focus ? Math.max(state.neighbors, 1) : state.neighbors,
  q: state.q.length > 0 ? state.q : null,
  relation_types: state.relations,
  selected: state.selected,
})

const buildWorkspaceHref = (pathname: string, state: AtlasQueryState): string => {
  const query = serializeAtlasQueryState(state).toString()
  return query.length > 0 ? `${pathname}?${query}` : pathname
}

const flattenSearchResults = (data: AtlasSearchResponse | undefined): AtlasSearchItem[] => {
  if (data === undefined) return []
  return [...data.outlets, ...data.organizations, ...data.people, ...data.reporters]
}

const resolveSelectedNode = (
  selectedId: string | null,
  nodesById: ReadonlyMap<string, AtlasNode>,
): AtlasNode | null => {
  if (selectedId === null) return null
  return nodesById.get(selectedId) ?? null
}

const updateRecentIds = (current: readonly string[], selectedId: string): string[] => (
  [selectedId, ...current.filter((id) => id !== selectedId)].slice(0, RECENT_NODE_LIMIT)
)

const buildDockNodes = (
  nodes: readonly AtlasNode[],
  nodesById: ReadonlyMap<string, AtlasNode>,
  recentIds: readonly string[],
  selectedNode: AtlasNode | null,
): AtlasNode[] => {
  const result: AtlasNode[] = []
  const seen = new Set<string>()
  const recent = recentIds.flatMap((id) => {
    const node = nodesById.get(id)
    return node === undefined ? [] : [node]
  })
  const popular = [...nodes]
    .sort((left, right) => right.connection_count - left.connection_count)
    .slice(0, POPULAR_NODE_LIMIT)
  const selected = selectedNode === null ? [] : [selectedNode]

  for (const node of [...selected, ...recent, ...popular]) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    result.push(node)
    if (result.length >= DOCK_LIMIT) break
  }
  return result
}

const resolveTotalStats = (
  statsData: AtlasStatsResponse | undefined,
  graphData: AtlasGraphResponse | undefined,
): AtlasGraphResponse["stats"] | undefined => statsData?.stats ?? graphData?.stats

const resolveCoverage = (stats: AtlasGraphResponse["stats"] | undefined): number => (
  stats === undefined ? 0 : metricPercentage(stats.ownership_coverage)
)

const resolveSelectedSourceName = (
  entity: AtlasEntityRecord | undefined,
  selectedNode: AtlasNode | null,
): string | null => {
  if (entity?.entity_type === "outlet") return entity.label
  if (selectedNode?.entity_type === "outlet") return selectedNode.label
  return null
}

const asError = (value: unknown): Error | null => (value instanceof Error ? value : null)

const focusPatch = (state: AtlasQueryState): Partial<AtlasQueryState> => ({
  focus: !state.focus,
  neighbors: state.focus ? 0 : 1,
})

const nextSearchIndex = (current: number, direction: number, itemCount: number): number => (
  (current + direction + itemCount) % itemCount
)

const useAtlasNavigationState = () => {
  const currentPathname = usePathname()
  const { push, replace } = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const pathnameRef = useRef(currentPathname)
  pathnameRef.current = currentPathname

  const state = useMemo(
    () => parseAtlasQueryState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  )

  const writeState = useCallback<WriteState>((patch, mode = "push") => {
    const pathname = pathnameRef.current || "/wiki/ownership"
    const href = buildWorkspaceHref(pathname, { ...state, ...patch })
    if (mode === "replace") {
      replace(href, { scroll: false })
      return
    }
    push(href, { scroll: false })
  }, [push, replace, state])

  return { push, state, writeState }
}

interface SearchController {
  readonly searchText: string
  readonly searchOpen: boolean
  readonly activeSearchIndex: number
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  readonly searchItems: readonly AtlasSearchItem[]
  readonly searching: boolean
  readonly setSearchText: (value: string) => void
  readonly setSearchOpen: (value: boolean) => void
  readonly setActiveSearchIndex: (value: number) => void
  readonly chooseSearchResult: (item: AtlasSearchItem) => void
  readonly handleSearchKeyboard: (event: KeyboardEvent<HTMLInputElement>) => void
}

const useAtlasSearch = (state: AtlasQueryState, writeState: WriteState): SearchController => {
  const [searchText, setSearchText] = useState(state.q)
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setSearchText(state.q), [state.q])
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      if (searchText === state.q) return
      writeState({ q: searchText, selected: searchText.length > 0 ? state.selected : null }, "replace")
    }, SEARCH_DEBOUNCE_MS)
    return () => globalThis.clearTimeout(timer)
  }, [searchText, state.q, state.selected, writeState])

  const searchQuery = useQuery({
    enabled: searchText.trim().length > 0 && searchOpen,
    queryFn: ({ signal }) => searchAtlas(searchText.trim(), signal),
    queryKey: ["atlas", "search", searchText.trim()],
    retry: 1,
    staleTime: SEARCH_STALE_MS,
  })
  const searchItems = useMemo(() => flattenSearchResults(searchQuery.data), [searchQuery.data])

  useEffect(() => setActiveSearchIndex(0), [searchText])

  const chooseSearchResult = (item: AtlasSearchItem) => {
    setSearchText(item.label)
    const entities = state.entities.includes(item.entity_type)
      ? state.entities
      : [...state.entities, item.entity_type]
    writeState({ entities, neighbors: 1, panel: "inspector", q: item.label, selected: item.id })
    setSearchOpen(false)
  }

  const handleSearchKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (searchItems.length === 0) return
      const direction = event.key === "ArrowDown" ? 1 : -1
      setActiveSearchIndex((current) => nextSearchIndex(current, direction, searchItems.length))
      return
    }
    if (event.key !== "Enter") return
    const item = searchItems[activeSearchIndex]
    if (item === undefined) return
    event.preventDefault()
    chooseSearchResult(item)
  }

  return {
    activeSearchIndex,
    chooseSearchResult,
    handleSearchKeyboard,
    searchInputRef,
    searchItems,
    searchOpen,
    searchText,
    searching: searchQuery.isFetching,
    setActiveSearchIndex,
    setSearchOpen,
    setSearchText,
  }
}

const useAtlasGlobalKeyboard = (
  state: AtlasQueryState,
  searchOpen: boolean,
  setSearchOpen: (value: boolean) => void,
  searchInputRef: RefObject<HTMLInputElement | null>,
  writeState: WriteState,
) => {
  useEffect(() => {
    const handleGlobalKeyboard = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchInputRef.current?.focus()
        setSearchOpen(true)
        return
      }
      if (event.key !== "Escape") return
      if (searchOpen) {
        setSearchOpen(false)
        return
      }
      if (state.panel !== "none") {
        writeState({ panel: "none" }, "replace")
        return
      }
      if (state.focus) writeState({ focus: false, neighbors: 0 }, "replace")
    }

    globalThis.addEventListener("keydown", handleGlobalKeyboard)
    return () => globalThis.removeEventListener("keydown", handleGlobalKeyboard)
  }, [searchInputRef, searchOpen, setSearchOpen, state.focus, state.panel, writeState])
}

const useAtlasData = (state: AtlasQueryState) => {
  const graphFilters = useMemo(() => buildGraphFilters(state), [state])
  const isGraphView = state.view === "graph"

  const graphQuery = useQuery({
    enabled: isGraphView,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => fetchAtlasGraph(graphFilters, signal),
    queryKey: ["atlas", "graph", graphFilters],
    retry: 1,
    staleTime: GRAPH_STALE_MS,
  })
  const statsQuery = useQuery({
    queryFn: ({ signal }) => fetchAtlasStats(signal),
    queryKey: ["atlas", "stats"],
    retry: 1,
    staleTime: STATUS_STALE_MS,
  })
  const ingestStatusQuery = useQuery({
    queryFn: ({ signal }) => fetchAtlasIngestStatus(signal),
    queryKey: ["atlas", "ingestion-status"],
    retry: 1,
    staleTime: STATUS_STALE_MS,
  })
  const entityQuery = useQuery({
    enabled: state.selected !== null,
    queryFn: ({ signal }) => fetchAtlasEntity(state.selected ?? "", signal),
    queryKey: ["atlas", "entity", state.selected],
    retry: 1,
    staleTime: ENTITY_STALE_MS,
  })

  const nodes = graphQuery.data?.nodes ?? []
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selectedNode = resolveSelectedNode(state.selected, nodesById)
  const totalStats = resolveTotalStats(statsQuery.data, graphQuery.data)
  const selectedSourceName = resolveSelectedSourceName(entityQuery.data, selectedNode)

  const measurementsQuery = useQuery({
    enabled: selectedSourceName !== null,
    queryFn: ({ signal }) => fetchMediaMeasurements(selectedSourceName ?? "", signal),
    queryKey: ["atlas", "media-measurements", selectedSourceName],
    retry: 1,
    staleTime: ENTITY_STALE_MS,
  })

  return {
    entityQuery,
    graphFilters,
    graphQuery,
    ingestStatusQuery,
    isGraphView,
    measurementsQuery,
    nodes,
    nodesById,
    selectedNode,
    selectedSourceName,
    statsQuery,
    totalStats,
  }
}

const useDockNodes = (
  selectedId: string | null,
  nodes: readonly AtlasNode[],
  nodesById: ReadonlyMap<string, AtlasNode>,
  selectedNode: AtlasNode | null,
): AtlasNode[] => {
  const [recentIds, setRecentIds] = useState<string[]>([])
  useEffect(() => {
    if (selectedId === null) return
    setRecentIds((current) => updateRecentIds(current, selectedId))
  }, [selectedId])
  return useMemo(
    () => buildDockNodes(nodes, nodesById, recentIds, selectedNode),
    [nodes, nodesById, recentIds, selectedNode],
  )
}

interface ViewTabsProps {
  readonly view: AtlasView
  readonly onChange: (view: AtlasView) => void
}

const ViewTabs = ({ view, onChange }: ViewTabsProps) => (
  <nav className="flex items-center gap-2 border-b border-white/10 px-5 py-2" aria-label="Atlas view">
    {VIEW_TABS.map((tab) => {
      const Icon = tab.icon
      return (
        <button
          key={tab.value}
          type="button"
          className={styles.pillButton}
          data-active={view === tab.value}
          aria-current={view === tab.value ? "page" : undefined}
          onClick={() => onChange(tab.value)}
        >
          <Icon className="h-3.5 w-3.5" /> {tab.label}
        </button>
      )
    })}
  </nav>
)

interface IngestStatusBarProps {
  readonly status: AtlasIngestStatus | undefined
  readonly stats: AtlasStatsResponse | undefined
}

const IngestStatusBar = ({ status, stats }: IngestStatusBarProps) => {
  if (status === undefined) return undefined
  const lastSuccess = status.last_success_at === null || status.last_success_at === undefined
    ? "never"
    : new Date(status.last_success_at).toLocaleString()

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-2 text-xs text-[#c9c3b6]" role="status">
      <span>Evidence ingestion: {status.freshness}</span>
      <span>Last success: {lastSuccess}</span>
      {stats !== undefined && (
        <span>
          Researched {stats.research_coverage.numerator.toLocaleString()} of{" "}
          {stats.research_coverage.denominator.toLocaleString()} entities
        </span>
      )}
      {status.has_retryable_failures && <span className="text-amber-300">Retryable failures need attention</span>}
      {status.missing_credentials.length > 0 && (
        <span className="text-amber-300">Missing credentials: {status.missing_credentials.join(", ")}</span>
      )}
    </div>
  )
}

interface WorkspaceSurfaceProps {
  readonly state: AtlasQueryState
  readonly graph: AtlasGraphResponse | undefined
  readonly graphLoading: boolean
  readonly graphFetching: boolean
  readonly graphError: Error | null
  readonly selectedNode: AtlasNode | null
  readonly dockNodes: readonly AtlasNode[]
  readonly totalStats: AtlasGraphResponse["stats"] | undefined
  readonly ownershipCoverage: number
  readonly onStateChange: WriteState
  readonly onSelect: (nodeId: string, entityType?: AtlasEntityType) => void
  readonly onOpenOperations: () => void
  readonly onRetry: () => void
  readonly onDirectorySelect: (node: AtlasNode) => void
}

const WorkspaceSurface = ({
  state,
  graph,
  graphLoading,
  graphFetching,
  graphError,
  selectedNode,
  dockNodes,
  totalStats,
  ownershipCoverage,
  onStateChange,
  onSelect,
  onOpenOperations,
  onRetry,
  onDirectorySelect,
}: WorkspaceSurfaceProps) => {
  if (state.view === "graph") {
    return (
      <AtlasStageShell
        state={state}
        graph={graph}
        graphVersion={graph?.graph_version ?? "loading"}
        loading={graphLoading}
        fetching={graphFetching}
        error={graphError}
        selectedNode={selectedNode}
        dockNodes={dockNodes}
        totalStats={totalStats}
        ownershipCoverage={ownershipCoverage}
        onStateChange={(patch) => onStateChange(patch)}
        onSelect={onSelect}
        onOpenIndex={() => onStateChange({ view: "directory" })}
        onOpenOperations={onOpenOperations}
        onRetry={onRetry}
      />
    )
  }

  return (
    <AtlasEntityList
      entityTypes={state.entities}
      country={state.country}
      funding={state.funding}
      bias={state.bias}
      onFiltersChange={(filters) => onStateChange(filters, "replace")}
      onSelect={onDirectorySelect}
      variant="page"
      active
    />
  )
}

interface InspectorDialogProps {
  readonly state: AtlasQueryState
  readonly record: AtlasEntityRecord | undefined
  readonly loading: boolean
  readonly error: Error | null
  readonly measurements: AtlasMediaMeasurements | undefined
  readonly measurementsLoading: boolean
  readonly nodesById: ReadonlyMap<string, AtlasNode>
  readonly onPanelChange: (panel: AtlasPanel) => void
  readonly onSelect: (entityId: string, entityType?: AtlasEntityType) => void
}

const InspectorDialog = ({
  state,
  record,
  loading,
  error,
  measurements,
  measurementsLoading,
  nodesById,
  onPanelChange,
  onSelect,
}: InspectorDialogProps) => {
  const open = state.panel === "inspector" && state.selected !== null
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => onPanelChange(nextOpen ? "inspector" : "none")}>
      <DialogContent className="left-auto right-0 top-0 h-dvh w-[min(460px,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 border-white/10 bg-[#0d0f0c]/[0.98] p-0 text-[#f0ede4] shadow-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Atlas entity inspector</DialogTitle>
          <DialogDescription>Evidence and relationships for the selected Atlas entity.</DialogDescription>
        </DialogHeader>
        <AtlasInspector
          record={record}
          loading={loading}
          error={error}
          measurements={measurements}
          measurementsLoading={measurementsLoading}
          onSelectConnection={(entityId) => onSelect(entityId, nodesById.get(entityId)?.entity_type)}
        />
      </DialogContent>
    </Dialog>
  )
}

export const IntelligenceAtlasWorkspace = () => {
  const { push, state, writeState } = useAtlasNavigationState()
  const queryClient = useQueryClient()
  const [exporting, setExporting] = useState(false)
  const search = useAtlasSearch(state, writeState)
  useAtlasGlobalKeyboard(state, search.searchOpen, search.setSearchOpen, search.searchInputRef, writeState)

  const atlas = useAtlasData(state)
  const dockNodes = useDockNodes(state.selected, atlas.nodes, atlas.nodesById, atlas.selectedNode)
  const ownershipCoverage = resolveCoverage(atlas.totalStats)
  const operationsTab = resolveOperationsTab(state.tab)

  const selectEntity = (entityId: string, entityType?: AtlasEntityType) => {
    const entities = entityType !== undefined && !state.entities.includes(entityType)
      ? [...state.entities, entityType]
      : state.entities
    writeState({ entities, neighbors: 1, panel: "inspector", selected: entityId })
    search.setSearchOpen(false)
  }

  const openDirectoryRow = (node: AtlasNode) => {
    if (node.profile_path !== null && node.profile_path !== undefined && node.profile_path.length > 0) {
      push(node.profile_path)
      return
    }
    writeState({
      entities: [node.entity_type],
      neighbors: 1,
      panel: "inspector",
      selected: node.id,
      view: "graph",
    })
  }

  const refreshData = async () => {
    const requests = [
      queryClient.invalidateQueries({ queryKey: ["atlas", "graph"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "ingestion-status"] }),
    ]
    if (state.selected !== null) {
      requests.push(queryClient.invalidateQueries({ queryKey: ["atlas", "entity", state.selected] }))
    }
    await Promise.all(requests)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportAtlas(atlas.graphFilters)
    } finally {
      setExporting(false)
    }
  }

  const setPanel = (panel: AtlasPanel) => writeState({ panel }, "replace")
  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    search.setSearchText(event.target.value)
    search.setSearchOpen(true)
  }

  return (
    <main className={styles.atlas}>
      <div className={styles.shell}>
        <GlobalNavigation />
        <section className={styles.workspace} aria-label="SCOOP Intelligence Atlas workspace">
          <AtlasTopbar
            inputRef={search.searchInputRef}
            searchText={search.searchText}
            searchOpen={search.searchOpen}
            searchItems={search.searchItems}
            activeSearchIndex={search.activeSearchIndex}
            searching={search.searching}
            focus={state.focus}
            exporting={exporting}
            refreshing={atlas.graphQuery.isFetching}
            indexing={atlas.statsQuery.data?.indexing_active === true}
            lastIndexed={atlas.statsQuery.data?.last_indexed_at}
            onSearchChange={handleSearchChange}
            onSearchFocus={() => search.setSearchOpen(true)}
            onSearchKeyDown={search.handleSearchKeyboard}
            onSearchHover={search.setActiveSearchIndex}
            onChooseSearchResult={search.chooseSearchResult}
            onToggleFocus={() => writeState(focusPatch(state))}
            onCopy={() => void navigator.clipboard?.writeText(globalThis.location.href)}
            onExport={() => void handleExport()}
            onRefresh={() => void refreshData()}
          />
          <ViewTabs view={state.view} onChange={(view) => writeState({ view })} />
          <IngestStatusBar status={atlas.ingestStatusQuery.data} stats={atlas.statsQuery.data} />
          <WorkspaceSurface
            state={state}
            graph={atlas.graphQuery.data}
            graphLoading={atlas.graphQuery.isLoading}
            graphFetching={atlas.graphQuery.isFetching}
            graphError={asError(atlas.graphQuery.error)}
            selectedNode={atlas.selectedNode}
            dockNodes={dockNodes}
            totalStats={atlas.totalStats}
            ownershipCoverage={ownershipCoverage}
            onStateChange={writeState}
            onSelect={selectEntity}
            onOpenOperations={() => setPanel("operations")}
            onRetry={() => void atlas.graphQuery.refetch()}
            onDirectorySelect={openDirectoryRow}
          />
        </section>
      </div>
      <InspectorDialog
        state={state}
        record={atlas.entityQuery.data}
        loading={atlas.entityQuery.isLoading}
        error={asError(atlas.entityQuery.error)}
        measurements={atlas.measurementsQuery.data}
        measurementsLoading={atlas.measurementsQuery.isLoading}
        nodesById={atlas.nodesById}
        onPanelChange={setPanel}
        onSelect={selectEntity}
      />
      <AtlasOperationsSheet
        open={state.panel === "operations"}
        onOpenChange={(open) => setPanel(open ? "operations" : "none")}
        activeTab={operationsTab}
        onTabChange={(tab) => writeState({ panel: "operations", tab }, "replace")}
        selectedSourceName={atlas.selectedSourceName}
      />
    </main>
  )
}
