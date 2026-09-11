import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData, InfiniteQueryObserverResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAtlasIndex } from "./lib/atlas-api";
import type { AtlasEntityType, AtlasIndexResponse, AtlasNode } from "./lib/atlas-schema";

type EntityTypeTab = "all" | AtlasEntityType;

interface AtlasEntityListStateOptions {
  readonly active: boolean;
  readonly bias: readonly string[];
  readonly country: readonly string[];
  readonly entityTypes: readonly AtlasEntityType[];
  readonly funding: readonly string[];
}

interface AtlasEntityListState {
  readonly biasOptions: readonly string[];
  readonly changeKind: (value: string) => void;
  readonly changeType: (value: EntityTypeTab) => void;
  readonly clearKinds: () => void;
  readonly countryOptions: readonly string[];
  readonly error: Error | null;
  readonly fundingOptions: readonly string[];
  readonly isFetchingNextPage: boolean;
  readonly isLoading: boolean;
  readonly items: readonly AtlasNode[];
  readonly kind: readonly string[];
  readonly kindOptions: readonly string[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly setSort: (value: string) => void;
  readonly sort: string;
  readonly total: number;
  readonly totalSize: number;
  readonly type: EntityTypeTab;
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[];
  readonly viewportRef: Readonly<{ current: HTMLDivElement | null }>;
}

interface EntityListFilters {
  readonly effectiveTypes: readonly AtlasEntityType[];
  readonly kind: readonly string[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly setSort: (value: string) => void;
  readonly sort: string;
  readonly type: EntityTypeTab;
  readonly changeKind: (value: string) => void;
  readonly changeType: (value: EntityTypeTab) => void;
  readonly clearKinds: () => void;
}

interface EntityListQueryOptions {
  readonly active: boolean;
  readonly bias: readonly string[];
  readonly country: readonly string[];
  readonly effectiveTypes: readonly AtlasEntityType[];
  readonly funding: readonly string[];
  readonly kind: readonly string[];
  readonly query: string;
  readonly sort: string;
}

interface EntityListQueryState {
  readonly biasOptions: readonly string[];
  readonly countryOptions: readonly string[];
  readonly error: Error | null;
  readonly fundingOptions: readonly string[];
  readonly hasNextPage: boolean | undefined;
  readonly isFetchingNextPage: boolean;
  readonly isLoading: boolean;
  readonly items: readonly AtlasNode[];
  readonly kindOptions: readonly string[];
  readonly total: number;
  readonly fetchNextPage: () => AtlasIndexFetchResult;
}

interface EntityListViewportOptions {
  readonly active: boolean;
  readonly fetchNextPage: () => AtlasIndexFetchResult;
  readonly hasNextPage: boolean | undefined;
  readonly isFetchingNextPage: boolean;
  readonly items: readonly AtlasNode[];
}

interface EntityListViewportState {
  readonly totalSize: number;
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[];
  readonly viewportRef: Readonly<{ current: HTMLDivElement | null }>;
}

type AtlasIndexFetchResult = Promise<
  InfiniteQueryObserverResult<InfiniteData<AtlasIndexResponse, string | null>>
>;

const INITIAL_CURSOR: string | null = null,
  LOAD_AHEAD_ROWS = 8,
  PAGE_SIZE = 80,
  ROW_ESTIMATE = 66,
  SEARCH_QUERY_KEY = "q",
  TYPE_TABS: readonly Readonly<{ key: EntityTypeTab; label: string; types: readonly AtlasEntityType[] }>[] = [
    { key: "all", label: "All", types: [] },
    { key: "outlet", label: "Outlets", types: ["outlet"] },
    { key: "organization", label: "Organizations", types: ["organization"] },
    { key: "person", label: "People", types: ["person", "reporter"] },
    { key: "reporter", label: "Reporters", types: ["reporter"] },
  ],
  VIRTUAL_OVERSCAN = 8;

const effectiveEntityTypes = (
  type: EntityTypeTab,
  entityTypes: readonly AtlasEntityType[],
): readonly AtlasEntityType[] => {
  if (type === "all") {
    return entityTypes;
  }
  return TYPE_TABS.find((tab) => tab.key === type)?.types ?? [];
};

const toggleString = (values: readonly string[], value: string): string[] => {
  if (values.includes(value)) {
    return values.filter((item) => item !== value);
  }
  return [...values, value];
};

const useEntityListFilters = (entityTypes: readonly AtlasEntityType[]): EntityListFilters => {
  const [type, setType] = useState<EntityTypeTab>("all");
  const [kind, setKind] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("most_connected");
  const changeKind = useCallback((value: string) => {
    setKind((current) => toggleString(current, value));
  }, []);
  const changeType = useCallback((nextType: EntityTypeTab) => {
    setType(nextType);
    setKind([]);
  }, []);
  const clearKinds = useCallback(() => {
    setKind([]);
  }, []);
  return {
    changeKind,
    changeType,
    clearKinds,
    effectiveTypes: effectiveEntityTypes(type, entityTypes),
    kind,
    query,
    setQuery,
    setSort,
    sort,
    type,
  };
};

const useAtlasIndexQuery = ({
  active,
  bias,
  country,
  effectiveTypes,
  funding,
  kind,
  query,
  sort,
}: EntityListQueryOptions) =>
  useInfiniteQuery<
    AtlasIndexResponse,
    Error,
    InfiniteData<AtlasIndexResponse, string | null>,
    readonly unknown[],
    string | null
  >({
    enabled: active,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    initialPageParam: INITIAL_CURSOR,
    queryFn: ({ pageParam, signal }) =>
      fetchAtlasIndex(
        {
          bias: [...bias],
          country: [...country],
          cursor: pageParam,
          entityTypes: [...effectiveTypes],
          funding: [...funding],
          kind: [...kind],
          limit: PAGE_SIZE,
          [SEARCH_QUERY_KEY]: query || undefined,
          sort,
        },
        signal,
      ),
    queryKey: ["atlas", "index", effectiveTypes, query, country, funding, bias, kind, sort],
    staleTime: 60_000,
  });

const useEntityListQuery = (options: EntityListQueryOptions): EntityListQueryState => {
  const indexQuery = useAtlasIndexQuery(options);
  const items = useMemo(
    () => indexQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [indexQuery.data],
  );
  const firstPage = indexQuery.data?.pages[0];
  const facets = firstPage?.facets;
  const kindOptions = useMemo(() => Object.keys(facets?.kind ?? {}).toSorted(), [facets]);
  const countryOptions = useMemo(() => Object.keys(facets?.country ?? {}).toSorted(), [facets]);
  const fundingOptions = useMemo(() => Object.keys(facets?.funding ?? {}).toSorted(), [facets]);
  const biasOptions = useMemo(() => Object.keys(facets?.bias ?? {}).toSorted(), [facets]);
  return {
    biasOptions,
    countryOptions,
    error: indexQuery.error,
    fetchNextPage: () => indexQuery.fetchNextPage(),
    fundingOptions,
    hasNextPage: indexQuery.hasNextPage,
    isFetchingNextPage: indexQuery.isFetchingNextPage,
    isLoading: indexQuery.isLoading,
    items,
    kindOptions,
    total: firstPage?.total ?? 0,
  };
};

const getVirtualItems = (
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
): readonly Readonly<{ index: number; size: number; start: number }>[] => {
  const visibleRows = Math.ceil((viewportHeight || ROW_ESTIMATE * 8) / ROW_ESTIMATE);
  const firstVisible = Math.floor(scrollTop / ROW_ESTIMATE);
  const start = Math.max(0, firstVisible - VIRTUAL_OVERSCAN);
  const end = Math.min(itemCount, firstVisible + visibleRows + VIRTUAL_OVERSCAN);
  return Array.from({ length: Math.max(0, end - start) }, (_unused, offset) => {
    const index = start + offset;
    return { index, size: ROW_ESTIMATE, start: index * ROW_ESTIMATE };
  });
};

const useEntityListViewport = ({
  active,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  items,
}: EntityListViewportOptions): EntityListViewportState => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return () => {};
    }
    const updateViewport = (): void => {
      setScrollTop(viewport.scrollTop);
      setViewportHeight(viewport.clientHeight);
    };
    updateViewport();
    viewport.addEventListener("scroll", updateViewport, { passive: true });
    globalThis.addEventListener("resize", updateViewport);
    return () => {
      viewport.removeEventListener("scroll", updateViewport);
      globalThis.removeEventListener("resize", updateViewport);
    };
  }, []);
  const totalSize = items.length * ROW_ESTIMATE;
  const virtualItems = useMemo(
    () => getVirtualItems(items.length, scrollTop, viewportHeight),
    [items.length, scrollTop, viewportHeight],
  );
  useEffect(() => {
    if (!active) {
      return;
    }
    const last = virtualItems.at(-1);
    if (last === undefined || last.index < items.length - LOAD_AHEAD_ROWS) {
      return;
    }
    if (hasNextPage !== true || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [active, fetchNextPage, hasNextPage, isFetchingNextPage, items.length, virtualItems]);
  return { totalSize, viewportRef, virtualItems };
};

const useAtlasEntityListState = ({
  active,
  bias,
  country,
  entityTypes,
  funding,
}: AtlasEntityListStateOptions): AtlasEntityListState => {
  const filters = useEntityListFilters(entityTypes);
  const query = useEntityListQuery({
    active,
    bias,
    country,
    effectiveTypes: filters.effectiveTypes,
    funding,
    kind: filters.kind,
    query: filters.query,
    sort: filters.sort,
  });
  const viewport = useEntityListViewport({
    active,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    items: query.items,
  });
  return { ...filters, ...query, ...viewport };
};

export { TYPE_TABS, useAtlasEntityListState };
export type { AtlasEntityListState, EntityTypeTab };
