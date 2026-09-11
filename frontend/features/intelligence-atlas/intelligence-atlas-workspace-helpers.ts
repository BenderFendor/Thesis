import { Compass, Network } from "lucide-react";
import { formatArticleDateTime } from "@/lib/date-formatters";
import type {
  AtlasEntityType,
  AtlasGraphFilters,
  AtlasGraphResponse,
  AtlasNode,
  AtlasSearchItem,
} from "./lib/atlas-schema";
import { metricPercentage } from "./lib/atlas-schema";
import type { AtlasQueryState, AtlasView, ReadonlyAtlasQueryState } from "./lib/atlas-query-state";
import { serializeAtlasQueryState } from "./lib/atlas-query-state";
import type {
  fetchAtlasEntity,
  fetchAtlasIngestStatus,
  fetchAtlasStats,
  fetchMediaMeasurements,
  searchAtlas,
} from "./lib/atlas-api";
import type workspaceSupport from "@/app/wiki/ownership/source-intelligence-support";
import type { DeepReadonly } from "@/lib/deep-readonly";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];
type NavigationMode = "push" | "replace";
type WriteState = (
  patch: Readonly<Partial<ReadonlyAtlasQueryState>>,
  mode?: NavigationMode,
) => void;
type AtlasStatsResponse = Awaited<ReturnType<typeof fetchAtlasStats>>;
type AtlasIngestStatus = Awaited<ReturnType<typeof fetchAtlasIngestStatus>>;
type AtlasEntityRecord = Awaited<ReturnType<typeof fetchAtlasEntity>>;
type AtlasSearchResponse = Awaited<ReturnType<typeof searchAtlas>>;
type AtlasMediaMeasurements = DeepReadonly<Awaited<ReturnType<typeof fetchMediaMeasurements>>>;
type DirectoryFilterPatch = Readonly<{
  bias?: readonly string[];
  country?: readonly string[];
  funding?: readonly string[];
}>;

interface AtlasNavigationRouter {
  readonly push: (href: string, options?: { readonly scroll?: boolean }) => void;
  readonly replace: (href: string, options?: { readonly scroll?: boolean }) => void;
}

interface AtlasFocusableInput {
  readonly focus: () => void;
}

interface AtlasInputRef<TInput extends AtlasFocusableInput = AtlasFocusableInput> {
  readonly current: TInput | null;
}

interface AtlasGlobalKeyboardEvent {
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly preventDefault: () => void;
}

type ViewTab = Readonly<{
  icon: typeof Compass;
  label: string;
  value: AtlasView;
}>;

const appendDockNode = (result: readonly AtlasNode[], node: AtlasNode): readonly AtlasNode[] => {
  if (result.length >= DOCK_LIMIT || result.some((candidate) => candidate.id === node.id)) {
    return result;
  }
  return [...result, node];
};

const resolveGraphNeighbors = (state: ReadonlyAtlasQueryState): number => {
  if (state.focus) {
    return Math.max(state.neighbors, 1);
  }
  return state.neighbors;
};

const resolveGraphQuery = (query: string): string | null => {
  if (query.length > 0) {
    return query;
  }
  return null;
};

const resolveFocusNeighbors = (focused: boolean): 0 | 1 => {
  if (focused) {
    return 0;
  }
  return 1;
};

const DOCK_LIMIT = 7,
  EMPTY_NODES: readonly AtlasNode[] = [],
  ENTITY_STALE_MS = 300_000,
  GRAPH_EDGE_LIMIT = 1500,
  GRAPH_NODE_LIMIT = 350,
  GRAPH_STALE_MS = 60_000,
  POPULAR_NODE_LIMIT = 8,
  RECENT_NODE_LIMIT = 8,
  SEARCH_DEBOUNCE_MS = 220,
  SEARCH_STALE_MS = 120_000,
  STATUS_STALE_MS = 30_000,
  VIEW_TABS: readonly ViewTab[] = [
    { icon: Compass, label: "Directory", value: "directory" },
    { icon: Network, label: "Explore graph", value: "graph" },
  ],
  WORKSPACE_TABS: readonly WorkspaceTab[] = [
    "ingestion",
    "storage",
    "parser",
    "llm",
    "errors",
    "performance",
    "media",
  ],
  asError = (value: Error | null | undefined): Error | null => value ?? null,
  buildDockNodes = (
    nodes: readonly AtlasNode[],
    nodesById: ReadonlyMap<string, AtlasNode>,
    recentIds: readonly string[],
    selectedNode: AtlasNode | null,
  ): readonly AtlasNode[] => {
    const recent = recentIds.flatMap((recentId) => {
      const node = nodesById.get(recentId);
      if (node === undefined) {
        return [];
      }
      return [node];
    });
    const popular = nodes
      .toSorted((left, right) => right.connection_count - left.connection_count)
      .slice(0, POPULAR_NODE_LIMIT);
    const selected: AtlasNode[] = [];
    if (selectedNode !== null) {
      selected.push(selectedNode);
    }
    const candidates = [...selected, ...recent, ...popular];
    return candidates.reduce<readonly AtlasNode[]>(
      (current, node) => appendDockNode(current, node),
      [],
    );
  },
  buildGraphFilters = (state: ReadonlyAtlasQueryState): AtlasGraphFilters => ({
    bias: state.bias,
    country: state.country,
    entity_types: state.entities,
    funding: state.funding,
    include_evidence_preview: true,
    layout: state.layout,
    limit_edges: GRAPH_EDGE_LIMIT,
    limit_nodes: GRAPH_NODE_LIMIT,
    min_confidence: state.minConfidence,
    neighbors: resolveGraphNeighbors(state),
    [ATLAS_QUERY_KEY]: resolveGraphQuery(state.q),
    relation_types: state.relations,
    selected: state.selected,
  }),
  buildWorkspaceHref = (pathname: string, state: ReadonlyAtlasQueryState): string => {
    const query = serializeAtlasQueryState(state).toString();
    if (query.length > 0) {
      return `${pathname}?${query}`;
    }
    return pathname;
  },
  flattenSearchResults = (data: AtlasSearchResponse | undefined): AtlasSearchItem[] => {
    if (data === undefined) {
      return [];
    }
    return [...data.outlets, ...data.organizations, ...data.people, ...data.reporters];
  },
  focusPatch = (state: ReadonlyAtlasQueryState): Partial<AtlasQueryState> => ({
    focus: !state.focus,
    neighbors: resolveFocusNeighbors(state.focus),
  }),
  isWorkspaceTab = (value: string): value is WorkspaceTab =>
    WORKSPACE_TABS.some((tab) => tab === value),
  nextSearchIndex = (current: number, direction: number, itemCount: number): number =>
    (current + direction + itemCount) % itemCount,
  resolveCoverage = (stats: AtlasGraphResponse["stats"] | undefined): number => {
    if (stats === undefined) {
      return 0;
    }
    return metricPercentage(stats.ownership_coverage);
  },
  resolveOperationsTab = (value: string): WorkspaceTab => {
    if (isWorkspaceTab(value)) {
      return value;
    }
    return "ingestion";
  },
  resolveSelectedNode = (
    selectedId: string | null,
    nodesById: ReadonlyMap<string, AtlasNode>,
  ): AtlasNode | null => {
    if (selectedId === null) {
      return null;
    }
    return nodesById.get(selectedId) ?? null;
  },
  resolveSelectedSourceName = (
    entity: AtlasEntityRecord | undefined,
    selectedNode: AtlasNode | null,
  ): string | null => {
    if (entity?.entity_type === "outlet") {
      return entity.label;
    }
    if (selectedNode?.entity_type === "outlet") {
      return selectedNode.label;
    }
    return null;
  },
  resolveTotalStats = (
    statsData: AtlasStatsResponse | undefined,
    graphData: AtlasGraphResponse | undefined,
  ): AtlasGraphResponse["stats"] | undefined => statsData?.stats ?? graphData?.stats,
  updateRecentIds = (current: readonly string[], selectedId: string): string[] =>
    [selectedId, ...current.filter((candidateId) => candidateId !== selectedId)].slice(
      0,
      RECENT_NODE_LIMIT,
    );

const ATLAS_QUERY_KEY = "q" as const;

const ensureEntityType = (
  entities: readonly AtlasEntityType[],
  entityType: AtlasEntityType | undefined,
): readonly AtlasEntityType[] => {
  if (entityType === undefined || entities.includes(entityType)) {
    return entities;
  }
  return [...entities, entityType];
};

const formatAtlasLastSuccess = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return "never";
  }
  return formatArticleDateTime(value);
};

export {
  ATLAS_QUERY_KEY,
  EMPTY_NODES,
  ENTITY_STALE_MS,
  GRAPH_STALE_MS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_STALE_MS,
  STATUS_STALE_MS,
  VIEW_TABS,
  asError,
  buildDockNodes,
  buildGraphFilters,
  buildWorkspaceHref,
  ensureEntityType,
  flattenSearchResults,
  focusPatch,
  formatAtlasLastSuccess,
  nextSearchIndex,
  resolveCoverage,
  resolveOperationsTab,
  resolveSelectedNode,
  resolveSelectedSourceName,
  resolveTotalStats,
  updateRecentIds,
  type AtlasEntityRecord,
  type AtlasGlobalKeyboardEvent,
  type AtlasIngestStatus,
  type AtlasInputRef,
  type AtlasMediaMeasurements,
  type AtlasNavigationRouter,
  type AtlasSearchResponse,
  type AtlasStatsResponse,
  type DirectoryFilterPatch,
  type WorkspaceTab,
  type WriteState,
};
