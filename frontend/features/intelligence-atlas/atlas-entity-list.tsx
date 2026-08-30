"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownAZ, Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";

import { fetchAtlasIndex } from "./lib/atlas-api";
import type { AtlasEntityType, AtlasNode } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

interface AtlasEntityListProps {
  entityTypes: AtlasEntityType[];
  country: string[];
  funding: string[];
  bias: string[];
  onFiltersChange: (filters:Readonly< { country?: string[]; funding?: string[]; bias?: string[] }>) => void;
  onSelect: (node: AtlasNode) => void;
  /** "page" fills its container (the directory landing surface); "modal" keeps the bounded height used inside a dialog. */
  variant?: "page" | "modal";
  active?: boolean;
}

function humanizeKind(value: string): string {
  return value.replaceAll('_', " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());
}

// "People" pulls in both `person` and `reporter` node types: reporters are a
// Subtype of person (every reporter is a person; not every person is a
// Reporter, e.g. owners/founders), so the People tab is the "everyone"
// Directory view while Reporters stays a narrower, reporters-only cut.
const TYPE_TABS: { key: "all" | AtlasEntityType; label: string; types: AtlasEntityType[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "outlet", label: "Outlets", types: ["outlet"] },
  { key: "organization", label: "Organizations", types: ["organization"] },
  { key: "person", label: "People", types: ["person", "reporter"] },
  { key: "reporter", label: "Reporters", types: ["reporter"] },
];

/**
 * The paginated/faceted entity list: search + type tabs + facet selects +
 * a virtualized, server-filtered list. Extracted from the former
 * `AtlasIndexSheet` modal so the same list core backs both the directory
 * landing surface (`variant="page"`) and any bounded/dialog usage
 * (`variant="modal"`).
 */
export function AtlasEntityList({
  entityTypes,
  country,
  funding,
  bias,
  onFiltersChange,
  onSelect,
  variant = "page",
  active = true,
}: AtlasEntityListProps) {
  const [type, setType] = useState<"all" | AtlasEntityType>("all"),
   [kind, setKind] = useState<string[]>([]),
   [query, setQuery] = useState(""),
   [sort, setSort] = useState("most_connected"),
   viewportRef = useRef<HTMLDivElement>(undefined),
   activeTab = TYPE_TABS.find((tab) => tab.key === type),
   effectiveTypes = type === "all" ? entityTypes : (activeTab?.types ?? []),

   indexQuery = useInfiniteQuery({
    enabled: active,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchAtlasIndex(
        {
          bias,
          country,
          cursor: pageParam,
          entityTypes: effectiveTypes,
          funding,
          kind,
          limit: 80,
          q: query || undefined,
          sort,
        },
        signal,
      ),
    queryKey: ["atlas", "index", effectiveTypes, query, country, funding, bias, kind, sort],
    staleTime: 60_000,
  }),

   {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = indexQuery,
   items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]),
   total = data?.pages[0]?.total ?? 0,
   facets = data?.pages[0]?.facets,
   kindOptions = useMemo(() => Object.keys(facets?.kind ?? {}).sort(), [facets]),
   virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 66,
    getScrollElement: () => viewportRef.current,
    overscan: 8,
  }),
   { getTotalSize, getVirtualItems } = virtualizer;

  useEffect(() => {
    if (!active) {return;}
    const virtualItems = getVirtualItems(),
     last = virtualItems.at(-1);
    if (!last || last.index < items.length - 8 || !hasNextPage || isFetchingNextPage) {return;}
    void fetchNextPage();
  }, [active, fetchNextPage, getVirtualItems, hasNextPage, isFetchingNextPage, items.length]);

  return (
    <div className={variant === "page" ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <div className={variant === "page" ? "border-b border-white/10 p-5 pr-5" : "border-b border-white/10 p-5 pr-14"}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            {variant === "page" ? (
              <>
                <h1 className="font-serif text-3xl font-normal text-[#f0ede4]">Entity directory</h1>
                <p className="mt-1 text-[#77736a]">
                  {total.toLocaleString()} matching records. Search outlets, organizations, people, and reporters.
                </p>
              </>
            ) : (
              <p className="text-[#77736a]">
                {total.toLocaleString()} matching records. Results are server-filtered and rendered virtually.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[230px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#77736a]" />
              <Input
                value={query}
                onChange={(event) =>{  setQuery(event.target.value); }}
                placeholder="Search the entity index"
                aria-label="Search the entity index"
                className="border-white/10 bg-black/20 pl-9"
              />
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
              <ArrowDownAZ className="h-4 w-4 text-[#77736a]" />
              <select
                value={sort}
                onChange={(event) =>{  setSort(event.target.value); }}
                className="h-10 bg-transparent text-sm text-[#c9c3b6] outline-none"
                aria-label="Sort entity index"
              >
                <option value="most_connected">Most connected</option>
                <option value="most_articles">Most articles</option>
                <option value="recently_indexed">Recently indexed</option>
                <option value="lowest_confidence">Lowest confidence</option>
                <option value="name">Name</option>
              </select>
            </label>
            <FacetSelect
              label="Country"
              value={country[0] ?? "all"}
              values={Object.keys(facets?.country ?? {}).sort()}
              onChange={(value) =>{  onFiltersChange({ country: value === "all" ? [] : [value] }); }}
            />
            <FacetSelect
              label="Funding"
              value={funding[0] ?? "all"}
              values={Object.keys(facets?.funding ?? {}).sort()}
              onChange={(value) =>{  onFiltersChange({ funding: value === "all" ? [] : [value] }); }}
            />
            <FacetSelect
              label="Bias"
              value={bias[0] ?? "all"}
              values={Object.keys(facets?.bias ?? {}).sort()}
              onChange={(value) =>{  onFiltersChange({ bias: value === "all" ? [] : [value] }); }}
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={styles.pillButton}
              data-active={type === tab.key}
              onClick={() => {
                setType(tab.key);
                setKind([]);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {kindOptions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2 overflow-x-auto" aria-label="Filter by entity kind">
            <button
              type="button"
              className={styles.pillButton}
              data-active={kind.length === 0}
              onClick={() =>{  setKind([]); }}
            >
              All kinds
            </button>
            {kindOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.pillButton}
                data-active={kind.includes(option)}
                onClick={() =>{ 
                  setKind((current) =>
                    current.includes(option) ? current.filter((value) => value !== option) : [...current, option],
                  ); }
                }
              >
                {humanizeKind(option)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className={variant === "page" ? "relative min-h-0 flex-1 overflow-auto" : styles.indexViewport}
      >
        {isLoading ? (
          <div className={styles.emptyState}>
            <Loader2 className="h-6 w-6 animate-spin text-[#d7b35f]" aria-label="Loading entity index" />
          </div>
        ) : error instanceof Error ? (
          <div className={styles.emptyState}>
            <div>
              <div className={styles.brandTitle}>Index unavailable</div>
              <p className={styles.contextCopy}>{error.message}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.emptyState}>No entity records match the current index filters.</div>
        ) : (
          <>
            <div className={styles.indexHeaderRow} aria-hidden="true">
              <span />
              <span>Name</span>
              <span>Country</span>
              <span>Funding</span>
              <span>Links</span>
              <span>Confidence</span>
            </div>
            <div style={{ height: getTotalSize(), position: "relative" }}>
              {getVirtualItems().map((row) => {
                const node = items[row.index];
                if (!node) {return undefined;}
                const researched =
                  Boolean(node.current_parent) ||
                  node.connection_count > 0 ||
                  node.evidence_coverage !== "not researched" ||
                  Object.keys(node.analysis_scores).length > 0;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={styles.indexCard}
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                    onClick={() =>{  onSelect(node); }}
                  >
                    <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">
                      {node.entity_type.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
                      <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
                        {node.subtitle || node.entity_type}
                        {Object.keys(node.analysis_scores).length > 0
                          ? ` · ${Object.keys(node.analysis_scores).length} analysis scores`
                          : ""}
                      </span>
                      {researched ? (
                        <span className={`mt-1 block truncate text-[10px] ${styles.indexParent}`}>
                          {node.current_parent
                            ? `Owned by ${node.current_parent}`
                            : node.evidence_coverage}
                          {node.pending_change ? ` · ${node.pending_change}` : ""}
                        </span>
                      ) : (
                        <span className={`mt-1 block truncate text-[10px] ${styles.indexUnresearched}`}>
                          Not yet researched
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-[#c9c3b6]">{node.country_code || "—"}</span>
                    <span className="text-xs text-[#c9c3b6]">{node.funding_type || "—"}</span>
                    <span className="text-xs text-[#c9c3b6]">
                      {node.connection_count > 0 ? `${node.connection_count} links` : "—"}
                    </span>
                    <span className={styles.confidence} data-tier={node.confidence_tier ?? "unresolved"}>
                      {node.confidence_tier || "unresolved"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {isFetchingNextPage ? (
        <div className="flex items-center justify-center gap-2 border-t border-white/10 p-3 text-xs text-[#77736a]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more records
        </div>
      ) : null}
    </div>
  );
}

function FacetSelect({
  label,
  value,
  values,
  onChange,
}:Readonly< {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="rounded-xl border border-white/10 bg-black/20 px-3">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) =>{  onChange(event.target.value); }}
        className="h-10 max-w-36 bg-transparent text-sm text-[#c9c3b6] outline-none"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        <option value="all">All {label.toLowerCase()}</option>
        {values.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
